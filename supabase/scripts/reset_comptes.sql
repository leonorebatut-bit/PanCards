-- ============================================================================
-- REMISE À ZÉRO DE TOUS LES COMPTES JOUEURS
-- ⚠ IRRÉVERSIBLE : supprime TOUS les comptes (y compris le tien), leurs
-- profils, collections, boosters, notes, commentaires, vitrines,
-- transactions et propositions de pancartes.
-- Les pancartes publiées du catalogue sont conservées.
-- À exécuter dans Supabase › SQL Editor, puis se réinscrire sur le site.
-- ============================================================================

BEGIN;

-- Supprimer les comptes supprime aussi, en cascade, les profils et toutes
-- les données de jeu qui en dépendent.
DELETE FROM auth.users;

-- Par sécurité : profils orphelins éventuels
DELETE FROM public.profiles;

COMMIT;

-- Vérification : les deux nombres doivent être 0
SELECT
  (SELECT count(*) FROM auth.users)      AS comptes_restants,
  (SELECT count(*) FROM public.profiles) AS profils_restants;
