"""
Lit le texte de chaque pancarte et décrit la photo avec un modèle gratuit de
Hugging Face (Qwen2.5-VL-3B-Instruct), puis écrit data/pancartes_legendes.csv.

Usage : python analyse.py <dossier_images> <fichier_csv_sortie>
Le dossier contient les photos nommées comme dans le bucket (pancarte005.avif…).
Le script reprend là où il s'est arrêté si le CSV existe déjà.
"""
import csv
import json
import os
import re
import sys
import time

import pillow_avif  # noqa: F401  (lecture des .avif)
import torch
from PIL import Image
from transformers import AutoProcessor, Qwen2_5_VLForConditionalGeneration

MODEL_ID = "Qwen/Qwen2.5-VL-3B-Instruct"
MAX_SIDE = 896  # résolution de travail : assez pour lire l'écriture manuscrite

PROMPT = """Tu regardes une photo de manifestation. Réponds UNIQUEMENT avec un objet JSON valide, sans texte autour :
{
 "texte_pancarte": "le texte écrit sur la pancarte principale, recopié exactement, lignes séparées par ' / ' ; chaîne vide si illisible",
 "autres_pancartes": "texte lisible d'autres pancartes visibles, séparées par ' | ' ; chaîne vide sinon",
 "nb_pancartes_visibles": nombre entier,
 "support": "carton | papier | tissu | panneau imprimé | autre",
 "ecriture": "manuscrite | imprimée | mixte",
 "dessins": true ou false,
 "description_dessins": "description courte des dessins ou symboles, chaîne vide sinon",
 "couleurs": "couleurs principales de la pancarte (texte et fond), en français",
 "niveau_travail": 1 à 5 (1 = quelques mots griffonnés, 3 = soigné avec couleurs, 5 = très travaillé, illustré, artistique),
 "humour_jeu_de_mots": true ou false,
 "nb_personnes_visibles": nombre entier,
 "personne_tenant_visible": true ou false,
 "genre_apparent": "femme | homme | indéterminé",
 "tranche_age_apparente": "enfant | ado | 18-30 | 30-50 | 50+ | indéterminé",
 "visage_deja_masque": true ou false,
 "contexte": "description très courte de la scène (lieu, foule, etc.)"
}
Pour le genre et l'âge, décris seulement l'apparence de la personne qui tient la pancarte principale ; si elle n'est pas visible ou si c'est incertain, mets "indéterminé"."""

COLUMNS = [
    "fichier", "texte_pancarte", "autres_pancartes", "nb_pancartes_visibles",
    "support", "ecriture", "dessins", "description_dessins", "couleurs",
    "niveau_travail_1a5", "humour_jeu_de_mots", "nb_personnes_visibles",
    "personne_tenant_visible", "genre_apparent_estimation",
    "tranche_age_apparente_estimation", "visage_deja_masque", "contexte",
]


def load_image(path):
    im = Image.open(path).convert("RGB")
    im.thumbnail((MAX_SIDE, MAX_SIDE))
    return im


def parse_json(text):
    m = re.search(r"\{.*\}", text, re.S)
    if not m:
        return None
    raw = m.group(0)
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        raw = re.sub(r",\s*}", "}", raw.replace("True", "true").replace("False", "false"))
        try:
            return json.loads(raw)
        except json.JSONDecodeError:
            return None


def to_row(fname, d):
    def b(v):
        if isinstance(v, bool):
            return "oui" if v else "non"
        return str(v or "")
    return {
        "fichier": fname,
        "texte_pancarte": d.get("texte_pancarte", ""),
        "autres_pancartes": d.get("autres_pancartes", ""),
        "nb_pancartes_visibles": d.get("nb_pancartes_visibles", ""),
        "support": d.get("support", ""),
        "ecriture": d.get("ecriture", ""),
        "dessins": b(d.get("dessins")),
        "description_dessins": d.get("description_dessins", ""),
        "couleurs": d.get("couleurs", ""),
        "niveau_travail_1a5": d.get("niveau_travail", ""),
        "humour_jeu_de_mots": b(d.get("humour_jeu_de_mots")),
        "nb_personnes_visibles": d.get("nb_personnes_visibles", ""),
        "personne_tenant_visible": b(d.get("personne_tenant_visible")),
        "genre_apparent_estimation": d.get("genre_apparent", ""),
        "tranche_age_apparente_estimation": d.get("tranche_age_apparente", ""),
        "visage_deja_masque": b(d.get("visage_deja_masque")),
        "contexte": d.get("contexte", ""),
    }


def main():
    img_dir, out_csv = sys.argv[1], sys.argv[2]
    files = sorted(f for f in os.listdir(img_dir) if not f.startswith("."))
    if len(sys.argv) > 3:
        files = files[: int(sys.argv[3])]

    done = set()
    if os.path.exists(out_csv):
        with open(out_csv, newline="", encoding="utf-8") as fh:
            done = {r["fichier"] for r in csv.DictReader(fh)}

    torch.set_num_threads(os.cpu_count() or 4)
    model = Qwen2_5_VLForConditionalGeneration.from_pretrained(MODEL_ID, torch_dtype=torch.bfloat16)
    processor = AutoProcessor.from_pretrained(MODEL_ID)

    new_file = not os.path.exists(out_csv)
    with open(out_csv, "a", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=COLUMNS)
        if new_file:
            w.writeheader()
        for fname in files:
            if fname in done:
                continue
            t0 = time.time()
            msgs = [{"role": "user", "content": [{"type": "image"}, {"type": "text", "text": PROMPT}]}]
            text = processor.apply_chat_template(msgs, add_generation_prompt=True)
            inputs = processor(text=[text], images=[load_image(os.path.join(img_dir, fname))], return_tensors="pt")
            d = None
            # 2e essai avec une pénalité de répétition : le modèle boucle parfois sur une ligne
            for penalite in (1.0, 1.3):
                with torch.no_grad():
                    out = model.generate(**inputs, max_new_tokens=600, do_sample=False, repetition_penalty=penalite)
                answer = processor.batch_decode(out[:, inputs["input_ids"].shape[1]:], skip_special_tokens=True)[0]
                d = parse_json(answer)
                if d is not None:
                    break
            if d is None:
                print(f"{fname}: réponse non JSON, texte brut gardé", flush=True)
                d = {"texte_pancarte": answer.strip()[:500]}
            w.writerow(to_row(fname, d))
            fh.flush()
            print(f"{fname} ({time.time() - t0:.0f}s) : {d.get('texte_pancarte', '')[:80]}", flush=True)


if __name__ == "__main__":
    main()
