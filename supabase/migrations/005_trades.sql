-- ============================================================================
-- PAN-CARDS — Migration 005 : échanges de cartes entre joueurs
-- ----------------------------------------------------------------------------
-- Les tables trades et trade_items existent depuis 001. Cette migration ajoute
-- les fonctions sécurisées qui les manipulent :
--   propose_trade   : proposer un échange à un autre joueur
--   respond_trade   : accepter ou refuser une proposition reçue
--   cancel_trade    : annuler sa propre proposition
--   get_my_trades   : lister ses échanges (reçus, envoyés, historique)
-- Les joueurs n'écrivent jamais directement dans trades / trade_items /
-- user_cards : tout passe par ces fonctions, qui vérifient la propriété des
-- cartes et font l'échange d'un seul bloc (tout ou rien).
-- Peut être exécutée plusieurs fois sans risque.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Colonnes complémentaires
-- ----------------------------------------------------------------------------

-- Petit message facultatif joint à la proposition
ALTER TABLE public.trades ADD COLUMN IF NOT EXISTS message TEXT;
-- Nombre de cartes prévues de chaque côté : permet de détecter qu'une carte
-- a disparu entre la proposition et l'acceptation
ALTER TABLE public.trades ADD COLUMN IF NOT EXISTS item_count INTEGER NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'trades_message_length'
  ) THEN
    ALTER TABLE public.trades
      ADD CONSTRAINT trades_message_length CHECK (message IS NULL OR char_length(message) <= 300);
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_trade_items_user_card ON public.trade_items(user_card_id);

-- Historique : on garde le numéro de la pancarte échangée, même si
-- l'exemplaire est défaussé plus tard (l'élément n'est plus supprimé avec lui)
ALTER TABLE public.trade_items ADD COLUMN IF NOT EXISTS card_id INTEGER REFERENCES public.cards(id) ON DELETE CASCADE;
UPDATE public.trade_items ti SET card_id = uc.card_id
FROM public.user_cards uc
WHERE uc.id = ti.user_card_id AND ti.card_id IS NULL;
ALTER TABLE public.trade_items ALTER COLUMN user_card_id DROP NOT NULL;

DO $$
DECLARE
  c RECORD;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.trade_items'::regclass
      AND confrelid = 'public.user_cards'::regclass
      AND contype = 'f'
      AND confdeltype <> 'n'
  LOOP
    EXECUTE format('ALTER TABLE public.trade_items DROP CONSTRAINT %I', c.conname);
  END LOOP;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.trade_items'::regclass
      AND confrelid = 'public.user_cards'::regclass
      AND contype = 'f'
  ) THEN
    ALTER TABLE public.trade_items
      ADD CONSTRAINT trade_items_user_card_id_fkey
      FOREIGN KEY (user_card_id) REFERENCES public.user_cards(id) ON DELETE SET NULL;
  END IF;
END;
$$;

-- RLS déjà active sur ces tables (001) ; on le réaffirme par sécurité
ALTER TABLE public.trades ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trade_items ENABLE ROW LEVEL SECURITY;

-- Lecture seule pour les joueurs (filtrée par les règles RLS de 001),
-- aucune écriture directe
GRANT SELECT ON public.trades, public.trade_items TO authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.trades, public.trade_items FROM anon, authenticated;

