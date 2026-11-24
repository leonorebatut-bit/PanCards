-- ============================================================================
-- PAN-CARDS — Migration 001 : Schéma initial, contraintes, index et RLS
-- ============================================================================

-- Extension UUID
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ----------------------------------------------------------------------------
-- 1. TABLES PRINCIPALES
-- ----------------------------------------------------------------------------

-- Profils utilisateurs liés à auth.users
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username TEXT UNIQUE NOT NULL CHECK (char_length(username) BETWEEN 3 AND 24 AND username ~ '^[a-zA-Z0-9_-]+$'),
  avatar_url TEXT,
  bio TEXT DEFAULT '' CHECK (char_length(bio) <= 500),
  is_public BOOLEAN NOT NULL DEFAULT true,
  poubelles INTEGER NOT NULL DEFAULT 100 CHECK (poubelles >= 0),
  boosters_stored INTEGER NOT NULL DEFAULT 2 CHECK (boosters_stored BETWEEN 0 AND 8),
  last_booster_tick TIMESTAMPTZ NOT NULL DEFAULT now(),
  is_admin BOOLEAN NOT NULL DEFAULT false,
  is_suspended BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Catalogue officiel des pancartes
CREATE TABLE public.cards (
  id SERIAL PRIMARY KEY,
  original_filename TEXT UNIQUE NOT NULL,
  image_url TEXT NOT NULL,
  thumb_url TEXT NOT NULL,
  description TEXT,
  extra_info TEXT,
  status TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('published', 'pending', 'rejected')),
  uploaded_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  published_at TIMESTAMPTZ DEFAULT now()
);

-- Contributions en attente de validation administrative
CREATE TABLE public.card_submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  submitted_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  image_url TEXT NOT NULL,
  thumb_url TEXT NOT NULL,
  original_filename TEXT NOT NULL,
  description TEXT,
  extra_info TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  reviewed_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  rejection_reason TEXT,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at TIMESTAMPTZ,
  published_card_id INTEGER REFERENCES public.cards(id) ON DELETE SET NULL
);

-- Exemplaires de cartes possédés par les joueurs (chaque ligne = 1 carte physique)
CREATE TABLE public.user_cards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  card_id INTEGER NOT NULL REFERENCES public.cards(id) ON DELETE CASCADE,
  acquired_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  source TEXT NOT NULL DEFAULT 'booster' CHECK (source IN ('booster', 'trade', 'admin', 'starter'))
);

-- Dossiers personnalisés de collection
CREATE TABLE public.collections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 60),
  description TEXT DEFAULT '' CHECK (char_length(description) <= 300),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Association dossiers <-> cartes du catalogue
CREATE TABLE public.collection_cards (
  collection_id UUID NOT NULL REFERENCES public.collections(id) ON DELETE CASCADE,
  card_id INTEGER NOT NULL REFERENCES public.cards(id) ON DELETE CASCADE,
  added_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (collection_id, card_id)
);

-- Vitrine personnelle (maximum 6 cartes favorites)
CREATE TABLE public.user_showcase (
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  card_id INTEGER NOT NULL REFERENCES public.cards(id) ON DELETE CASCADE,
  position SMALLINT NOT NULL CHECK (position BETWEEN 1 AND 6),
  PRIMARY KEY (user_id, position),
  UNIQUE (user_id, card_id)
);

-- Notes personnelles (1 à 5 étoiles)
CREATE TABLE public.ratings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  card_id INTEGER NOT NULL REFERENCES public.cards(id) ON DELETE CASCADE,
  stars SMALLINT NOT NULL CHECK (stars BETWEEN 1 AND 5),
  reward_claimed BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, card_id)
);

-- Légendes et commentaires
CREATE TABLE public.comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  card_id INTEGER NOT NULL REFERENCES public.cards(id) ON DELETE CASCADE,
  content TEXT NOT NULL CHECK (char_length(trim(content)) BETWEEN 1 AND 1000),
  reward_claimed BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Historique des transactions de poubelles
CREATE TABLE public.transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  amount INTEGER NOT NULL,
  balance_after INTEGER NOT NULL CHECK (balance_after >= 0),
  operation_type TEXT NOT NULL CHECK (
    operation_type IN (
      'signup_bonus',
      'discard_card',
      'rate_card',
      'comment_card',
      'submission_approved',
      'buy_booster',
      'admin_adjustment'
    )
  ),
  card_id INTEGER REFERENCES public.cards(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Propositions d'échanges entre joueurs
CREATE TABLE public.trades (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  proposer_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  receiver_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected', 'cancelled', 'ignored')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ,
  CHECK (proposer_id <> receiver_id)
);

-- Cartes engagées dans un échange
CREATE TABLE public.trade_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trade_id UUID NOT NULL REFERENCES public.trades(id) ON DELETE CASCADE,
  user_card_id UUID NOT NULL REFERENCES public.user_cards(id) ON DELETE CASCADE,
  direction TEXT NOT NULL CHECK (direction IN ('offered', 'requested')),
  UNIQUE (trade_id, user_card_id)
);

