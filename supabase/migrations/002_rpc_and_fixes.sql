-- ============================================================================
-- PAN-CARDS — Migration 002 : fonctions RPC du jeu, correctifs de sécurité
-- et règles de stockage
-- ----------------------------------------------------------------------------
-- Cette migration versionne les 10 fonctions appelées par le frontend :
--   sync_user_boosters, open_booster, buy_booster, discard_user_cards,
--   rate_card, add_card_comment, get_card_rating_summary, set_user_showcase,
--   submit_new_pancarte, moderate_pancarte
-- Si des fonctions portant ces noms existent déjà dans le projet Supabase,
-- elles sont REMPLACÉES par les versions ci-dessous.
-- La migration est rejouable : elle peut être exécutée plusieurs fois.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 0. Nettoyage des éventuelles versions précédentes (signatures inconnues)
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  fn RECORD;
BEGIN
  FOR fn IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN (
        'sync_user_boosters', 'open_booster', 'buy_booster',
        'discard_user_cards', 'rate_card', 'add_card_comment',
        'get_card_rating_summary', 'set_user_showcase',
        'submit_new_pancarte', 'moderate_pancarte'
      )
  LOOP
    EXECUTE format('DROP FUNCTION %s', fn.sig);
  END LOOP;
END;
$$;

-- ----------------------------------------------------------------------------
-- 1. Trigger de protection du profil (C2)
--    Avant : il testait current_setting('role'), qui vaut toujours
--    'authenticated' dans une fonction SECURITY DEFINER, et bloquait donc
--    les RPC du jeu. On teste maintenant current_user : il vaut
--    'authenticated' / 'anon' pour un appel direct depuis l'API, et le
--    propriétaire de la fonction (postgres) dans une RPC SECURITY DEFINER
--    ou dans l'éditeur SQL.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.protect_profile_sensitive_columns()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF current_user IN ('authenticated', 'anon')
     AND NOT public.is_current_user_admin() THEN
    IF NEW.poubelles IS DISTINCT FROM OLD.poubelles
       OR NEW.boosters_stored IS DISTINCT FROM OLD.boosters_stored
       OR NEW.last_booster_tick IS DISTINCT FROM OLD.last_booster_tick
       OR NEW.is_admin IS DISTINCT FROM OLD.is_admin
       OR NEW.is_suspended IS DISTINCT FROM OLD.is_suspended THEN
      RAISE EXCEPTION 'Modification directe des champs protégés interdite.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- ----------------------------------------------------------------------------
-- 2. Droits de lecture et d'écriture (C4, C5, I3)
-- ----------------------------------------------------------------------------

-- C4 : un contributeur voit ses propres propositions (en attente / rejetées)
DROP POLICY IF EXISTS "Lecture de ses propres propositions" ON public.cards;
CREATE POLICY "Lecture de ses propres propositions"
  ON public.cards FOR SELECT
  USING (uploaded_by = auth.uid());

-- C5 : registre des récompenses déjà versées, inaccessible aux joueurs.
-- Une récompense « note » ou « commentaire » n'est versée qu'une fois par
-- carte, même si la note ou le commentaire est supprimé puis recréé.
CREATE TABLE IF NOT EXISTS public.reward_claims (
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  card_id INTEGER NOT NULL REFERENCES public.cards(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('rating', 'comment')),
  claimed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, card_id, kind)
);
ALTER TABLE public.reward_claims ENABLE ROW LEVEL SECURITY;
-- Aucune policy : seules les fonctions SECURITY DEFINER y accèdent.

-- Reprise de l'historique : toute note / commentaire existant vaut récompense
INSERT INTO public.reward_claims (user_id, card_id, kind)
SELECT DISTINCT user_id, card_id, 'rating' FROM public.ratings
ON CONFLICT DO NOTHING;
INSERT INTO public.reward_claims (user_id, card_id, kind)
SELECT DISTINCT user_id, card_id, 'comment' FROM public.comments
ON CONFLICT DO NOTHING;

