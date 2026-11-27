import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import type { Card } from '../types/database';
import { CardTile } from '../components/CardTile';

export function HomePage() {
  const [recentCards, setRecentCards] = useState<Card[]>([]);
  const [totalPublished, setTotalPublished] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    async function loadArchiveOverview() {
      setLoading(true);
      setErrorMsg(null);

      const [cardsRes, countRes] = await Promise.all([
        supabase
          .from('cards')
          .select('*')
          .eq('status', 'published')
          .order('id', { ascending: false })
          .limit(12),
        supabase
          .from('cards')
          .select('id', { count: 'exact', head: true })
          .eq('status', 'published'),
      ]);

      if (cardsRes.error) {
        setErrorMsg(`Erreur de chargement du catalogue : ${cardsRes.error.message}`);
      } else {
        setRecentCards(cardsRes.data ?? []);
      }

      if (!countRes.error && countRes.count !== null) {
        setTotalPublished(countRes.count);
      }

      setLoading(false);
    }

    loadArchiveOverview();
  }, []);

  return (
    <div>
      <section className="hero-editorial">
        <div className="hero-main">
          <span className="hero-kicker">JEU DE CARTES À COLLECTIONNER</span>
          <h2 className="hero-headline">
            OUVRE DES BOOSTERS, COLLECTIONNE TOUTES LES PANCARTES !
          </h2>
          <p className="hero-lead">
            Un booster gratuit t&apos;attend toutes les 15 minutes. Découvre de
            nouvelles cartes, complète ton album, gagne des poubelles en notant et
            en commentant, et échange tes doubles avec les autres joueurs.
          </p>
          <Link to="/booster" className="btn-primary">
            🎁 Ouvrir un booster
          </Link>
        </div>

        <aside className="hero-aside">
          <div className="stat-box">
            <div className="stat-label">Cartes à collectionner</div>
            <div className="stat-value">
              {totalPublished !== null ? totalPublished : '—'}
            </div>
          </div>

          <div className="stat-box">
            <div className="stat-label">Règles du jeu</div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.9rem', marginTop: '0.35rem' }}>
              5 cartes par booster · Toutes les cartes ont la même chance · Jusqu&apos;à 8 boosters en réserve
            </div>
          </div>
        </aside>
      </section>

      <section>
        <div className="section-header">
          <h3 className="section-title">Nouvelles cartes</h3>
          <span className="section-meta">
            {totalPublished !== null
              ? `Affichage de ${recentCards.length} sur ${totalPublished}`
              : 'Chargement...'}
          </span>
        </div>

        {loading && <p>Chargement des cartes...</p>}

        {errorMsg && (
          <div
            style={{
              border: '2px solid var(--color-red)',
              backgroundColor: 'var(--color-red-tint)',
              padding: '1rem',
              fontFamily: 'var(--font-mono)',
            }}
          >
            {errorMsg}
          </div>
        )}

        {!loading && !errorMsg && recentCards.length === 0 && (
          <div
            style={{
              border: '2px solid var(--color-black)',
              backgroundColor: 'var(--color-white)',
              padding: '1.5rem',
            }}
          >
            <strong>Aucune pancarte publiée dans la base pour le moment.</strong>
            <p style={{ marginBottom: 0 }}>
              Place tes photos JPG dans le dossier local <code>Pancartes/</code> puis
              exécute <code>npm run import:pancartes</code>.
            </p>
          </div>
        )}

        {recentCards.length > 0 && (
          <div className="cards-grid">
            {recentCards.map((card) => (
              <CardTile key={card.id} card={card} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
