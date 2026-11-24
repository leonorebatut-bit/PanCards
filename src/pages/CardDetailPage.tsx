import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import type { Card, CardComment, CardRatingSummary } from '../types/database';

export function CardDetailPage() {
  const { cardId } = useParams<{ cardId: string }>();
  const numericId = Number(cardId);
  const { user, profile, refreshProfile } = useAuth();

  const [card, setCard] = useState<Card | null>(null);
  const [ownedCount, setOwnedCount] = useState<number>(0);
  const [ratingSummary, setRatingSummary] = useState<CardRatingSummary>({
    vote_count: 0,
    average_stars: null,
    is_public_average: false,
    user_stars: null,
  });
  const [comments, setComments] = useState<CardComment[]>([]);
  const [newComment, setNewComment] = useState('');

  const [loading, setLoading] = useState(true);
  const [ratingBusy, setRatingBusy] = useState(false);
  const [commentBusy, setCommentBusy] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const loadCardData = useCallback(async () => {
    if (!Number.isInteger(numericId) || numericId <= 0) {
      setLoading(false);
      return;
    }

    setLoading(true);
    const [cardRes, ratingRes, commentsRes] = await Promise.all([
      supabase.from('cards').select('*').eq('id', numericId).maybeSingle(),
      supabase.rpc('get_card_rating_summary', { p_card_id: numericId }),
      supabase
        .from('comments')
        .select('id, user_id, card_id, content, created_at, author:profiles(username, avatar_url)')
        .eq('card_id', numericId)
        .order('created_at', { ascending: false }),
    ]);

    if (!cardRes.error && cardRes.data) {
      setCard(cardRes.data as Card);
    } else {
      setCard(null);
    }

    if (!ratingRes.error && Array.isArray(ratingRes.data) && ratingRes.data[0]) {
      setRatingSummary(ratingRes.data[0] as CardRatingSummary);
    }

    if (!commentsRes.error && commentsRes.data) {
      setComments(commentsRes.data as unknown as CardComment[]);
    }

    if (user?.id) {
      const { count } = await supabase
        .from('user_cards')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .eq('card_id', numericId);
      setOwnedCount(count ?? 0);
    } else {
      setOwnedCount(0);
    }

    setLoading(false);
  }, [numericId, user?.id]);

  useEffect(() => {
    void loadCardData();
  }, [loadCardData]);

  const handleRate = async (stars: number) => {
    if (!user) return;
    setErrorMsg(null);
    setFeedback(null);
    setRatingBusy(true);

    const { data, error } = await supabase.rpc('rate_card', {
      p_card_id: numericId,
      p_stars: stars,
    });

    if (error) {
      setErrorMsg(error.message);
    } else if (Array.isArray(data) && data[0]) {
      const res = data[0] as {
        reward_granted: boolean;
        vote_count: number;
        average_stars: number | null;
        is_public_average: boolean;
      };
      setRatingSummary({
        vote_count: res.vote_count,
        average_stars: res.average_stars,
        is_public_average: res.is_public_average,
        user_stars: stars,
      });
      setFeedback(
        res.reward_granted
          ? `Note enregistrée (${stars}/5) — +1 poubelle gagnée !`
          : `Note mise à jour (${stars}/5).`
      );
      await refreshProfile();
    }

    setRatingBusy(false);
  };

  const handleAddComment = async (e: FormEvent) => {
    e.preventDefault();
    if (!user || !newComment.trim()) return;
    setErrorMsg(null);
    setFeedback(null);
    setCommentBusy(true);

    const { data, error } = await supabase.rpc('add_card_comment', {
      p_card_id: numericId,
      p_content: newComment.trim(),
    });

    if (error) {
      setErrorMsg(error.message);
    } else {
      const res = Array.isArray(data)
        ? (data[0] as { reward_granted: boolean })
        : null;
      setNewComment('');
      setFeedback(
        res?.reward_granted
          ? 'Commentaire publié — +1 poubelle gagnée !'
          : 'Commentaire publié.'
      );
      await loadCardData();
      await refreshProfile();
    }

    setCommentBusy(false);
  };

  const handleDeleteComment = async (commentId: string) => {
    const { error } = await supabase.from('comments').delete().eq('id', commentId);
    if (!error) {
      setComments((prev) => prev.filter((c) => c.id !== commentId));
    }
  };

  if (loading) return <p>Chargement de la pancarte...</p>;

  if (!card) {
    return (
      <div className="panel-box">
        <h2 className="hero-headline" style={{ fontSize: '1.6rem' }}>
          Pancarte introuvable
        </h2>
        <p>Cette photographie n&apos;existe pas ou n&apos;est pas encore publiée.</p>
        <Link to="/" className="btn-secondary">
          ← Retour à l&apos;archive
        </Link>
      </div>
    );
  }

  return (
    <div>
      <div style={{ marginBottom: '1rem' }}>
        <Link to="/" className="btn-secondary">
          ← Retour à l&apos;archive
        </Link>
      </div>

      {errorMsg && <div className="alert-error">{errorMsg}</div>}
      {feedback && <div className="alert-ok">{feedback}</div>}

      <section
        className="panel-box"
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(290px, 1fr))',
          gap: '1.75rem',
          alignItems: 'start',
        }}
      >
        <div
          style={{
            border: '2px solid var(--color-black)',
            backgroundColor: 'var(--color-gray-100)',
          }}
        >
          <img
            src={card.image_url}
            alt={card.original_filename}
            style={{ width: '100%', display: 'block', maxHeight: '72vh', objectFit: 'contain' }}
          />
        </div>

        <div>
          <span className="hero-kicker">
            ARCHIVE N° {String(card.id).padStart(4, '0')} · {card.status.toUpperCase()}
          </span>
          <h2
            className="hero-headline"
            style={{ fontSize: '1.65rem', margin: '0.45rem 0 0.75rem' }}
          >
            {card.original_filename}
          </h2>

          {user && (
            <div style={{ marginBottom: '1rem' }}>
              {ownedCount > 0 ? (
                <span className="badge-dup">
                  DANS TA COLLECTION : ×{ownedCount} EXEMPLAIRE(S)
                </span>
              ) : (
                <span className="badge-unique">NON POSSÉDÉE</span>
              )}
            </div>
          )}

          {card.description && (
            <p style={{ fontSize: '1rem', marginBottom: '0.75rem' }}>{card.description}</p>
          )}
          {card.extra_info && (
            <p
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '0.84rem',
                backgroundColor: 'var(--color-paper)',
                border: '1px solid var(--color-black)',
                padding: '0.6rem 0.75rem',
              }}
            >
              {card.extra_info}
            </p>
          )}

          {/* Bloc notation 1 à 5 étoiles */}
          <div
            style={{
              marginTop: '1.25rem',
              paddingTop: '1rem',
              borderTop: '2px solid var(--color-black)',
            }}
          >
            <div className="field-label">Évaluation communautaire</div>
            <p style={{ margin: '0.35rem 0 0.75rem', fontFamily: 'var(--font-mono)', fontSize: '0.86rem' }}>
              {ratingSummary.is_public_average && ratingSummary.average_stars !== null
                ? `Note moyenne : ★ ${Number(ratingSummary.average_stars).toFixed(2)} / 5 (${ratingSummary.vote_count} votes)`
                : `Moyenne masquée tant que 6 votes ne sont pas atteints (${ratingSummary.vote_count} / 6 votes)`}
            </p>

            {user ? (
              <div>
                <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                  {[1, 2, 3, 4, 5].map((star) => {
                    const active = (ratingSummary.user_stars ?? 0) >= star;
                    return (
                      <button
                        key={star}
                        type="button"
                        disabled={ratingBusy}
                        className={active ? 'btn-primary' : 'btn-secondary'}
                        onClick={() => handleRate(star)}
                      >
                        {star} ★
                      </button>
                    );
                  })}
                </div>
                <small style={{ display: 'block', marginTop: '0.4rem', fontFamily: 'var(--font-mono)' }}>
                  {ratingSummary.user_stars
                    ? `Ton vote actuel : ${ratingSummary.user_stars}/5`
                    : '+1 poubelle offerte lors de ton premier vote sur cette pancarte.'}
                </small>
              </div>
            ) : (
              <p style={{ fontSize: '0.88rem' }}>
                <Link to="/profil" style={{ textDecoration: 'underline' }}>
                  Connecte-toi
                </Link>{' '}
                pour attribuer une note de 1 à 5 étoiles.
              </p>
            )}
          </div>
        </div>
      </section>

      {/* Bloc légendes et commentaires */}
      <section className="panel-box">
        <div className="section-header">
          <h3 className="section-title">
            Légendes &amp; commentaires ({comments.length})
          </h3>
          <span className="section-meta">+1 poubelle au 1er commentaire</span>
        </div>

        {user ? (
          <form onSubmit={handleAddComment} style={{ marginBottom: '1.5rem' }}>
            <div className="field-group">
              <label className="field-label" htmlFor="comment-box">
                Ajouter une légende, un contexte ou une réaction
              </label>
              <textarea
                id="comment-box"
                className="field-textarea"
                maxLength={1000}
                required
                placeholder="Lieu, cortège, lecture du slogan, contexte historique..."
                value={newComment}
                onChange={(e) => setNewComment(e.target.value)}
              />
            </div>
            <button type="submit" className="btn-primary" disabled={commentBusy}>
              {commentBusy ? 'Publication...' : 'Publier le commentaire'}
            </button>
          </form>
        ) : (
          <p style={{ marginBottom: '1.25rem' }}>
            <Link to="/profil" style={{ textDecoration: 'underline' }}>
              Connecte-toi
            </Link>{' '}
            pour publier une légende ou un commentaire.
          </p>
        )}

        {comments.length === 0 ? (
          <p style={{ margin: 0 }}>Aucun commentaire pour le moment.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
            {comments.map((c) => {
              const canDelete = user?.id === c.user_id || Boolean(profile?.is_admin);
              return (
                <article
                  key={c.id}
                  style={{
                    border: '2px solid var(--color-black)',
                    backgroundColor: 'var(--color-paper)',
                    padding: '0.85rem 1rem',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      gap: '0.5rem',
                      marginBottom: '0.4rem',
                      fontFamily: 'var(--font-mono)',
                      fontSize: '0.78rem',
                    }}
                  >
                    <Link to={`/communaute/${c.user_id}`} style={{ fontWeight: 700 }}>
                      @{c.author?.username ?? 'membre'}
                    </Link>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                      <span>{new Date(c.created_at).toLocaleString('fr-FR')}</span>
                      {canDelete && (
                        <button
                          type="button"
                          className="btn-danger"
                          style={{ padding: '0.15rem 0.45rem', fontSize: '0.7rem' }}
                          onClick={() => handleDeleteComment(c.id)}
                        >
                          Suppr.
                        </button>
                      )}
                    </div>
                  </div>
                  <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{c.content}</p>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
