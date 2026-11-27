-- Revient aux photos d'origine (non floutées).
BEGIN;
UPDATE public.cards SET
  image_url = original_image_url_backup, thumb_url = original_thumb_url_backup
WHERE original_image_url_backup IS NOT NULL;
COMMIT;
