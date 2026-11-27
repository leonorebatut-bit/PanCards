import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import type { Card } from '../types/database';
import {
  SUBMISSIONS_BUCKET,
  createThumbnail,
  isStoragePath,
  publishSubmissionFile,
  removePublishedFiles,
  signSubmissionPaths,
  type PublishedFile,
} from '../lib/submissions';

const STATUS_LABELS: Record<Card['status'], string> = {
  pending: 'EN ATTENTE',
  published: 'PUBLIÉE',
  rejected: 'REFUSÉE',
};

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
  const [signedUrls, setSignedUrls] = useState<Record<string, string>>({});
  const [moderatingId, setModeratingId] = useState<number | null>(null);

  // Image affichable : URL publique, ou URL signée pour une proposition en attente
  const displayUrl = (value: string) =>
    isStoragePath(value) ? signedUrls[value] ?? '' : value;

  const loadSubmissions = useCallback(async () => {
    if (!user) return;

    const { data: mine } = await supabase
      .from('cards')
      .select('*')
      .eq('uploaded_by', user.id)
      .order('created_at', { ascending: false });

    const mineList = (mine as Card[]) ?? [];
    setMySubmissions(mineList);

    let queue: Card[] = [];
    if (profile?.is_admin) {
      const { data: pending } = await supabase
        .from('cards')
        .select('*')
        .eq('status', 'pending')
        .order('created_at', { ascending: true });
      queue = (pending as Card[]) ?? [];
    }
    setPendingQueue(queue);

    const paths = [...mineList, ...queue].flatMap((c) => [c.image_url, c.thumb_url]);
    const signed = await signSubmissionPaths(paths);
    setSignedUrls(signed.urls);
    if (signed.failed > 0) {
      setErrorMsg(
        `Impossible d’afficher ${signed.failed} image(s) en attente. Recharge la page pour réessayer.`
      );
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
      if (file.size > 10 * 1024 * 1024) {
        throw new Error('L’image dépasse la taille maximale de 10 Mo.');
      }

      const dotIndex = file.name.lastIndexOf('.');
      const ext = dotIndex > 0 ? file.name.slice(dotIndex + 1).toLowerCase() : 'jpg';
      const baseName = (dotIndex > 0 ? file.name.slice(0, dotIndex) : file.name)
        .replace(/[^a-zA-Z0-9_-]/g, '_')
        .slice(0, 80);
      // Le premier dossier doit être l'id de l'utilisateur (règle du bucket privé)
      const stem = `${user.id}/${Date.now()}_${baseName}`;
      const imagePath = `${stem}.${ext}`;

      const { error: upErr } = await supabase.storage
        .from(SUBMISSIONS_BUCKET)
        .upload(imagePath, file, {
          contentType: file.type || 'image/jpeg',
          upsert: false,
        });

      if (upErr) {
        throw new Error(`Échec de l’envoi de l’image : ${upErr.message}`);
      }

      // Miniature générée dans le navigateur ; à défaut, on réutilise l'original
      let thumbPath = imagePath;
      const thumbBlob = await createThumbnail(file);
      if (thumbBlob) {
        const candidate = `${stem}_thumb.jpg`;
        const { error: thumbErr } = await supabase.storage
          .from(SUBMISSIONS_BUCKET)
          .upload(candidate, thumbBlob, { contentType: 'image/jpeg', upsert: false });
        if (!thumbErr) thumbPath = candidate;
      }

      const { error: rpcErr } = await supabase.rpc('submit_new_pancarte', {
        p_original_filename: file.name,
        p_image_url: imagePath,
        p_thumb_url: thumbPath,
        p_description: description.trim() || null,
        p_extra_info: extraInfo.trim() || null,
      });

      if (rpcErr) {
        // Pas de carte créée : on retire les fichiers envoyés
        const uploaded = thumbPath === imagePath ? [imagePath] : [imagePath, thumbPath];
        await supabase.storage.from(SUBMISSIONS_BUCKET).remove(uploaded);
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

  const handleModerate = async (item: Card, decision: 'published' | 'rejected') => {
    const cardId = item.id;
    setErrorMsg(null);
    setFeedback(null);
    setModeratingId(cardId);

    let publicImageUrl: string | null = null;
    let publicThumbUrl: string | null = null;
    // Copies publiques créées ici, à retirer si la modération échoue
    const copies: PublishedFile[] = [];

    try {
      if (decision === 'published') {
        // Copie des fichiers du bucket privé vers le bucket public
        if (isStoragePath(item.image_url)) {
          const copy = await publishSubmissionFile(item.image_url);
          copies.push(copy);
          publicImageUrl = copy.publicUrl;
        } else {
          publicImageUrl = item.image_url;
        }

        if (item.thumb_url === item.image_url) {
          publicThumbUrl = publicImageUrl;
        } else if (isStoragePath(item.thumb_url)) {
          const copy = await publishSubmissionFile(item.thumb_url);
          copies.push(copy);
          publicThumbUrl = copy.publicUrl;
        } else {
          publicThumbUrl = item.thumb_url;
        }
      }
    } catch (err) {
      await removePublishedFiles(copies.map((c) => c.path));
      setErrorMsg(err instanceof Error ? err.message : String(err));
      setModeratingId(null);
      return;
    }

    const { error } = await supabase.rpc('moderate_pancarte', {
      p_card_id: cardId,
      p_decision: decision,
      p_image_url: publicImageUrl,
      p_thumb_url: publicThumbUrl,
    });
    setModeratingId(null);

    if (error) {
      await removePublishedFiles(copies.map((c) => c.path));
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
        <p>Connecte-toi pour créer une nouvelle carte à partir de ta photo de pancarte.</p>
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
                      src={displayUrl(item.image_url)}
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
                        disabled={moderatingId !== null}
                        onClick={() => handleModerate(item, 'published')}
                      >
                        Valider (+100)
                      </button>
                      <button
                        type="button"
                        className="btn-danger"
                        disabled={moderatingId !== null}
                        onClick={() => handleModerate(item, 'rejected')}
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
                  <span className="badge-unique">{STATUS_LABELS[item.status]}</span>
                </div>
                <div className="pancarte-card-img-wrap">
                  <img
                    src={displayUrl(item.thumb_url)}
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
