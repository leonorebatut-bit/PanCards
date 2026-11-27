"""
Génère les deux fichiers SQL à coller dans l'éditeur SQL de Supabase :
  supabase/scripts/legendes.sql          remplit cards.description avec le texte lu
  supabase/scripts/photos_floutees.sql   fait pointer le site vers les copies floutées
  supabase/scripts/photos_floutees_annuler.sql   revient aux photos d'origine

Usage : python generer_sql.py data/pancartes_legendes.csv <dossier_racine_repo>
"""
import csv
import os
import sys

BASE = "https://etlemwhdvhzdhpbqlcyf.supabase.co/storage/v1/object/public/pancartes"


def q(s):
    return "'" + s.replace("'", "''") + "'"


def main():
    csv_path, root = sys.argv[1], sys.argv[2]
    rows = list(csv.DictReader(open(csv_path, encoding="utf-8")))
    out_dir = os.path.join(root, "supabase", "scripts")

    leg = [
        "-- Légendes lues automatiquement sur les pancartes (modèle Qwen2.5-VL, Hugging Face).",
        "-- Ne remplace QUE les cartes sans description : les textes déjà saisis sont gardés.",
        "BEGIN;",
    ]
    flou = [
        "-- Fait afficher au site les copies floutées (dossier floutees/ du bucket pancartes).",
        "-- À lancer SEULEMENT après avoir envoyé le dossier floutees/ dans le bucket.",
        "-- Les photos d'origine ne sont pas supprimées : photos_floutees_annuler.sql revient en arrière.",
        "BEGIN;",
    ]
    for r in rows:
        slug = os.path.splitext(r["fichier"])[0].removesuffix("_thumb")
        thumb = f"{BASE}/thumbs/{slug}_thumb.jpg"
        texte = (r["texte_pancarte"] or "").strip()
        if texte:
            leg.append(
                f"UPDATE public.cards SET description = {q(texte[:500])} "
                f"WHERE thumb_url = {q(thumb)} AND coalesce(description, '') = '';"
            )
        flou.append(
            f"UPDATE public.cards SET image_url = {q(f'{BASE}/floutees/originals/{slug}.jpg')}, "
            f"thumb_url = {q(f'{BASE}/floutees/thumbs/{slug}_thumb.jpg')} WHERE thumb_url = {q(thumb)};"
        )
    leg.append("COMMIT;")
    flou.append("COMMIT;")

    annuler = [
        "-- Revient aux photos d'origine (non floutées).",
        "BEGIN;",
        "UPDATE public.cards SET",
        f"  image_url = original_image_url_backup, thumb_url = original_thumb_url_backup",
        "WHERE original_image_url_backup IS NOT NULL;",
        "COMMIT;",
    ]
    # Sauvegarde des anciennes adresses avant bascule, pour pouvoir annuler.
    flou[4:4] = [
        "ALTER TABLE public.cards ADD COLUMN IF NOT EXISTS original_image_url_backup TEXT;",
        "ALTER TABLE public.cards ADD COLUMN IF NOT EXISTS original_thumb_url_backup TEXT;",
        "UPDATE public.cards SET original_image_url_backup = image_url, original_thumb_url_backup = thumb_url",
        "WHERE original_image_url_backup IS NULL;",
    ]

    for name, lines in (("legendes.sql", leg), ("photos_floutees.sql", flou), ("photos_floutees_annuler.sql", annuler)):
        with open(os.path.join(out_dir, name), "w", encoding="utf-8") as fh:
            fh.write("\n".join(lines) + "\n")
        print(name, len(lines))


if __name__ == "__main__":
    main()