-- ----------------------------------------------------------------------------
-- 2. Proposer un échange
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.propose_trade(
  p_receiver_id UUID,
  p_offered_ids UUID[],
  p_requested_ids UUID[],
  p_message TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := public._require_active_user();
  v_offered UUID[] := ARRAY(SELECT DISTINCT x FROM unnest(COALESCE(p_offered_ids, '{}')) x WHERE x IS NOT NULL);
  v_requested UUID[] := ARRAY(SELECT DISTINCT x FROM unnest(COALESCE(p_requested_ids, '{}')) x WHERE x IS NOT NULL);
  v_receiver RECORD;
  v_owned INTEGER;
  v_pending INTEGER;
  v_trade_id UUID;
  v_message TEXT := NULLIF(trim(COALESCE(p_message, '')), '');
  v_proposer_name TEXT;
BEGIN
  IF p_receiver_id IS NULL OR p_receiver_id = v_uid THEN
    RAISE EXCEPTION 'Choisis un autre joueur.';
  END IF;

  -- Verrous dans un ordre fixe : les vérifications ci-dessous ne peuvent pas
  -- croiser un échange en train d'être accepté, ni une défausse
  PERFORM 1 FROM public.profiles
  WHERE id IN (v_uid, p_receiver_id)
  ORDER BY id
  FOR UPDATE;

  SELECT id, username, is_suspended, is_public INTO v_receiver
  FROM public.profiles WHERE id = p_receiver_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ce joueur n''existe pas.';
  END IF;
  IF v_receiver.is_suspended THEN
    RAISE EXCEPTION 'Ce joueur ne peut pas échanger pour le moment.';
  END IF;
  IF cardinality(v_requested) > 0 AND NOT v_receiver.is_public THEN
    RAISE EXCEPTION 'Ce joueur garde sa collection privée : tu peux seulement lui offrir des cartes.';
  END IF;

  IF cardinality(v_offered) + cardinality(v_requested) = 0 THEN
    RAISE EXCEPTION 'Choisis au moins une carte.';
  END IF;
  IF cardinality(v_offered) > 10 OR cardinality(v_requested) > 10 THEN
    RAISE EXCEPTION 'Dix cartes maximum de chaque côté.';
  END IF;
  IF v_offered && v_requested THEN
    RAISE EXCEPTION 'Une même carte ne peut pas être des deux côtés.';
  END IF;
  IF v_message IS NOT NULL AND char_length(v_message) > 300 THEN
    RAISE EXCEPTION 'Message trop long (300 caractères maximum).';
  END IF;

  SELECT count(*) INTO v_owned FROM public.user_cards
  WHERE id = ANY (v_offered) AND user_id = v_uid;
  IF v_owned <> cardinality(v_offered) THEN
    RAISE EXCEPTION 'Tu ne possèdes plus certaines des cartes proposées.';
  END IF;

  SELECT count(*) INTO v_owned FROM public.user_cards
  WHERE id = ANY (v_requested) AND user_id = p_receiver_id;
  IF v_owned <> cardinality(v_requested) THEN
    RAISE EXCEPTION 'Ce joueur ne possède plus certaines des cartes demandées.';
  END IF;

  -- Anti-spam : 20 propositions en attente maximum par joueur
  SELECT count(*) INTO v_pending FROM public.trades
  WHERE proposer_id = v_uid AND status = 'pending';
  IF v_pending >= 20 THEN
    RAISE EXCEPTION 'Tu as déjà 20 propositions en attente. Annule-en quelques-unes.';
  END IF;

  INSERT INTO public.trades (proposer_id, receiver_id, message, item_count)
  VALUES (v_uid, p_receiver_id, v_message, cardinality(v_offered) + cardinality(v_requested))
  RETURNING id INTO v_trade_id;

  INSERT INTO public.trade_items (trade_id, user_card_id, card_id, direction)
  SELECT v_trade_id, uc.id, uc.card_id,
         CASE WHEN uc.id = ANY (v_offered) THEN 'offered' ELSE 'requested' END
  FROM public.user_cards uc
  WHERE uc.id = ANY (v_offered || v_requested);

  SELECT username INTO v_proposer_name FROM public.profiles WHERE id = v_uid;
  INSERT INTO public.notifications (user_id, type, title, body)
  VALUES (
    p_receiver_id, 'trade_received', 'Nouvelle proposition d''échange',
    format('@%s te propose un échange.', v_proposer_name)
  );

  RETURN v_trade_id;
END;
$$;

-- ----------------------------------------------------------------------------
-- 3. Accepter ou refuser une proposition reçue
--    Renvoie 'accepted', 'rejected' ou 'invalid' (cartes plus disponibles :
--    la proposition est alors annulée automatiquement).
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.respond_trade(p_trade_id UUID, p_accept BOOLEAN)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := public._require_active_user();
  v_trade RECORD;
  v_valid INTEGER;
  v_moved UUID[];
  v_receiver_name TEXT;
  v_other RECORD;
BEGIN
  SELECT * INTO v_trade FROM public.trades WHERE id = p_trade_id;
  IF NOT FOUND OR v_trade.receiver_id <> v_uid THEN
    RAISE EXCEPTION 'Proposition introuvable.';
  END IF;

  -- Verrous toujours dans le même ordre (profils triés, puis échange, puis
  -- cartes) : deux acceptations simultanées s'attendent au lieu de se bloquer
  PERFORM 1 FROM public.profiles
  WHERE id IN (v_trade.proposer_id, v_trade.receiver_id)
  ORDER BY id
  FOR UPDATE;

  SELECT * INTO v_trade FROM public.trades WHERE id = p_trade_id FOR UPDATE;
  IF v_trade.status <> 'pending' THEN
    RAISE EXCEPTION 'Cette proposition a déjà été traitée.';
  END IF;

  SELECT username INTO v_receiver_name FROM public.profiles WHERE id = v_uid;

  IF NOT COALESCE(p_accept, false) THEN
    UPDATE public.trades SET status = 'rejected', resolved_at = now() WHERE id = p_trade_id;
    INSERT INTO public.notifications (user_id, type, title, body)
    VALUES (
      v_trade.proposer_id, 'trade_rejected', 'Échange refusé',
      format('@%s a refusé ta proposition d''échange.', v_receiver_name)
    );
    RETURN 'rejected';
  END IF;

  IF EXISTS (SELECT 1 FROM public.profiles WHERE id = v_trade.proposer_id AND is_suspended) THEN
    RAISE EXCEPTION 'L''auteur de cette proposition ne peut plus échanger.';
  END IF;

  PERFORM 1 FROM public.user_cards uc
  JOIN public.trade_items ti ON ti.user_card_id = uc.id
  WHERE ti.trade_id = p_trade_id
  ORDER BY uc.id
  FOR UPDATE OF uc;

  -- Chaque carte doit encore appartenir à la bonne personne
  SELECT count(*) INTO v_valid
  FROM public.trade_items ti
  JOIN public.user_cards uc ON uc.id = ti.user_card_id
  WHERE ti.trade_id = p_trade_id
    AND (
      (ti.direction = 'offered' AND uc.user_id = v_trade.proposer_id)
      OR (ti.direction = 'requested' AND uc.user_id = v_trade.receiver_id)
    );

  IF v_valid <> v_trade.item_count OR v_valid = 0 THEN
    UPDATE public.trades SET status = 'cancelled', resolved_at = now() WHERE id = p_trade_id;
    INSERT INTO public.notifications (user_id, type, title, body)
    VALUES (
      v_trade.proposer_id, 'trade_cancelled', 'Échange annulé',
      'Une proposition d''échange a été annulée : certaines cartes ne sont plus disponibles.'
    );
    RETURN 'invalid';
  END IF;

  -- Échange des cartes, d'un seul bloc
  UPDATE public.user_cards uc
  SET user_id = CASE WHEN ti.direction = 'offered' THEN v_trade.receiver_id ELSE v_trade.proposer_id END,
      source = 'trade',
      acquired_at = now()
  FROM public.trade_items ti
  WHERE ti.trade_id = p_trade_id AND ti.user_card_id = uc.id;

  UPDATE public.trades SET status = 'accepted', resolved_at = now() WHERE id = p_trade_id;

  INSERT INTO public.notifications (user_id, type, title, body)
  VALUES (
    v_trade.proposer_id, 'trade_accepted', 'Échange accepté',
    format('@%s a accepté ta proposition d''échange.', v_receiver_name)
  );

  -- Les autres propositions en attente qui utilisaient ces cartes deviennent caduques
  SELECT array_agg(user_card_id) INTO v_moved FROM public.trade_items
  WHERE trade_id = p_trade_id AND user_card_id IS NOT NULL;
  FOR v_other IN
    SELECT DISTINCT t.id, t.proposer_id
    FROM public.trades t
    JOIN public.trade_items ti ON ti.trade_id = t.id
    WHERE t.status = 'pending' AND t.id <> p_trade_id AND ti.user_card_id = ANY (v_moved)
  LOOP
    UPDATE public.trades SET status = 'cancelled', resolved_at = now() WHERE id = v_other.id;
    INSERT INTO public.notifications (user_id, type, title, body)
    VALUES (
      v_other.proposer_id, 'trade_cancelled', 'Échange annulé',
      'Une proposition d''échange a été annulée : certaines cartes ont déjà été échangées.'
    );
  END LOOP;

  -- Vitrines : retirer les pancartes que l'un des deux joueurs ne possède plus
  DELETE FROM public.user_showcase s
  WHERE s.user_id IN (v_trade.proposer_id, v_trade.receiver_id)
    AND NOT EXISTS (
      SELECT 1 FROM public.user_cards uc
      WHERE uc.user_id = s.user_id AND uc.card_id = s.card_id
    );

  RETURN 'accepted';
END;
$$;

-- ----------------------------------------------------------------------------
-- 4. Annuler sa propre proposition
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.cancel_trade(p_trade_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := public._require_active_user();
BEGIN
  UPDATE public.trades
  SET status = 'cancelled', resolved_at = now()
  WHERE id = p_trade_id AND proposer_id = v_uid AND status = 'pending';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Proposition introuvable ou déjà traitée.';
  END IF;
END;
$$;

-- ----------------------------------------------------------------------------
-- 5. Lister ses échanges avec le détail des cartes
--    (fonction dédiée : les cartes d'un joueur à collection privée restent
--    visibles par l'autre participant de l'échange, et seulement par lui)
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_my_trades()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := public._require_active_user();
BEGIN
  RETURN COALESCE((
    SELECT jsonb_agg(row_to_json(x)::jsonb ORDER BY x.sort_key DESC)
    FROM (
      SELECT
        t.id,
        t.status,
        t.message,
        t.created_at,
        t.resolved_at,
        COALESCE(t.resolved_at, t.created_at) AS sort_key,
        jsonb_build_object('id', pp.id, 'username', pp.username) AS proposer,
        jsonb_build_object('id', pr.id, 'username', pr.username) AS receiver,
        COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'user_card_id', COALESCE(ti.user_card_id::text, ti.id::text),
            'direction', ti.direction,
            'card', jsonb_build_object(
              'id', c.id,
              'thumb_url', c.thumb_url,
              'description', c.description
            )
          ) ORDER BY c.id)
          FROM public.trade_items ti
          JOIN public.cards c ON c.id = ti.card_id
          WHERE ti.trade_id = t.id
        ), '[]'::jsonb) AS items
      FROM public.trades t
      JOIN public.profiles pp ON pp.id = t.proposer_id
      JOIN public.profiles pr ON pr.id = t.receiver_id
      WHERE t.id IN (
        -- toutes les propositions en attente…
        SELECT id FROM public.trades
        WHERE (proposer_id = v_uid OR receiver_id = v_uid) AND status = 'pending'
        UNION ALL
        -- …et les 50 derniers échanges terminés
        (SELECT id FROM public.trades
         WHERE (proposer_id = v_uid OR receiver_id = v_uid) AND status <> 'pending'
         ORDER BY COALESCE(resolved_at, created_at) DESC
         LIMIT 50)
      )
    ) x
  ), '[]'::jsonb);
END;
$$;

-- ----------------------------------------------------------------------------
-- 6. Droits d'exécution (les nouveaux projets Supabase ne les donnent pas)
-- ----------------------------------------------------------------------------

REVOKE ALL ON FUNCTION public.propose_trade(UUID, UUID[], UUID[], TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.respond_trade(UUID, BOOLEAN) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.cancel_trade(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_my_trades() FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.propose_trade(UUID, UUID[], UUID[], TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.respond_trade(UUID, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_trade(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_trades() TO authenticated;
