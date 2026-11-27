import fs from 'node:fs/promises';
import path from 'node:path';
import dotenv from 'dotenv';
import sharp from 'sharp';
import { createClient } from '@supabase/supabase-js';

dotenv.config();

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SOURCE_DIR = path.resolve(process.cwd(), 'Pancartes');
const BUCKET_NAME = 'pancartes';

const MIME_BY_EXT: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
};

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error(
    'Erreur : VITE_SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY doivent être définis dans .env'
  );
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

// Tri naturel : pancarte1, pancarte2, ..., pancarte10
function naturalCompare(a: string, b: string): number {
  return a.localeCompare(b, 'fr', { numeric: true, sensitivity: 'base' });
}

async function runImport() {
  console.log(`Lecture du dossier : ${SOURCE_DIR}`);

  let entries: string[];
  try {
    entries = await fs.readdir(SOURCE_DIR);
  } catch (err) {
    console.error(`Impossible d'ouvrir le dossier ${SOURCE_DIR} :`, err);
    process.exit(1);
  }

  const imageFiles = entries
    .filter((file) => {
      const ext = path.extname(file).toLowerCase();
      return ext in MIME_BY_EXT;
    })
    .sort(naturalCompare);

  if (imageFiles.length === 0) {
    console.log('Aucun fichier image compatible (JPG, PNG, WEBP, AVIF) trouvé dans Pancartes/.');
    return;
  }

  console.log(`${imageFiles.length} fichiers image détectés.\n`);

  // Récupération des noms de fichiers déjà importés pour éviter tout doublon
  const { data: existingRows, error: fetchError } = await supabase
    .from('cards')
    .select('original_filename');

  if (fetchError) {
    console.error('Erreur lors de la lecture de la table cards :', fetchError.message);
    process.exit(1);
  }

  const existingSet = new Set(
    (existingRows ?? []).map((row) => row.original_filename.toLowerCase())
  );

  let importedCount = 0;
  let skippedCount = 0;
  const failedFiles: { file: string; reason: string }[] = [];

  for (const filename of imageFiles) {
    if (existingSet.has(filename.toLowerCase())) {
      skippedCount++;
      console.log(`[IGNORÉ - DÉJÀ PRÉSENT] ${filename}`);
      continue;
    }

    const fullPath = path.join(SOURCE_DIR, filename);
    const ext = path.extname(filename).toLowerCase();
    const originalContentType = MIME_BY_EXT[ext] ?? 'application/octet-stream';

    try {
      const originalBuffer = await fs.readFile(fullPath);

      // Génération de la miniature en JPEG (largeur max 480px, orientation EXIF préservée)
      const thumbBuffer = await sharp(originalBuffer)
        .rotate()
        .resize({ width: 480, withoutEnlargement: true })
        .jpeg({ quality: 80, progressive: true })
        .toBuffer();

      const baseSlug = path.parse(filename).name.replace(/[^a-zA-Z0-9_-]/g, '_');
      const originalStoragePath = `originals/${baseSlug}${ext}`;
      const thumbStoragePath = `thumbs/${baseSlug}_thumb.jpg`;

      // 1. Upload du fichier original intact
      const { error: origUploadError } = await supabase.storage
        .from(BUCKET_NAME)
        .upload(originalStoragePath, originalBuffer, {
          contentType: originalContentType,
          upsert: true,
        });

      if (origUploadError) {
        throw new Error(`Upload original échoué : ${origUploadError.message}`);
      }

      // 2. Upload de la miniature
      const { error: thumbUploadError } = await supabase.storage
        .from(BUCKET_NAME)
        .upload(thumbStoragePath, thumbBuffer, {
          contentType: 'image/jpeg',
          upsert: true,
        });

      if (thumbUploadError) {
        throw new Error(`Upload miniature échoué : ${thumbUploadError.message}`);
      }

      // 3. Récupération des URL publiques
      const { data: origUrlData } = supabase.storage
        .from(BUCKET_NAME)
        .getPublicUrl(originalStoragePath);

      const { data: thumbUrlData } = supabase.storage
        .from(BUCKET_NAME)
        .getPublicUrl(thumbStoragePath);

      // 4. Insertion en base (sans inventer de description ni de métadonnées)
      const { error: insertError } = await supabase.from('cards').insert({
        original_filename: filename,
        image_url: origUrlData.publicUrl,
        thumb_url: thumbUrlData.publicUrl,
        description: null,
        extra_info: null,
        status: 'published',
        published_at: new Date().toISOString(),
      });

      if (insertError) {
        throw new Error(`Insertion BDD échouée : ${insertError.message}`);
      }

      importedCount++;
      console.log(`[IMPORTÉ] ${filename}`);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      failedFiles.push({ file: filename, reason });
      console.error(`[ÉCHEC] ${filename} -> ${reason}`);
    }
  }

  console.log('\n========================================');
  console.log('RÉSUMÉ DE L’IMPORTATION');
  console.log(`- Importés avec succès : ${importedCount}`);
  console.log(`- Ignorés (déjà présents) : ${skippedCount}`);
  console.log(`- Échecs : ${failedFiles.length}`);
  if (failedFiles.length > 0) {
    console.log('\nDétail des échecs :');
    for (const item of failedFiles) {
      console.log(`  * ${item.file} : ${item.reason}`);
    }
  }
  console.log('========================================');
}

runImport();