-- C5 + I3 : les notes ne s'écrivent plus que via rate_card, et chaque joueur
-- ne lit que ses propres votes (la moyenne passe par get_card_rating_summary,
-- ce qui rend effectif le seuil des 6 votes).
DROP POLICY IF EXISTS "Gestion de ses propres notes" ON public.ratings;
DROP POLICY IF EXISTS "Lecture des notes" ON public.ratings;
DROP POLICY IF EXISTS "Lecture de ses propres notes" ON public.ratings;
CREATE POLICY "Lecture de ses propres notes"
  ON public.ratings FOR SELECT
  USING (user_id = auth.uid() OR public.is_current_user_admin());

-- Les commentaires ne se créent plus que via add_card_comment
-- (contrôle de suspension et de récompense). Modification et suppression
-- directes de ses propres commentaires restent possibles.
DROP POLICY IF EXISTS "Création et édition de ses commentaires" ON public.comments;

-- S1 : la vue respecte désormais les règles RLS de l'utilisateur
ALTER VIEW public.card_rating_stats SET (security_invoker = true);

-- ----------------------------------------------------------------------------
-- 3. Fonctions utilitaires internes (non appelables depuis l'API)
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public._game_setting(p_key TEXT, p_default INTEGER)
RETURNS INTEGER
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT value_int FROM public.game_settings WHERE key = p_key),
    p_default
  );
$$;

-- Vérifie que l'appelant est connecté et non suspendu, renvoie son id
CREATE OR REPLACE FUNCTION public._require_active_user()
RETURNS UUID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_suspended BOOLEAN;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Connexion requise.';
  END IF;

  SELECT is_suspended INTO v_suspended FROM public.profiles WHERE id = v_uid;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Profil introuvable.';
  END IF;
  IF v_suspended THEN
    RAISE EXCEPTION 'Ton compte est suspendu.';
  END IF;

  RETURN v_uid;
END;
$$;

