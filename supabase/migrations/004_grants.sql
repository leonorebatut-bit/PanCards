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

-- Tables et vues : lecture pour les visiteurs, lecture/écriture (filtrée par
-- RLS) pour les membres connectés
GRANT SELECT ON ALL TABLES IN SCHEMA public TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
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

-- Tables créées plus tard : mêmes droits par défaut
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO authenticated;