-- Notifications internes
CREATE TABLE public.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  is_read BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Paramètres économiques configurables par l'administrateur
CREATE TABLE public.game_settings (
  key TEXT PRIMARY KEY,
  value_int INTEGER NOT NULL,
  description TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO public.game_settings (key, value_int, description) VALUES
  ('signup_poubelles', 100, 'Poubelles créditées à l''inscription'),
  ('discard_reward', 10, 'Poubelles gagnées par carte défaussée'),
  ('rating_reward', 1, 'Poubelles gagnées pour la 1re note sur une carte'),
  ('comment_reward', 1, 'Poubelles gagnées pour le 1er commentaire sur une carte'),
  ('upload_approved_reward', 100, 'Poubelles gagnées lors de la validation d''une pancarte'),
  ('booster_cost', 200, 'Coût d''achat d''un booster en poubelles'),
  ('booster_recharge_minutes', 15, 'Minutes nécessaires pour recharger 1 booster'),
  ('booster_max_stock', 8, 'Plafond d''accumulation des boosters gratuits')
ON CONFLICT (key) DO NOTHING;

-- ----------------------------------------------------------------------------
-- 2. INDEX POUR RECHERCHES ET TRIS
-- ----------------------------------------------------------------------------

CREATE INDEX idx_cards_status_published ON public.cards(status, published_at DESC);
CREATE INDEX idx_user_cards_user_id ON public.user_cards(user_id);
CREATE INDEX idx_user_cards_card_id ON public.user_cards(card_id);
CREATE INDEX idx_ratings_card_id ON public.ratings(card_id);
CREATE INDEX idx_comments_card_id ON public.comments(card_id, created_at DESC);
CREATE INDEX idx_transactions_user_id ON public.transactions(user_id, created_at DESC);
CREATE INDEX idx_trades_proposer ON public.trades(proposer_id, status);
CREATE INDEX idx_trades_receiver ON public.trades(receiver_id, status);
CREATE INDEX idx_notifications_user_unread ON public.notifications(user_id, is_read, created_at DESC);

-- ----------------------------------------------------------------------------
-- 3. VUE DES NOTES MOYENNES COLLECTIVES (SEUIL >= 6 VOTES)
-- ----------------------------------------------------------------------------

CREATE OR REPLACE VIEW public.card_rating_stats AS
SELECT
  c.id AS card_id,
  COUNT(r.id)::INTEGER AS rating_count,
  CASE
    WHEN COUNT(r.id) >= 6 THEN ROUND(AVG(r.stars)::NUMERIC, 2)
    ELSE NULL
  END AS average_rating
FROM public.cards c
LEFT JOIN public.ratings r ON r.card_id = c.id
GROUP BY c.id;

-- ----------------------------------------------------------------------------
-- 4. FONCTION UTILITAIRE ADMIN
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.is_current_user_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT is_admin FROM public.profiles WHERE id = auth.uid()),
    false
  );
$$;

-- ----------------------------------------------------------------------------
-- 5. TRIGGER DE CRÉATION DE PROFIL À L'INSCRIPTION
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_username TEXT;
  v_initial_poubelles INTEGER;
BEGIN
  SELECT COALESCE(value_int, 100) INTO v_initial_poubelles
  FROM public.game_settings WHERE key = 'signup_poubelles';

  v_username := COALESCE(
    NEW.raw_user_meta_data->>'username',
    'collecteur_' || substr(NEW.id::text, 1, 8)
  );

  INSERT INTO public.profiles (id, username, poubelles, boosters_stored, last_booster_tick)
  VALUES (NEW.id, v_username, v_initial_poubelles, 2, now());

  INSERT INTO public.transactions (user_id, amount, balance_after, operation_type)
  VALUES (NEW.id, v_initial_poubelles, v_initial_poubelles, 'signup_bonus');

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ----------------------------------------------------------------------------
-- 6. ROW LEVEL SECURITY (RLS)
-- ----------------------------------------------------------------------------

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cards ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.card_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_cards ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.collections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.collection_cards ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_showcase ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ratings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trades ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trade_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.game_settings ENABLE ROW LEVEL SECURITY;

-- PROFILES : lecture publique de base, écriture restreinte (hors colonnes sensibles)
CREATE POLICY "Lecture des profils"
  ON public.profiles FOR SELECT
  USING (true);

CREATE POLICY "Modification de son propre profil"
  ON public.profiles FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- Empêcher l'utilisateur de modifier lui-même poubelles, is_admin, is_suspended ou boosters_stored
CREATE OR REPLACE FUNCTION public.protect_profile_sensitive_columns()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT public.is_current_user_admin() AND current_setting('role') <> 'service_role' THEN
    IF NEW.poubelles <> OLD.poubelles
       OR NEW.boosters_stored <> OLD.boosters_stored
       OR NEW.last_booster_tick <> OLD.last_booster_tick
       OR NEW.is_admin <> OLD.is_admin
       OR NEW.is_suspended <> OLD.is_suspended THEN
      RAISE EXCEPTION 'Modification directe des champs protégés interdite.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_profile_sensitive_columns ON public.profiles;
