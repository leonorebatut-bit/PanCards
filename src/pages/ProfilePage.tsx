import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import type { Card, ShowcaseItem } from '../types/database';

export function ProfilePage() {
  const { user, profile, loading, signIn, signUp, signOut, refreshProfile } =
    useAuth();

  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [authError, setAuthError] = useState<string | null>(null);
  const [authInfo, setAuthInfo] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Formulaire édition du profil
  const [bio, setBio] = useState('');
  const [isPublic, setIsPublic] = useState(true);
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [saveErr, setSaveErr] = useState<string | null>(null);

  // Vitrine personnelle (max 6 cartes)
  const [ownedCards, setOwnedCards] = useState<Card[]>([]);
  const [showcaseIds, setShowcaseIds] = useState<number[]>([]);
  const [showcaseMsg, setShowcaseMsg] = useState<string | null>(null);

  useEffect(() => {
    if (profile) {
      setBio(profile.bio ?? '');
      setIsPublic(profile.is_public);
    }
  }, [profile]);

  useEffect(() => {
    if (!user) {
      setOwnedCards([]);
      setShowcaseIds([]);
      return;
    }

    async function loadCollectionAndShowcase() {
      const [ucRes, scRes] = await Promise.all([
        supabase
          .from('user_cards')
          .select('card_id, card:cards(*)')
          .eq('user_id', user!.id),
        supabase
          .from('user_showcase')
          .select('card_id, position, card:cards(*)')
          .eq('user_id', user!.id)
          .order('position', { ascending: true }),
      ]);

      if (!ucRes.error && ucRes.data) {
        const uniqueMap = new Map<number, Card>();
        for (const row of ucRes.data as unknown as { card_id: number; card: Card | null }[]) {
          if (row.card && !uniqueMap.has(row.card.id)) {
            uniqueMap.set(row.card.id, row.card);
          }
        }
        setOwnedCards(Array.from(uniqueMap.values()));
      }

      if (!scRes.error && scRes.data) {
        const items = scRes.data as unknown as ShowcaseItem[];
        setShowcaseIds(items.map((i) => i.card_id));
      }
    }

    void loadCollectionAndShowcase();
  }, [user]);

  const handleAuthSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    setAuthInfo(null);
    setSubmitting(true);

    if (authMode === 'login') {
      const { error } = await signIn({ email, password });
      if (error) setAuthError(error);
    } else {
      const { error, needsEmailConfirmation } = await signUp({ email, password, username });
      if (error) {
        setAuthError(error);
      } else if (needsEmailConfirmation) {
        setAuthInfo(
          'Compte créé ! Un e-mail de confirmation t’a été envoyé : clique sur le lien avant de te connecter.'
        );
      } else {
        // Connexion automatique : la page affiche le profil dès qu'il est chargé
        setAuthInfo('Compte créé, bienvenue !');
      }
    }
    setSubmitting(false);
  };

  const handleSaveProfile = async (e: FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setSaveMsg(null);
    setSaveErr(null);

    let nextAvatarUrl = profile?.avatar_url ?? null;

    if (avatarFile) {
      const ext = avatarFile.name.split('.').pop()?.toLowerCase() || 'jpg';
      const storagePath = `${user.id}/avatar.${ext}`;
      const { error: upErr } = await supabase.storage
        .from('avatars')
        .upload(storagePath, avatarFile, {
          contentType: avatarFile.type || 'image/jpeg',
          upsert: true,
        });

      if (upErr) {
        setSaveErr(`Erreur upload avatar : ${upErr.message}`);
        return;
      }

      const { data: pubData } = supabase.storage
        .from('avatars')
        .getPublicUrl(storagePath);
      nextAvatarUrl = `${pubData.publicUrl}?t=${Date.now()}`;
    }

    const { error } = await supabase
      .from('profiles')
      .update({
        bio: bio.trim(),
        is_public: isPublic,
        avatar_url: nextAvatarUrl,
      })
      .eq('id', user.id);

    if (error) {
      setSaveErr(`Mise à jour impossible : ${error.message}`);
    } else {
      await refreshProfile();
      setAvatarFile(null);
      setSaveMsg('Profil mis à jour.');
    }
  };

  const toggleShowcaseCard = (cardId: number) => {
    setShowcaseMsg(null);
    setShowcaseIds((prev) => {
      if (prev.includes(cardId)) {
        return prev.filter((id) => id !== cardId);
      }
      if (prev.length >= 6) {
        setShowcaseMsg('La vitrine est limitée à 6 pancartes maximum.');
        return prev;
      }
      return [...prev, cardId];
    });
  };

  const handleSaveShowcase = async () => {
    setShowcaseMsg(null);
    const { error } = await supabase.rpc('set_user_showcase', {
      p_card_ids: showcaseIds,
    });
    if (error) {
      setShowcaseMsg(`Erreur : ${error.message}`);
    } else {
      setShowcaseMsg('Vitrine enregistrée.');
    }
  };

  if (loading) {
    return <p>Chargement du compte...</p>;
  }

  if (user && !profile) {
    return (
      <div className="panel-box" style={{ maxWidth: '520px', margin: '0 auto' }}>
        <h2 className="hero-headline" style={{ fontSize: '1.7rem' }}>
          Profil introuvable
        </h2>
        <p>
          Tu es connecté·e, mais ton profil de joueur n&apos;a pas pu être chargé.
          Réessaie dans un instant ou déconnecte-toi puis reconnecte-toi.
        </p>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <button type="button" className="btn-secondary" onClick={() => void refreshProfile()}>
            Réessayer
          </button>
          <button type="button" className="btn-danger" onClick={signOut}>
            Déconnexion
          </button>
        </div>
      </div>
    );
  }

  if (!user || !profile) {
    return (
      <div className="panel-box" style={{ maxWidth: '520px', margin: '0 auto' }}>
        <span className="hero-kicker">PHASE 2 · AUTHENTIFICATION</span>
        <h2 className="hero-headline" style={{ fontSize: '1.7rem' }}>
          {authMode === 'login' ? 'Connexion' : 'Créer un compte'}
        </h2>

        <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.25rem' }}>
          <button
            type="button"
            className={authMode === 'login' ? 'btn-primary' : 'btn-secondary'}
            onClick={() => {
              setAuthMode('login');
              setAuthError(null);
            }}
          >
            Se connecter
          </button>
          <button
            type="button"
            className={authMode === 'register' ? 'btn-primary' : 'btn-secondary'}
            onClick={() => {
              setAuthMode('register');
              setAuthError(null);
            }}
          >
            Inscription
          </button>
        </div>

        {authError && <div className="alert-error">{authError}</div>}
        {authInfo && <div className="alert-ok">{authInfo}</div>}

        <form onSubmit={handleAuthSubmit}>
          {authMode === 'register' && (
            <div className="field-group">
              <label className="field-label" htmlFor="username">
                Pseudonyme unique
              </label>
              <input
                id="username"
                className="field-input"
                type="text"
                required
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="ex_militante_92"
              />
            </div>
          )}

          <div className="field-group">
            <label className="field-label" htmlFor="email">
              Adresse e-mail
            </label>
            <input
              id="email"
              className="field-input"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>

          <div className="field-group">
            <label className="field-label" htmlFor="password">
              Mot de passe
            </label>
            <input
              id="password"
              className="field-input"
              type="password"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>

          <button type="submit" className="btn-primary" disabled={submitting}>
            {submitting
              ? 'Patiente...'
              : authMode === 'login'
              ? 'Connexion'
              : 'Créer mon compte'}
          </button>
        </form>
      </div>
    );
  }

  return (
    <div>
      <section className="panel-box">
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            flexWrap: 'wrap',
            gap: '1rem',
            marginBottom: '1.25rem',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            {profile.avatar_url ? (
              <img
                src={profile.avatar_url}
                alt={`Avatar de ${profile.username}`}
                style={{
                  width: 72,
                  height: 72,
                  objectFit: 'cover',
                  border: '2px solid var(--color-black)',
                }}
              />
            ) : (
              <div
                style={{
                  width: 72,
                  height: 72,
                  backgroundColor: 'var(--color-red)',
                  color: 'var(--color-white)',
                  display: 'grid',
                  placeItems: 'center',
                  fontFamily: 'var(--font-display)',
                  fontSize: '1.6rem',
                  border: '2px solid var(--color-black)',
                }}
              >
                {profile.username.slice(0, 2).toUpperCase()}
              </div>
            )}

            <div>
              <span className="hero-kicker">
                {profile.is_public ? 'PROFIL PUBLIC' : 'PROFIL PRIVÉ'}
                {profile.is_admin ? ' · ADMIN' : ''}
              </span>
              <h2 className="hero-headline" style={{ fontSize: '1.8rem', margin: 0 }}>
                @{profile.username}
              </h2>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.82rem' }}>
                Poubelles : <strong>{profile.poubelles}</strong> · Boosters :{' '}
                <strong>{profile.boosters_stored}</strong>
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <Link to={`/communaute/${profile.id}`} className="btn-secondary">
              Voir mon profil public →
            </Link>
            <button type="button" className="btn-danger" onClick={signOut}>
              Déconnexion
            </button>
          </div>
        </div>

        {saveErr && <div className="alert-error">{saveErr}</div>}
        {saveMsg && <div className="alert-ok">{saveMsg}</div>}

        <form onSubmit={handleSaveProfile}>
          <div className="field-group">
            <label className="field-label" htmlFor="bio">
              Biographie libre (max 500 caractères)
            </label>
            <textarea
              id="bio"
              className="field-textarea"
              maxLength={500}
              value={bio}
              onChange={(e) => setBio(e.target.value)}
            />
          </div>

          <div className="field-group">
            <label className="field-label" htmlFor="avatar">
              Avatar personnalisable
            </label>
            <input
              id="avatar"
              type="file"
              accept="image/jpeg,image/png,image/webp,image/avif"
              onChange={(e) => setAvatarFile(e.target.files?.[0] ?? null)}
            />
          </div>

          <div className="field-group">
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <input
                type="checkbox"
                checked={isPublic}
                onChange={(e) => setIsPublic(e.target.checked)}
              />
              <span className="field-label" style={{ margin: 0 }}>
                Rendre ma collection visible publiquement aux autres joueurs
              </span>
            </label>
          </div>

          <button type="submit" className="btn-primary">
            Enregistrer mon profil
          </button>
        </form>
      </section>

      <section className="panel-box">
        <div className="section-header">
          <h3 className="section-title">
            Ma vitrine personnelle ({showcaseIds.length}/6)
          </h3>
          <button type="button" className="btn-primary" onClick={handleSaveShowcase}>
            Sauvegarder la vitrine
          </button>
        </div>

        {showcaseMsg && <div className="alert-ok">{showcaseMsg}</div>}

        {ownedCards.length === 0 ? (
          <p style={{ margin: 0 }}>
            Tu ne possèdes pas encore de cartes dans ta collection.
          </p>
        ) : (
          <div className="showcase-grid">
            {ownedCards.map((card) => {
              const selectedIndex = showcaseIds.indexOf(card.id);
              const isSelected = selectedIndex !== -1;
              return (
                <button
                  key={card.id}
                  type="button"
                  onClick={() => toggleShowcaseCard(card.id)}
                  style={{
                    textAlign: 'left',
                    padding: 0,
                    backgroundColor: isSelected
                      ? 'var(--color-red-tint)'
                      : 'var(--color-white)',
                    border: isSelected
                      ? '3px solid var(--color-red)'
                      : '2px solid var(--color-black)',
                    cursor: 'pointer',
                  }}
                >
                  <div className="pancarte-card-top">
                    <span>N° {card.id}</span>
                    <span>{isSelected ? `#${selectedIndex + 1}` : 'Choisir'}</span>
                  </div>
                  <div className="pancarte-card-img-wrap">
                    <img
                      src={card.thumb_url}
                      alt={card.original_filename}
                      className="pancarte-card-img"
                      loading="lazy"
                    />
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
