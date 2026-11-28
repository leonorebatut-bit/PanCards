"""
Floute les visages de toutes les photos et écrit des copies floutées, sans
toucher aux originaux.

Détecteur : YuNet (OpenCV, gratuit, hébergé sur Hugging Face : opencv/face_detection_yunet).
Chaque image est analysée à sa taille normale puis agrandie x2 pour attraper
les petits visages dans les foules.

Usage : python flouter_visages.py <dossier_images> <dossier_sortie>
Sortie :
  <sortie>/originals/<nom>.jpg          photo floutée (pleine taille)
  <sortie>/thumbs/<nom>_thumb.jpg       miniature floutée (480 px de large)
  <sortie>/rapport_visages.csv          nombre de visages floutés par photo
"""
import csv
import os
import sys

import cv2
import numpy as np
import pillow_avif  # noqa: F401
from huggingface_hub import hf_hub_download
from PIL import Image, ImageOps

SCORE_MIN = 0.45
GRAND_SCORE_MIN = 0.75
MARGE = 0.35  # agrandit la zone floutée autour du visage détecté


def detecteur():
    path = hf_hub_download("opencv/face_detection_yunet", "face_detection_yunet_2023mar.onnx")
    return cv2.FaceDetectorYN.create(path, "", (320, 320), SCORE_MIN, 0.3, 5000)


def detecter(det, bgr):
    boites = []
    h, w = bgr.shape[:2]
    for echelle in (1.0, 2.0):
        img = bgr if echelle == 1.0 else cv2.resize(bgr, None, fx=echelle, fy=echelle, interpolation=cv2.INTER_CUBIC)
        # YuNet travaille mieux sur des images de taille raisonnable
        if max(img.shape[:2]) > 2400:
            continue
        det.setInputSize((img.shape[1], img.shape[0]))
        _, faces = det.detect(img)
        if faces is None:
            continue
        for f in faces:
            x, y, fw, fh = (f[:4] / echelle).tolist()
            # Les grandes détections peu sûres sont souvent des pancartes prises pour des visages :
            # on exige un score élevé pour un « visage » de plus de 12 % de la largeur de la photo.
            if fw / w > 0.12 and f[-1] < GRAND_SCORE_MIN:
                continue
            boites.append((x, y, fw, fh))
    # fusion des doublons entre les deux échelles
    gardees = []
    for b in sorted(boites, key=lambda b: -b[2] * b[3]):
        if all(iou(b, g) < 0.3 for g in gardees):
            gardees.append(b)
    return [(max(0, x), max(0, y), min(fw, w - x), min(fh, h - y)) for x, y, fw, fh in gardees]


def iou(a, b):
    ax2, ay2, bx2, by2 = a[0] + a[2], a[1] + a[3], b[0] + b[2], b[1] + b[3]
    iw = max(0, min(ax2, bx2) - max(a[0], b[0]))
    ih = max(0, min(ay2, by2) - max(a[1], b[1]))
    inter = iw * ih
    return inter / (a[2] * a[3] + b[2] * b[3] - inter + 1e-9)


def flouter(bgr, boites):
    out = bgr.copy()
    h, w = bgr.shape[:2]
    for x, y, fw, fh in boites:
        mx, my = fw * MARGE, fh * MARGE
        x0, y0 = int(max(0, x - mx)), int(max(0, y - my * 1.3))
        x1, y1 = int(min(w, x + fw + mx)), int(min(h, y + fh + my))
        if x1 - x0 < 2 or y1 - y0 < 2:
            continue
        zone = out[y0:y1, x0:x1]
        k = max(15, (max(x1 - x0, y1 - y0) // 2) | 1)
        floue = cv2.GaussianBlur(zone, (k, k), 0)
        floue = cv2.GaussianBlur(floue, (k, k), 0)
        masque = np.zeros(zone.shape[:2], np.uint8)
        cv2.ellipse(masque, ((x1 - x0) // 2, (y1 - y0) // 2), ((x1 - x0) // 2, (y1 - y0) // 2), 0, 0, 360, 255, -1)
        masque = cv2.GaussianBlur(masque, (0, 0), max(1, (x1 - x0) / 20))[..., None] / 255.0
        out[y0:y1, x0:x1] = (floue * masque + zone * (1 - masque)).astype(np.uint8)
    return out


def main():
    src, dst = sys.argv[1], sys.argv[2]
    os.makedirs(os.path.join(dst, "originals"), exist_ok=True)
    os.makedirs(os.path.join(dst, "thumbs"), exist_ok=True)
    det = detecteur()
    lignes = []
    for fname in sorted(os.listdir(src)):
        if fname.startswith("."):
            continue
        nom = os.path.splitext(fname)[0].removesuffix("_thumb")  # photos dont seule la miniature est publique
        pil = ImageOps.exif_transpose(Image.open(os.path.join(src, fname))).convert("RGB")
        bgr = cv2.cvtColor(np.array(pil), cv2.COLOR_RGB2BGR)
        boites = detecter(det, bgr)
        res = Image.fromarray(cv2.cvtColor(flouter(bgr, boites), cv2.COLOR_BGR2RGB))
        res.save(os.path.join(dst, "originals", nom + ".jpg"), quality=90, optimize=True)
        th = res.copy()
        if th.width > 480:
            th = th.resize((480, round(th.height * 480 / th.width)), Image.LANCZOS)
        th.save(os.path.join(dst, "thumbs", nom + "_thumb.jpg"), quality=80, optimize=True, progressive=True)
        lignes.append({"fichier": fname, "visages_floutes": len(boites)})
        print(f"{fname}: {len(boites)} visage(s)", flush=True)
    with open(os.path.join(dst, "rapport_visages.csv"), "w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=["fichier", "visages_floutes"])
        w.writeheader()
        w.writerows(lignes)


if __name__ == "__main__":
    main()