-- Crédite (ou débite) des poubelles et journalise la transaction
CREATE OR REPLACE FUNCTION public._apply_poubelles(
  p_user_id UUID,
  p_amount INTEGER,
  p_operation TEXT,
  p_card_id INTEGER DEFAULT NULL
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_balance INTEGER;
BEGIN
  UPDATE public.profiles
  SET poubelles = poubelles + p_amount
  WHERE id = p_user_id
  RETURNING poubelles INTO v_balance;

  IF v_balance IS NULL THEN
    RAISE EXCEPTION 'Profil introuvable.';
  END IF;
  IF v_balance < 0 THEN
    RAISE EXCEPTION 'Solde de poubelles insuffisant.';
  END IF;

  INSERT INTO public.transactions (user_id, amount, balance_after, operation_type, card_id)
  VALUES (p_user_id, p_amount, v_balance, p_operation, p_card_id);

  RETURN v_balance;
END;
$$;

-- Recharge les boosters gratuits accumulés depuis le dernier passage.
-- Verrouille la ligne du profil (à appeler dans la transaction de la RPC).
CREATE OR REPLACE FUNCTION public._sync_boosters(p_user_id UUID)
RETURNS TABLE (boosters_available INTEGER, seconds_until_next INTEGER, poubelles_balance INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_interval_s INTEGER := GREATEST(public._game_setting('booster_recharge_minutes', 15), 1) * 60;
  -- 8 = plafond imposé par la contrainte CHECK de profiles.boosters_stored
  v_max INTEGER := LEAST(GREATEST(public._game_setting('booster_max_stock', 8), 0), 8);
  v_stored INTEGER;
  v_tick TIMESTAMPTZ;
  v_balance INTEGER;
  v_elapsed_s BIGINT;
  v_gained INTEGER;
  v_now TIMESTAMPTZ := now();
BEGIN
  SELECT p.boosters_stored, p.last_booster_tick, p.poubelles
  INTO v_stored, v_tick, v_balance
  FROM public.profiles p
  WHERE p.id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Profil introuvable.';
  END IF;

  IF v_stored >= v_max THEN
    -- Stock plein : le compteur repart de maintenant
    v_tick := v_now;
  ELSE
    v_elapsed_s := GREATEST(FLOOR(EXTRACT(EPOCH FROM (v_now - v_tick)))::BIGINT, 0);
    v_gained := LEAST(v_elapsed_s / v_interval_s, v_max)::INTEGER;
    IF v_gained > 0 THEN
      v_stored := LEAST(v_stored + v_gained, v_max);
      IF v_stored >= v_max THEN
        v_tick := v_now;
      ELSE
        v_tick := v_tick + make_interval(secs => v_gained * v_interval_s);
      END IF;
    END IF;
  END IF;

  UPDATE public.profiles
  SET boosters_stored = v_stored, last_booster_tick = v_tick
  WHERE id = p_user_id;

  boosters_available := v_stored;
  poubelles_balance := v_balance;
  IF v_stored >= v_max THEN
    seconds_until_next := 0;
  ELSE
    seconds_until_next := GREATEST(
      v_interval_s - FLOOR(EXTRACT(EPOCH FROM (v_now - v_tick)))::INTEGER,
      1
    );
  END IF;
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public._game_setting(TEXT, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._require_active_user() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._apply_poubelles(UUID, INTEGER, TEXT, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._sync_boosters(UUID) FROM PUBLIC, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 4. Boosters et économie
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.sync_user_boosters()
RETURNS TABLE (boosters_available INTEGER, seconds_until_next INTEGER, poubelles_balance INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Connexion requise.';
  END IF;
  RETURN QUERY SELECT * FROM public._sync_boosters(v_uid);
END;
$$;

-- Ouvre un booster : 5 tirages indépendants et équiprobables parmi les
-- pancartes publiées (une même carte peut sortir plusieurs fois).
CREATE OR REPLACE FUNCTION public.open_booster()
RETURNS TABLE (
  user_card_id UUID,
  card_id INTEGER,
  original_filename TEXT,
  image_url TEXT,
  thumb_url TEXT,
  description TEXT,
  extra_info TEXT,
  is_new_to_collection BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := public._require_active_user();
  v_sync RECORD;
  v_card public.cards%ROWTYPE;
  v_drawn INTEGER[] := ARRAY[]::INTEGER[];
  v_new_id UUID;
  v_already_owned BOOLEAN;
  v_max INTEGER := LEAST(GREATEST(public._game_setting('booster_max_stock', 8), 0), 8);
  i INTEGER;
BEGIN
  SELECT * INTO v_sync FROM public._sync_boosters(v_uid);

  IF v_sync.boosters_available <= 0 THEN
    RAISE EXCEPTION 'Aucun booster disponible pour le moment.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.cards c WHERE c.status = 'published') THEN
    RAISE EXCEPTION 'Aucune pancarte publiée : impossible d''ouvrir un booster.';
  END IF;

  -- Consomme un booster. Si le stock était plein, la recharge démarre maintenant.
  UPDATE public.profiles p
  SET boosters_stored = p.boosters_stored - 1,
      last_booster_tick = CASE WHEN p.boosters_stored >= v_max THEN now() ELSE p.last_booster_tick END
  WHERE p.id = v_uid;

  FOR i IN 1..5 LOOP
    SELECT c.* INTO v_card
    FROM public.cards c
    WHERE c.status = 'published'
    OFFSET floor(random() * (SELECT count(*) FROM public.cards c2 WHERE c2.status = 'published'))::INTEGER
    LIMIT 1;

    v_already_owned := EXISTS (
      SELECT 1 FROM public.user_cards uc
      WHERE uc.user_id = v_uid AND uc.card_id = v_card.id
    ) OR v_card.id = ANY (v_drawn);

    INSERT INTO public.user_cards (user_id, card_id, source)
    VALUES (v_uid, v_card.id, 'booster')
    RETURNING id INTO v_new_id;

    v_drawn := v_drawn || v_card.id;

    user_card_id := v_new_id;
    card_id := v_card.id;
    original_filename := v_card.original_filename;
    image_url := v_card.image_url;
    thumb_url := v_card.thumb_url;
    description := v_card.description;
    extra_info := v_card.extra_info;
    is_new_to_collection := NOT v_already_owned;
    RETURN NEXT;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.buy_booster()
RETURNS TABLE (boosters_available INTEGER, seconds_until_next INTEGER, poubelles_balance INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := public._require_active_user();
  v_cost INTEGER := GREATEST(public._game_setting('booster_cost', 200), 0);
  v_sync RECORD;
BEGIN
  SELECT * INTO v_sync FROM public._sync_boosters(v_uid);

  IF v_sync.boosters_available >= 8 THEN
    RAISE EXCEPTION 'Ton stock de boosters est plein (8 maximum).';
  END IF;
  IF v_sync.poubelles_balance < v_cost THEN
    RAISE EXCEPTION 'Il te faut % poubelles pour acheter un booster.', v_cost;
  END IF;

  PERFORM public._apply_poubelles(v_uid, -v_cost, 'buy_booster', NULL);

  UPDATE public.profiles p
  SET boosters_stored = p.boosters_stored + 1
  WHERE p.id = v_uid;

  RETURN QUERY SELECT * FROM public._sync_boosters(v_uid);
END;
$$;

-- Défausse des exemplaires : on garde toujours au moins 1 exemplaire par carte
CREATE OR REPLACE FUNCTION public.discard_user_cards(p_user_card_ids UUID[])
RETURNS TABLE (discarded_count INTEGER, total_earned INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := public._require_active_user();
  v_reward INTEGER := GREATEST(public._game_setting('discard_reward', 10), 0);
  v_copy RECORD;
  v_remaining INTEGER;
  v_count INTEGER := 0;
BEGIN
  IF p_user_card_ids IS NULL OR array_length(p_user_card_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'Aucun exemplaire sélectionné.';
  END IF;

  FOR v_copy IN
    SELECT uc.id, uc.card_id
    FROM public.user_cards uc
    WHERE uc.user_id = v_uid
      AND uc.id = ANY (p_user_card_ids)
    ORDER BY uc.acquired_at DESC
    FOR UPDATE
  LOOP
    SELECT count(*) INTO v_remaining
    FROM public.user_cards uc
    WHERE uc.user_id = v_uid AND uc.card_id = v_copy.card_id;

    -- Ne jamais défausser le dernier exemplaire d'une carte
    CONTINUE WHEN v_remaining <= 1;

    -- Ne pas défausser un exemplaire engagé dans un échange en cours
    CONTINUE WHEN EXISTS (
      SELECT 1 FROM public.trade_items ti
      JOIN public.trades t ON t.id = ti.trade_id
      WHERE ti.user_card_id = v_copy.id AND t.status = 'pending'
    );

    DELETE FROM public.user_cards WHERE id = v_copy.id;
    PERFORM public._apply_poubelles(v_uid, v_reward, 'discard_card', v_copy.card_id);
    v_count := v_count + 1;
  END LOOP;

  discarded_count := v_count;
  total_earned := v_count * v_reward;
  RETURN NEXT;
END;
$$;

-- ----------------------------------------------------------------------------
-- 5. Notes et commentaires
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_card_rating_summary(p_card_id INTEGER)
RETURNS TABLE (
  vote_count INTEGER,
  average_stars NUMERIC,
  is_public_average BOOLEAN,
  user_stars INTEGER
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INTEGER;
  v_avg NUMERIC;
BEGIN
  SELECT count(*)::INTEGER, ROUND(AVG(r.stars)::NUMERIC, 2)
  INTO v_count, v_avg
  FROM public.ratings r
  WHERE r.card_id = p_card_id;

  vote_count := v_count;
  is_public_average := v_count >= 6;
  average_stars := CASE WHEN v_count >= 6 THEN v_avg ELSE NULL END;
  user_stars := (
    SELECT r.stars::INTEGER FROM public.ratings r
    WHERE r.card_id = p_card_id AND r.user_id = auth.uid()
  );
  RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION public.rate_card(p_card_id INTEGER, p_stars INTEGER)
RETURNS TABLE (
  reward_granted BOOLEAN,
  vote_count INTEGER,
  average_stars NUMERIC,
  is_public_average BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := public._require_active_user();
  v_reward INTEGER := GREATEST(public._game_setting('rating_reward', 1), 0);
  v_claimed BOOLEAN := false;
  v_summary RECORD;
BEGIN
  IF p_stars IS NULL OR p_stars < 1 OR p_stars > 5 THEN
    RAISE EXCEPTION 'La note doit être comprise entre 1 et 5.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.cards c WHERE c.id = p_card_id AND c.status = 'published') THEN
    RAISE EXCEPTION 'Pancarte introuvable.';
  END IF;

  INSERT INTO public.ratings (user_id, card_id, stars, reward_claimed)
  VALUES (v_uid, p_card_id, p_stars, false)
  ON CONFLICT (user_id, card_id)
  DO UPDATE SET stars = EXCLUDED.stars, updated_at = now();

  INSERT INTO public.reward_claims (user_id, card_id, kind)
  VALUES (v_uid, p_card_id, 'rating')
  ON CONFLICT DO NOTHING
  RETURNING true INTO v_claimed;

  IF COALESCE(v_claimed, false) THEN
    UPDATE public.ratings SET reward_claimed = true
    WHERE user_id = v_uid AND card_id = p_card_id;
    IF v_reward > 0 THEN
      PERFORM public._apply_poubelles(v_uid, v_reward, 'rate_card', p_card_id);
    END IF;
  END IF;

  SELECT * INTO v_summary FROM public.get_card_rating_summary(p_card_id);

  reward_granted := COALESCE(v_claimed, false) AND v_reward > 0;
  vote_count := v_summary.vote_count;
  average_stars := v_summary.average_stars;
  is_public_average := v_summary.is_public_average;
  RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION public.add_card_comment(p_card_id INTEGER, p_content TEXT)
RETURNS TABLE (comment_id UUID, reward_granted BOOLEAN)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := public._require_active_user();
  v_reward INTEGER := GREATEST(public._game_setting('comment_reward', 1), 0);
  v_content TEXT := trim(COALESCE(p_content, ''));
  v_id UUID;
  v_claimed BOOLEAN := false;
BEGIN
  IF char_length(v_content) < 1 OR char_length(v_content) > 1000 THEN
    RAISE EXCEPTION 'Le commentaire doit contenir entre 1 et 1000 caractères.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.cards c WHERE c.id = p_card_id AND c.status = 'published') THEN
    RAISE EXCEPTION 'Pancarte introuvable.';
  END IF;

  INSERT INTO public.comments (user_id, card_id, content)
  VALUES (v_uid, p_card_id, v_content)
  RETURNING id INTO v_id;

  INSERT INTO public.reward_claims (user_id, card_id, kind)
  VALUES (v_uid, p_card_id, 'comment')
  ON CONFLICT DO NOTHING
  RETURNING true INTO v_claimed;

  IF COALESCE(v_claimed, false) THEN
    UPDATE public.comments SET reward_claimed = true WHERE id = v_id;
    IF v_reward > 0 THEN
      PERFORM public._apply_poubelles(v_uid, v_reward, 'comment_card', p_card_id);
    END IF;
  END IF;

  comment_id := v_id;
  reward_granted := COALESCE(v_claimed, false) AND v_reward > 0;
  RETURN NEXT;
END;
$$;

-- ----------------------------------------------------------------------------
-- 6. Vitrine
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.set_user_showcase(p_card_ids INTEGER[])
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := public._require_active_user();
  v_ids INTEGER[] := COALESCE(p_card_ids, ARRAY[]::INTEGER[]);
  i INTEGER;
BEGIN
  IF array_length(v_ids, 1) > 6 THEN
    RAISE EXCEPTION 'La vitrine est limitée à 6 pancartes.';
  END IF;
  IF (SELECT count(DISTINCT x) FROM unnest(v_ids) x) <> COALESCE(array_length(v_ids, 1), 0) THEN
    RAISE EXCEPTION 'Une même pancarte ne peut figurer qu''une fois en vitrine.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM unnest(v_ids) x
    WHERE NOT EXISTS (
      SELECT 1 FROM public.user_cards uc WHERE uc.user_id = v_uid AND uc.card_id = x
    )
  ) THEN
    RAISE EXCEPTION 'Tu ne peux exposer que des pancartes de ta collection.';
  END IF;

  DELETE FROM public.user_showcase WHERE user_id = v_uid;

  IF array_length(v_ids, 1) IS NOT NULL THEN
    FOR i IN 1..array_length(v_ids, 1) LOOP
      INSERT INTO public.user_showcase (user_id, card_id, position)
      VALUES (v_uid, v_ids[i], i);
    END LOOP;
  END IF;
END;
$$;

-- ----------------------------------------------------------------------------
-- 7. Contributions et modération
-- ----------------------------------------------------------------------------
-- Tant qu'une pancarte est en attente, image_url / thumb_url contiennent le
-- CHEMIN du fichier dans le bucket privé « submissions » (et non une URL
-- publique). À la validation, l'administrateur copie les fichiers dans le
-- bucket public « pancartes » et moderate_pancarte enregistre les URL publiques.

ALTER TABLE public.cards ALTER COLUMN published_at DROP DEFAULT;

CREATE OR REPLACE FUNCTION public.submit_new_pancarte(
  p_original_filename TEXT,
  p_image_url TEXT,
  p_thumb_url TEXT,
  p_description TEXT DEFAULT NULL,
  p_extra_info TEXT DEFAULT NULL
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := public._require_active_user();
  v_base TEXT := NULLIF(trim(COALESCE(p_original_filename, '')), '');
  v_name TEXT;
  v_suffix INTEGER := 1;
  v_id INTEGER;
BEGIN
  IF v_base IS NULL THEN
    RAISE EXCEPTION 'Nom de fichier manquant.';
  END IF;
  -- Les fichiers doivent être dans le dossier personnel du bucket submissions
  IF p_image_url IS NULL OR p_thumb_url IS NULL
     OR split_part(p_image_url, '/', 1) <> v_uid::text
     OR split_part(p_thumb_url, '/', 1) <> v_uid::text THEN
    RAISE EXCEPTION 'Chemin de fichier invalide.';
  END IF;
  IF (SELECT count(*) FROM public.cards c WHERE c.uploaded_by = v_uid AND c.status = 'pending') >= 20 THEN
    RAISE EXCEPTION 'Tu as déjà 20 propositions en attente de validation.';
  END IF;

  -- original_filename est unique : on ajoute un suffixe si besoin
  v_name := v_base;
  WHILE EXISTS (SELECT 1 FROM public.cards c WHERE lower(c.original_filename) = lower(v_name)) LOOP
    v_suffix := v_suffix + 1;
    v_name := v_base || ' (' || v_suffix || ')';
  END LOOP;

  INSERT INTO public.cards (
    original_filename, image_url, thumb_url, description, extra_info,
    status, uploaded_by, published_at
  )
  VALUES (
    v_name, p_image_url, p_thumb_url,
    NULLIF(trim(COALESCE(p_description, '')), ''),
    NULLIF(trim(COALESCE(p_extra_info, '')), ''),
    'pending', v_uid, NULL
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.moderate_pancarte(
  p_card_id INTEGER,
  p_decision TEXT,
  p_image_url TEXT DEFAULT NULL,
  p_thumb_url TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_card public.cards%ROWTYPE;
  v_reward INTEGER := GREATEST(public._game_setting('upload_approved_reward', 100), 0);
BEGIN
  IF NOT public.is_current_user_admin() THEN
    RAISE EXCEPTION 'Action réservée aux administrateurs.';
  END IF;
  IF p_decision NOT IN ('published', 'rejected') THEN
    RAISE EXCEPTION 'Décision inconnue : %', p_decision;
  END IF;

  SELECT * INTO v_card FROM public.cards WHERE id = p_card_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pancarte introuvable.';
  END IF;
  IF v_card.status <> 'pending' THEN
    RAISE EXCEPTION 'Cette pancarte a déjà été modérée.';
  END IF;

  IF p_decision = 'published' THEN
    IF p_image_url IS NULL OR p_thumb_url IS NULL THEN
      RAISE EXCEPTION 'Les URL publiques de l''image sont requises pour publier.';
    END IF;

    UPDATE public.cards
    SET status = 'published',
        image_url = p_image_url,
        thumb_url = p_thumb_url,
        published_at = now()
    WHERE id = p_card_id;

    IF v_card.uploaded_by IS NOT NULL THEN
      IF v_reward > 0 THEN
        PERFORM public._apply_poubelles(v_card.uploaded_by, v_reward, 'submission_approved', p_card_id);
      END IF;
      INSERT INTO public.notifications (user_id, type, title, body)
      VALUES (
        v_card.uploaded_by, 'submission_approved', 'Pancarte validée',
        format('Ta pancarte « %s » a rejoint l''archive (+%s poubelles).', v_card.original_filename, v_reward)
      );
    END IF;
  ELSE
    UPDATE public.cards SET status = 'rejected' WHERE id = p_card_id;

    IF v_card.uploaded_by IS NOT NULL THEN
      INSERT INTO public.notifications (user_id, type, title, body)
      VALUES (
        v_card.uploaded_by, 'submission_rejected', 'Pancarte refusée',
        format('Ta pancarte « %s » n''a pas été retenue.', v_card.original_filename)
      );
    END IF;
  END IF;
END;
$$;

-- Les RPC du jeu ne sont pas destinées aux visiteurs anonymes
REVOKE ALL ON FUNCTION public.open_booster() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.buy_booster() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.sync_user_boosters() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.discard_user_cards(UUID[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rate_card(INTEGER, INTEGER) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.add_card_comment(INTEGER, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_user_showcase(INTEGER[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.submit_new_pancarte(TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.moderate_pancarte(INTEGER, TEXT, TEXT, TEXT) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.open_booster() TO authenticated;
GRANT EXECUTE ON FUNCTION public.buy_booster() TO authenticated;
GRANT EXECUTE ON FUNCTION public.sync_user_boosters() TO authenticated;
GRANT EXECUTE ON FUNCTION public.discard_user_cards(UUID[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rate_card(INTEGER, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.add_card_comment(INTEGER, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_user_showcase(INTEGER[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.submit_new_pancarte(TEXT, TEXT, TEXT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.moderate_pancarte(INTEGER, TEXT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_card_rating_summary(INTEGER) TO anon, authenticated;

-- ----------------------------------------------------------------------------
-- 8. Stockage (C3, I2, I5)
-- ----------------------------------------------------------------------------

-- Bucket privé des propositions : 10 Mo max, images uniquement
INSERT INTO storage.buckets (id, name, public)
VALUES ('submissions', 'submissions', false)
ON CONFLICT (id) DO NOTHING;
UPDATE storage.buckets
SET public = false,
    file_size_limit = 10485760,
    allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/avif']
WHERE id = 'submissions';

-- Bucket public des avatars : 2 Mo max
INSERT INTO storage.buckets (id, name, public)
VALUES ('avatars', 'avatars', true)
ON CONFLICT (id) DO NOTHING;
UPDATE storage.buckets
SET public = true,
    file_size_limit = 2097152,
    allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/gif']
WHERE id = 'avatars';

-- submissions : chacun écrit et lit dans son propre dossier ; l'admin lit tout
DROP POLICY IF EXISTS "Upload des soumissions par utilisateurs connectés" ON storage.objects;
DROP POLICY IF EXISTS "Soumissions : envoi dans son dossier" ON storage.objects;
DROP POLICY IF EXISTS "Soumissions : lecture auteur ou admin" ON storage.objects;
DROP POLICY IF EXISTS "Soumissions : suppression admin" ON storage.objects;

CREATE POLICY "Soumissions : envoi dans son dossier"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'submissions'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "Soumissions : lecture auteur ou admin"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'submissions'
    AND ((storage.foldername(name))[1] = auth.uid()::text OR public.is_current_user_admin())
  );

CREATE POLICY "Soumissions : suppression admin"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'submissions' AND public.is_current_user_admin());

-- pancartes : seul un admin peut y écrire (copie à la validation)
DROP POLICY IF EXISTS "Pancartes : écriture admin" ON storage.objects;
DROP POLICY IF EXISTS "Pancartes : modification admin" ON storage.objects;
DROP POLICY IF EXISTS "Pancartes : suppression admin" ON storage.objects;

CREATE POLICY "Pancartes : écriture admin"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'pancartes' AND public.is_current_user_admin());

CREATE POLICY "Pancartes : modification admin"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'pancartes' AND public.is_current_user_admin());

CREATE POLICY "Pancartes : suppression admin"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'pancartes' AND public.is_current_user_admin());

-- avatars : lecture publique, écriture dans son propre dossier
DROP POLICY IF EXISTS "Avatars : lecture publique" ON storage.objects;
DROP POLICY IF EXISTS "Avatars : envoi dans son dossier" ON storage.objects;
DROP POLICY IF EXISTS "Avatars : remplacement dans son dossier" ON storage.objects;
DROP POLICY IF EXISTS "Avatars : suppression dans son dossier" ON storage.objects;

CREATE POLICY "Avatars : lecture publique"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'avatars');

CREATE POLICY "Avatars : envoi dans son dossier"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "Avatars : remplacement dans son dossier"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "Avatars : suppression dans son dossier"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text);
