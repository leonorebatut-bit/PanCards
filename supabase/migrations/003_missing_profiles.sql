-- ============================================================================
-- 003 : profils manquants
-- Un compte Supabase Auth créé avant l'installation du trigger
-- on_auth_user_created (ou dont le trigger a échoué) n'a pas de ligne dans
-- public.profiles : le site affiche alors « Profil introuvable ».
-- Ce script crée les profils manquants et ajoute une fonction que le site
-- appelle pour réparer automatiquement ce cas.
-- Peut être exécuté plusieurs fois sans risque.
-- ============================================================================

-- Crée le profil d'un utilisateur s'il n'existe pas (pseudonyme repris des
-- métadonnées s'il est valide et libre, sinon collecteur_xxxxxxxx).
CREATE OR REPLACE FUNCTION public._create_missing_profile(p_user_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_meta JSONB;
  v_email TEXT;
  v_username TEXT;
  v_poubelles INTEGER;
BEGIN
  IF EXISTS (SELECT 1 FROM public.profiles WHERE id = p_user_id) THEN
    RETURN;
  END IF;

  SELECT raw_user_meta_data, email INTO v_meta, v_email
  FROM auth.users WHERE id = p_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Utilisateur inconnu';
  END IF;

  v_username := v_meta->>'username';
  IF v_username IS NULL OR v_username !~ '^[a-zA-Z0-9_-]{3,24}$' THEN
    -- Partie avant le @ de l'e-mail, nettoyée
    v_username := left(regexp_replace(split_part(COALESCE(v_email, ''), '@', 1), '[^a-zA-Z0-9_-]', '', 'g'), 24);
  END IF;
  IF v_username IS NULL OR char_length(v_username) < 3
     OR EXISTS (SELECT 1 FROM public.profiles WHERE lower(username) = lower(v_username)) THEN
    v_username := 'collecteur_' || substr(p_user_id::text, 1, 8);
  END IF;

  SELECT COALESCE(
    (SELECT value_int FROM public.game_settings WHERE key = 'signup_poubelles'),
    100
  ) INTO v_poubelles;

  INSERT INTO public.profiles (id, username, poubelles, boosters_stored, last_booster_tick)
  VALUES (p_user_id, v_username, v_poubelles, 2, now())
  ON CONFLICT (id) DO NOTHING;

  IF FOUND THEN
    INSERT INTO public.transactions (user_id, amount, balance_after, operation_type)
    VALUES (p_user_id, v_poubelles, v_poubelles, 'signup_bonus');
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public._create_missing_profile(UUID) FROM PUBLIC, anon, authenticated;

-- Appelée par le site quand l'utilisateur connecté n'a pas de profil
CREATE OR REPLACE FUNCTION public.ensure_my_profile()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Connexion requise';
  END IF;
  PERFORM public._create_missing_profile(auth.uid());
END;
$$;

REVOKE ALL ON FUNCTION public.ensure_my_profile() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ensure_my_profile() TO authenticated;

-- Le trigger d'inscription passe par la même fonction : un pseudonyme déjà
-- pris ou invalide ne fait plus échouer la création du compte.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public._create_missing_profile(NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Rattrapage : crée les profils de tous les comptes existants qui n'en ont pas
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT u.id FROM auth.users u
    LEFT JOIN public.profiles p ON p.id = u.id
    WHERE p.id IS NULL
    ORDER BY u.created_at
  LOOP
    PERFORM public._create_missing_profile(r.id);
  END LOOP;
END;
$$;
