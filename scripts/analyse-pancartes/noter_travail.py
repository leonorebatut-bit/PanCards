"""
2e passage : note plus finement « à quel point la pancarte est travaillée ».
Dans la grande question d'analyse.py, le modèle
mettait presque toujours 4 ; une question courte avec des repères marche mieux.

Usage : python noter_travail.py <dossier_images> data/pancartes_legendes.csv
Met à jour la colonne niveau_travail_1a5 du CSV.
"""
import csv
import os
import re
import sys
import time

import torch
from transformers import AutoProcessor, Qwen2_5_VLForConditionalGeneration

from analyse import MODEL_ID, load_image

PROMPT = """Regarde la pancarte principale de cette photo. À quel point la pancarte est travaillée, de 1 à 5 :
1 = quelques mots griffonnés au feutre noir, sans soin
2 = texte simple, lisible, une seule couleur
3 = texte soigné, ou plusieurs couleurs, ou mise en page réfléchie
4 = plusieurs couleurs ET lettrage travaillé, ou un petit dessin
5 = très travaillée : grande illustration, peinture, collage, vrai travail artistique
Réponds seulement par le chiffre."""



def demander(model, processor, image, question):
    msgs = [{"role": "user", "content": [{"type": "image"}, {"type": "text", "text": question}]}]
    text = processor.apply_chat_template(msgs, add_generation_prompt=True)
    inputs = processor(text=[text], images=[image], return_tensors="pt")
    with torch.no_grad():
        out = model.generate(**inputs, max_new_tokens=5, do_sample=False)
    return processor.batch_decode(out[:, inputs["input_ids"].shape[1]:], skip_special_tokens=True)[0].strip()


def main():
    img_dir, csv_path = sys.argv[1], sys.argv[2]
    rows = list(csv.DictReader(open(csv_path, encoding="utf-8")))
    fields = list(rows[0].keys())
    torch.set_num_threads(os.cpu_count() or 4)
    model = Qwen2_5_VLForConditionalGeneration.from_pretrained(MODEL_ID, torch_dtype=torch.bfloat16)
    processor = AutoProcessor.from_pretrained(MODEL_ID)
    for i, r in enumerate(rows):
        t0 = time.time()
        image = load_image(os.path.join(img_dir, r["fichier"]))
        ans = demander(model, processor, image, PROMPT)
        m = re.search(r"[1-5]", ans)
        if m:
            r["niveau_travail_1a5"] = m.group(0)
        print(f"{r['fichier']} ({time.time() - t0:.0f}s) : {ans.strip()}", flush=True)
        if i % 10 == 9 or i == len(rows) - 1:
            with open(csv_path, "w", newline="", encoding="utf-8") as fh:
                w = csv.DictWriter(fh, fieldnames=fields)
                w.writeheader()
                w.writerows(rows)


if __name__ == "__main__":
    main()
