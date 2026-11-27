# Légendes et visages floutés

Deux outils pour les photos de pancartes, qui fonctionnent avec des modèles
gratuits de Hugging Face, sur un ordinateur normal (sans carte graphique).

## 1. Lire le texte des pancartes : `analyse.py`

Modèle : [Qwen2.5-VL-3B-Instruct](https://huggingface.co/Qwen/Qwen2.5-VL-3B-Instruct)
(gratuit, licence Apache 2.0). Il lit le texte écrit sur la pancarte et décrit la
photo. Résultat : `data/pancartes_legendes.csv`, une ligne par photo.

| Colonne | Contenu |
|---|---|
| `fichier` | nom de la photo dans le stockage (`pancarte005.avif`…) |
| `texte_pancarte` | texte de la pancarte principale (sert de légende) |
| `autres_pancartes` | texte d'autres pancartes visibles |
| `nb_pancartes_visibles`, `support`, `ecriture` | carton, papier, tissu… ; manuscrite ou imprimée |
| `dessins`, `description_dessins` | présence et description des dessins ou symboles |
| `couleurs` | couleurs principales |
| `niveau_travail_1a5` | 1 = quelques mots griffonnés, 5 = très travaillée, illustrée |
| `humour_jeu_de_mots` | oui / non |
| `nb_personnes_visibles`, `personne_tenant_visible` | |
| `genre_apparent_estimation`, `tranche_age_apparente_estimation` | **estimation d'apparence seulement** |
| `visage_deja_masque` | le visage était déjà flouté ou caché sur la photo d'origine |
| `contexte` | courte description de la scène |

Limites : le modèle peut se tromper sur l'écriture manuscrite (lettres
oubliées, mots inversés), surtout sur les petites photos. Le genre et l'âge
ne sont que des estimations d'après l'apparence : elles sont souvent fausses,
ne disent rien de l'identité réelle des personnes, et doivent rester un
indicateur statistique grossier, jamais une information affichée sur le site.

Relancer : `python analyse.py <dossier_photos> data/pancartes_legendes.csv`
(le script reprend là où il s'est arrêté).

## 2. Flouter les visages : `flouter_visages.py`

Détecteur : [YuNet](https://huggingface.co/opencv/face_detection_yunet) (OpenCV, gratuit).
Chaque photo est analysée deux fois (taille normale et agrandie) pour
trouver aussi les petits visages dans les foules. Le script **ne modifie pas**
les photos d'origine : il crée des copies floutées dans un dossier `floutees/`
(`originals/` et `thumbs/`), et un `rapport_visages.csv` (nombre de visages
floutés par photo).

Limites : un visage de profil, très petit ou en partie caché peut être raté ;
les photos avec « 0 visage » dans le rapport méritent un coup d'œil rapide.

## 3. Mettre en ligne (à faire par la propriétaire du projet Supabase)

`generer_sql.py` fabrique les fichiers SQL de `supabase/scripts/` :

- `legendes.sql` : remplit la description des cartes **qui n'en ont pas encore**
  avec le texte lu. Le site affiche déjà cette description sur la fiche de la carte.
- `photos_floutees.sql` : fait afficher au site les copies floutées
  (après avoir envoyé le dossier `floutees/` dans le bucket `pancartes`).
  Il garde l'ancienne adresse de chaque photo dans deux colonnes de sauvegarde.
- `photos_floutees_annuler.sql` : revient aux photos d'origine.

Les nouvelles pancartes proposées sur le site ne passent pas par ce script :
il faudra le relancer de temps en temps (ou ajouter le floutage à l'envoi).
