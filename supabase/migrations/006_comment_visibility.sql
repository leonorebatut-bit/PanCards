-- ============================================================================
-- 006 : légendes / commentaires publics ou privés
-- Un commentaire privé n'est visible que par son auteur (et les admins).
-- Peut être exécuté plusieurs fois sans risque.
-- ============================================================================

ALTER TABLE public.comments
  ADD COLUMN IF NOT EXISTS is_public BOOLEAN NOT NULL DEFAULT true;

DROP POLICY IF EXISTS "Lecture des commentaires" ON public.comments;
CREATE POLICY "Lecture des commentaires"
  ON public.comments FOR SELECT
  USING (is_public OR user_id = auth.uid() OR public.is_current_user_admin());

-- L'auteur peut passer son commentaire de public à privé (et inversement),
-- sans pouvoir modifier les autres colonnes
REVOKE UPDATE ON public.comments FROM authenticated;
GRANT UPDATE (is_public) ON public.comments TO authenticated;

-- Nouvelle version de add_card_comment avec le choix public / privé
DROP FUNCTION IF EXISTS public.add_card_comment(INTEGER, TEXT);
DROP FUNCTION IF EXISTS public.add_card_comment(INTEGER, TEXT, BOOLEAN);

CREATE FUNCTION public.add_card_comment(
  p_card_id INTEGER,
  p_content TEXT,
  p_is_public BOOLEAN DEFAULT true
)
RETURNS TABLE (comment_id UUID, reward_granted BOOLEAN)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := public._require_active_user();
  v_reward INTEGER := GREATEST(public._game_setting('comment_reward', 1), 0);
  v_content TEXT := trim(COALESCE(p_content, ''));
  v_id UUID;
  v_claimed BOOLEAN := false;
BEGIN
  IF char_length(v_content) < 1 OR char_length(v_content) > 1000 THEN
    RAISE EXCEPTION 'Le commentaire doit contenir entre 1 et 1000 caractères.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.cards c WHERE c.id = p_card_id AND c.status = 'published') THEN
    RAISE EXCEPTION 'Pancarte introuvable.';
  END IF;

  INSERT INTO public.comments (user_id, card_id, content, is_public)
  VALUES (v_uid, p_card_id, v_content, COALESCE(p_is_public, true))
  RETURNING id INTO v_id;

  INSERT INTO public.reward_claims (user_id, card_id, kind)
  VALUES (v_uid, p_card_id, 'comment')
  ON CONFLICT DO NOTHING
  RETURNING true INTO v_claimed;

  IF COALESCE(v_claimed, false) THEN
    UPDATE public.comments SET reward_claimed = true WHERE id = v_id;
    IF v_reward > 0 THEN
      PERFORM public._apply_poubelles(v_uid, v_reward, 'comment_card', p_card_id);
    END IF;
  END IF;

  comment_id := v_id;
  reward_granted := COALESCE(v_claimed, false) AND v_reward > 0;
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.add_card_comment(INTEGER, TEXT, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.add_card_comment(INTEGER, TEXT, BOOLEAN) TO authenticated;
