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
export async function signSubmissionPaths(
  paths: string[]
): Promise<{ urls: Record<string, string>; failed: number }> {
  const unique = Array.from(new Set(paths.filter(isStoragePath)));
  if (unique.length === 0) return { urls: {}, failed: 0 };

  const { data, error } = await supabase.storage
    .from(SUBMISSIONS_BUCKET)
    .createSignedUrls(unique, 3600);

  if (error || !data) return { urls: {}, failed: unique.length };

  const urls: Record<string, string> = {};
  for (const item of data) {
    if (item.path && item.signedUrl) urls[item.path] = item.signedUrl;
  }
  return { urls, failed: unique.length - Object.keys(urls).length };
}

export interface PublishedFile {
  /** Chemin dans le bucket public « pancartes » */
  path: string;
  publicUrl: string;
}

/**
 * Copie un fichier du bucket privé « submissions » vers le bucket public
 * « pancartes » (réservé aux administrateurs) et renvoie son URL publique.
 */
export async function publishSubmissionFile(path: string): Promise<PublishedFile> {
  const destination = `submissions/${path}`;
  const { error } = await supabase.storage
    .from(SUBMISSIONS_BUCKET)
    .copy(path, destination, { destinationBucket: PUBLIC_BUCKET });

  if (error) {
    // Seul cas accepté : la copie existe déjà (tentative précédente interrompue).
    // On le vérifie dans le bucket public avant de la réutiliser.
    const folder = destination.slice(0, destination.lastIndexOf('/'));
    const fileName = destination.slice(destination.lastIndexOf('/') + 1);
    const { data: existing } = await supabase.storage
      .from(PUBLIC_BUCKET)
      .list(folder, { search: fileName, limit: 10 });
    if (!existing?.some((f) => f.name === fileName)) {
      throw new Error(`Copie de l'image impossible : ${error.message}`);
    }
  }

  const { data } = supabase.storage.from(PUBLIC_BUCKET).getPublicUrl(destination);
  return { path: destination, publicUrl: data.publicUrl };
}

/** Supprime des copies publiques (si la modération échoue après la copie). */
export async function removePublishedFiles(paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  await supabase.storage.from(PUBLIC_BUCKET).remove(paths);
}
