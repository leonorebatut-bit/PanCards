-- ============================================================================
-- 004 : droits d'accès aux tables pour les rôles de l'API Supabase
-- Les projets Supabase récents ne donnent plus automatiquement les droits
-- sur les tables créées en SQL aux rôles « anon » et « authenticated ».
-- Symptôme : « permission denied for table profiles ».
-- La sécurité reste assurée par les règles RLS (001, 002) : ces droits ne
-- font qu'autoriser l'API à interroger les tables, les règles décident
-- ensuite ligne par ligne.
-- Peut être exécuté plusieurs fois sans risque.
-- ============================================================================

GRANT USAGE ON SCHEMA public TO anon, authenticated;

-- Lecture (filtrée par RLS) pour les visiteurs et les membres connectés
GRANT SELECT ON ALL TABLES IN SCHEMA public TO anon, authenticated;

-- Écriture directe uniquement là où le site écrit lui-même ; tout le reste
-- (boosters, notes, commentaires, vitrine, propositions…) passe par les
-- fonctions sécurisées de 002 et 003.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
GRANT UPDATE ON public.profiles TO authenticated;
GRANT DELETE ON public.comments TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.collections TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.collection_cards TO authenticated;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;

-- Exception conservée (002) : statistiques brutes des notes, accessibles
-- uniquement via get_card_rating_summary()
REVOKE ALL ON public.card_rating_stats FROM anon, authenticated;

-- Fonctions utilisées dans les règles RLS : appelées avec les droits de
-- l'utilisateur, elles doivent rester exécutables
GRANT EXECUTE ON FUNCTION public.is_current_user_admin() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_current_user_active() TO anon, authenticated;

-- Fonctions appelées par le site (rappel des droits de 002 et 003)
GRANT EXECUTE ON FUNCTION public.open_booster() TO authenticated;
GRANT EXECUTE ON FUNCTION public.buy_booster() TO authenticated;
GRANT EXECUTE ON FUNCTION public.sync_user_boosters() TO authenticated;
GRANT EXECUTE ON FUNCTION public.discard_user_cards(UUID[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rate_card(INTEGER, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.add_card_comment(INTEGER, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_user_showcase(INTEGER[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.submit_new_pancarte(TEXT, TEXT, TEXT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.moderate_pancarte(INTEGER, TEXT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_my_profile() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_card_rating_summary(INTEGER) TO anon, authenticated;

-- Pas de droits par défaut pour les tables créées plus tard : chaque
-- nouvelle table devra activer RLS puis recevoir ses droits explicitement.
-- (annule les droits par défaut d'une version précédente de ce script)
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE SELECT ON TABLES FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLES FROM authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE USAGE, SELECT ON SEQUENCES FROM authenticated;
