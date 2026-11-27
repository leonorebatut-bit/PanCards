import { supabase } from './supabase';

/**
 * Tant qu'une pancarte proposée est en attente, `image_url` et `thumb_url`
 * contiennent le chemin du fichier dans le bucket privé « submissions »
 * (voir supabase/migrations/002_rpc_and_fixes.sql). Une fois validée, ce
 * sont des URL publiques du bucket « pancartes ».
 */
export const SUBMISSIONS_BUCKET = 'submissions';
export const PUBLIC_BUCKET = 'pancartes';

export function isStoragePath(value: string): boolean {
  return !/^https?:\/\//i.test(value);
}

/** Génère une miniature JPEG (480 px de large max). Renvoie null si le navigateur ne sait pas décoder l'image. */
export async function createThumbnail(file: File, maxWidth = 480): Promise<Blob | null> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxWidth / bitmap.width);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    return await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((blob) => resolve(blob), 'image/jpeg', 0.8)
    );
  } catch {
    return null;
  }
}

/** Crée des URL signées (1 h) pour les chemins du bucket « submissions ». */
export async function signSubmissionPaths(paths: string[]): Promise<Record<string, string>> {
  const unique = Array.from(new Set(paths.filter(isStoragePath)));
  if (unique.length === 0) return {};

  const { data, error } = await supabase.storage
    .from(SUBMISSIONS_BUCKET)
    .createSignedUrls(unique, 3600);

  if (error || !data) return {};

  const map: Record<string, string> = {};
  for (const item of data) {
    if (item.path && item.signedUrl) map[item.path] = item.signedUrl;
  }
  return map;
}

/**
 * Copie un fichier du bucket privé « submissions » vers le bucket public
 * « pancartes » (réservé aux administrateurs) et renvoie son URL publique.
 */
export async function publishSubmissionFile(path: string): Promise<string> {
  const destination = `submissions/${path}`;
  const { error } = await supabase.storage
    .from(SUBMISSIONS_BUCKET)
    .copy(path, destination, { destinationBucket: PUBLIC_BUCKET });

  // Fichier déjà copié lors d'une tentative précédente : on le réutilise
  if (error && !/exist/i.test(error.message)) {
    throw new Error(`Copie de l'image impossible : ${error.message}`);
  }

  const { data } = supabase.storage.from(PUBLIC_BUCKET).getPublicUrl(destination);
  return data.publicUrl;
}