CREATE TRIGGER trg_protect_profile_sensitive_columns
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.protect_profile_sensitive_columns();

-- CARDS : lecture libre des cartes publiées, administration complète par admin
CREATE POLICY "Lecture des pancartes publiées"
  ON public.cards FOR SELECT
  USING (status = 'published' OR public.is_current_user_admin());

CREATE POLICY "Administration des pancartes"
  ON public.cards FOR ALL
  USING (public.is_current_user_admin())
  WITH CHECK (public.is_current_user_admin());

-- USER_CARDS : visible par son propriétaire, les admins, ou tout le monde si le profil est public
CREATE POLICY "Lecture des collections publiques ou personnelles"
  ON public.user_cards FOR SELECT
  USING (
    user_id = auth.uid()
    OR public.is_current_user_admin()
    OR EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = user_cards.user_id AND p.is_public = true
    )
  );

-- COLLECTIONS & COLLECTION_CARDS
CREATE POLICY "Lecture des dossiers publics ou personnels"
  ON public.collections FOR SELECT
  USING (
    user_id = auth.uid()
    OR public.is_current_user_admin()
    OR EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = collections.user_id AND p.is_public = true
    )
  );

CREATE POLICY "Gestion de ses propres dossiers"
  ON public.collections FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Lecture des cartes dans dossiers publics ou personnels"
  ON public.collection_cards FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.collections c
      JOIN public.profiles p ON p.id = c.user_id
      WHERE c.id = collection_cards.collection_id
        AND (c.user_id = auth.uid() OR p.is_public = true OR public.is_current_user_admin())
    )
  );

CREATE POLICY "Gestion des cartes dans ses propres dossiers"
  ON public.collection_cards FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.collections c
      WHERE c.id = collection_cards.collection_id AND c.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.collections c
      WHERE c.id = collection_cards.collection_id AND c.user_id = auth.uid()
    )
  );

-- USER_SHOWCASE
CREATE POLICY "Lecture des vitrines"
  ON public.user_showcase FOR SELECT
  USING (true);

CREATE POLICY "Gestion de sa propre vitrine"
  ON public.user_showcase FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- RATINGS & COMMENTS
CREATE POLICY "Lecture des notes"
  ON public.ratings FOR SELECT
  USING (true);

CREATE POLICY "Gestion de ses propres notes"
  ON public.ratings FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Lecture des commentaires"
  ON public.comments FOR SELECT
  USING (true);

CREATE POLICY "Création et édition de ses commentaires"
  ON public.comments FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Modification de ses propres commentaires"
  ON public.comments FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Suppression de ses commentaires ou par admin"
  ON public.comments FOR DELETE
  USING (user_id = auth.uid() OR public.is_current_user_admin());

-- TRANSACTIONS & NOTIFICATIONS : strictement privées (ou admin)
CREATE POLICY "Lecture de ses propres transactions"
  ON public.transactions FOR SELECT
  USING (user_id = auth.uid() OR public.is_current_user_admin());

CREATE POLICY "Lecture de ses propres notifications"
  ON public.notifications FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "Marquer ses notifications comme lues"
  ON public.notifications FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- CARD_SUBMISSIONS
CREATE POLICY "Lecture de ses soumissions ou par admin"
  ON public.card_submissions FOR SELECT
  USING (submitted_by = auth.uid() OR public.is_current_user_admin());

CREATE POLICY "Création d'une soumission"
  ON public.card_submissions FOR INSERT
  WITH CHECK (submitted_by = auth.uid());

CREATE POLICY "Mise à jour des soumissions par admin"
  ON public.card_submissions FOR UPDATE
  USING (public.is_current_user_admin());

-- TRADES & TRADE_ITEMS
CREATE POLICY "Lecture de ses échanges"
  ON public.trades FOR SELECT
  USING (proposer_id = auth.uid() OR receiver_id = auth.uid() OR public.is_current_user_admin());

CREATE POLICY "Lecture des objets d'échange concernés"
  ON public.trade_items FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.trades t
      WHERE t.id = trade_items.trade_id
        AND (t.proposer_id = auth.uid() OR t.receiver_id = auth.uid() OR public.is_current_user_admin())
    )
  );

-- GAME_SETTINGS
CREATE POLICY "Lecture des paramètres du jeu"
  ON public.game_settings FOR SELECT
  USING (true);

CREATE POLICY "Modification des paramètres par admin"
  ON public.game_settings FOR UPDATE
  USING (public.is_current_user_admin());

-- ----------------------------------------------------------------------------
-- 7. STORAGE BUCKETS (À EXÉCUTER SI NON CRÉÉS VIA INTERFACE)
-- ----------------------------------------------------------------------------

INSERT INTO storage.buckets (id, name, public)
VALUES ('pancartes', 'pancartes', true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO storage.buckets (id, name, public)
VALUES ('submissions', 'submissions', false)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Lecture publique des pancartes publiées"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'pancartes');

CREATE POLICY "Upload des soumissions par utilisateurs connectés"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'submissions' AND auth.role() = 'authenticated');
