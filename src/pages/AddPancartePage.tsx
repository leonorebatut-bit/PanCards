import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import type { Card } from '../types/database';

export function AddPancartePage() {
  const { user, profile, loading: authLoading, refreshProfile } = useAuth();

  const [file, setFile] = useState<File | null>(null);
  const [description, setDescription] = useState('');
  const [extraInfo, setExtraInfo] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [mySubmissions, setMySubmissions] = useState<Card[]>([]);
  const [pendingQueue, setPendingQueue] = useState<Card[]>([]);

  const loadSubmissions = useCallback(async () => {
    if (!user) return;

    const { data: mine } = await supabase
      .from('cards')
      .select('*')
      .eq('uploaded_by', user.id)
      .order('created_at', { ascending: false });

    setMySubmissions((mine as Card[]) ?? []);

    if (profile?.is_admin) {
      const { data: pending } = await supabase
        .from('cards')
        .select('*')
        .eq('status', 'pending')
        .order('created_at', { ascending: true });
      setPendingQueue((pending as Card[]) ?? []);
    }
  }, [user, profile?.is_admin]);

  useEffect(() => {
    void loadSubmissions();
  }, [loadSubmissions]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!user || !file) return;

    setErrorMsg(null);
    setFeedback(null);
    setSubmitting(true);

    try {
      const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg';
      const safeName = `${Date.now()}_${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
      const storagePath = `submissions/${user.id}/${safeName}.${ext}`;

      const { error: upErr } = await supabase.storage
        .from('pancartes')
        .upload(storagePath, file, {
          contentType: file.type || 'image/jpeg',
          upsert: false,
        });

      if (upErr) {
        throw new Error(`Échec de l’envoi de l’image : ${upErr.message}`);
      }

      const { data: urlData } = supabase.storage
        .from('pancartes')
        .getPublicUrl(storagePath);

      const { error: rpcErr } = await supabase.rpc('submit_new_pancarte', {
        p_original_filename: file.name,
        p_image_url: urlData.publicUrl,
        p_thumb_url: urlData.publicUrl,
        p_description: description.trim() || null,
        p_extra_info: extraInfo.trim() || null,
      });

      if (rpcErr) {
        throw new Error(rpcErr.message);
      }

      setFile(null);
      setDescription('');
      setExtraInfo('');
      setFeedback(
        'Ta pancarte a bien été envoyée ! Elle est en attente de validation par un administrateur (+100 poubelles dès qu’elle sera validée).'
      );
      await loadSubmissions();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  const handleModerate = async (cardId: number, decision: 'published' | 'rejected') => {
    setErrorMsg(null);
    setFeedback(null);

    const { error } = await supabase.rpc('moderate_pancarte', {
      p_card_id: cardId,
      p_decision: decision,
    });

    if (error) {
      setErrorMsg(error.message);
    } else {
      setFeedback(
        decision === 'published'
          ? `Pancarte #${cardId} publiée (+100 poubelles attribuées à son auteur).`
          : `Pancarte #${cardId} rejetée.`
      );
      await loadSubmissions();
      await refreshProfile();
    }
  };

  if (authLoading) return <p>Chargement...</p>;

  if (!user || !profile) {
    return (
      <div className="panel-box">
        <h2 className="hero-headline" style={{ fontSize: '1.6rem' }}>
          Connexion requise
        </h2>
        <p>Connecte-toi pour proposer une photographie de pancarte à l&apos;archive.</p>
        <Link to="/profil" className="btn-primary">
          Se connecter →
        </Link>
      </div>
    );
  }

  return (
    <div>
      {errorMsg && <div className="alert-error">{errorMsg}</div>}
      {feedback && <div className="alert-ok">{feedback}</div>}

      <section className="panel-box">
        <span className="hero-kicker">CONTRIBUTION · +100 POUBELLES À LA VALIDATION</span>
        <h2 className="hero-headline" style={{ fontSize: '1.8rem' }}>
          Ajouter ma pancarte
        </h2>
        <p>
          Propose une photographie de pancarte. Elle restera en attente jusqu&apos;à
          validation par un administrateur avant de rejoindre le catalogue et les
          boosters.
        </p>

        <form onSubmit={handleSubmit}>
          <div className="field-group">
            <label className="field-label" htmlFor="pancarte-file">
              Photographie (JPG, PNG, WEBP, AVIF)
            </label>
            <input
              id="pancarte-file"
              type="file"
              required
              accept="image/jpeg,image/png,image/webp,image/avif"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </div>

          <div className="field-group">
            <label className="field-label" htmlFor="pancarte-desc">
              Description ou texte visible (facultatif)
            </label>
            <textarea
              id="pancarte-desc"
              className="field-textarea"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Transcription du slogan ou courte présentation..."
            />
          </div>

          <div className="field-group">
            <label className="field-label" htmlFor="pancarte-extra">
              Informations complémentaires (facultatif)
            </label>
            <input
              id="pancarte-extra"
              className="field-input"
              type="text"
              value={extraInfo}
              onChange={(e) => setExtraInfo(e.target.value)}
              placeholder="Ville, date, mobilisation..."
            />
          </div>

          <button type="submit" className="btn-primary" disabled={submitting || !file}>
            {submitting ? 'Envoi en cours...' : 'Soumettre ma pancarte'}
          </button>
        </form>
      </section>

      {/* File de modération réservée aux administrateurs */}
      {profile.is_admin && (
        <section className="panel-box">
          <div className="section-header">
            <h3 className="section-title">
              Modération administrateur ({pendingQueue.length} en attente)
            </h3>
          </div>

          {pendingQueue.length === 0 ? (
            <p style={{ margin: 0 }}>Aucune proposition en attente.</p>
          ) : (
            <div className="cards-grid">
              {pendingQueue.map((item) => (
                <article key={item.id} className="pancarte-card">
                  <div className="pancarte-card-top">
                    <span>N° {item.id}</span>
                    <span className="badge-dup">EN ATTENTE</span>
                  </div>
                  <div className="pancarte-card-img-wrap">
                    <img
                      src={item.image_url}
                      alt={item.original_filename}
                      className="pancarte-card-img"
                    />
                  </div>
                  <div className="pancarte-card-body">
                    <strong style={{ fontSize: '0.84rem' }}>{item.original_filename}</strong>
                    {item.description && (
                      <p style={{ fontSize: '0.82rem', margin: '0.35rem 0' }}>
                        {item.description}
                      </p>
                    )}
                    {item.extra_info && (
                      <p style={{ fontSize: '0.78rem', margin: '0 0 0.5rem' }}>
                        {item.extra_info}
                      </p>
                    )}
                    <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
                      <button
                        type="button"
                        className="btn-primary"
                        onClick={() => handleModerate(item.id, 'published')}
                      >
                        Valider (+100)
                      </button>
                      <button
                        type="button"
                        className="btn-danger"
                        onClick={() => handleModerate(item.id, 'rejected')}
                      >
                        Rejeter
                      </button>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      )}

      {/* Suivi de mes propositions */}
      <section className="panel-box">
        <h3 className="section-title" style={{ marginBottom: '1rem' }}>
          Mes propositions ({mySubmissions.length})
        </h3>
        {mySubmissions.length === 0 ? (
          <p style={{ margin: 0 }}>Tu n&apos;as pas encore soumis de pancarte.</p>
        ) : (
          <div className="cards-grid">
            {mySubmissions.map((item) => (
              <article key={item.id} className="pancarte-card">
                <div className="pancarte-card-top">
                  <span>N° {item.id}</span>
                  <span className="badge-unique">{item.status.toUpperCase()}</span>
                </div>
                <div className="pancarte-card-img-wrap">
                  <img
                    src={item.thumb_url}
                    alt={item.original_filename}
                    className="pancarte-card-img"
                  />
                </div>
                <div className="pancarte-card-body">
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.78rem' }}>
                    {item.original_filename}
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
