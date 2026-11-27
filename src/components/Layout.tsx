import { useEffect, useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';

const NAV_ITEMS = [
  { to: '/', label: '🏠 Accueil' },
  { to: '/booster', label: '🎁 Boosters' },
  { to: '/collection', label: '📚 Mon album' },
  { to: '/ajouter', label: '➕ Créer une carte' },
  { to: '/echanges', label: '🔄 Échanges' },
  { to: '/communaute', label: '👥 Joueurs' },
  { to: '/profil', label: '👤 Profil' },
];

export function Layout() {
  const { user, profile } = useAuth();
  const [liveBoosters, setLiveBoosters] = useState<number | null>(null);
  const [livePoubelles, setLivePoubelles] = useState<number | null>(null);

  useEffect(() => {
    if (!user) {
      setLiveBoosters(null);
      setLivePoubelles(null);
      return;
    }

    supabase.rpc('sync_user_boosters').then(({ data, error }) => {
      if (!error && Array.isArray(data) && data[0]) {
        const row = data[0] as {
          boosters_available: number;
          poubelles_balance: number;
        };
        setLiveBoosters(row.boosters_available);
        setLivePoubelles(row.poubelles_balance);
      }
    });
  }, [user, profile?.poubelles, profile?.boosters_stored]);

  const displayedBoosters = liveBoosters ?? profile?.boosters_stored ?? 0;
  const displayedPoubelles = livePoubelles ?? profile?.poubelles ?? 0;

  return (
    <div>
      <header className="site-header">
        <div className="site-header-inner">
          <div className="brand-block">
            <h1 className="brand-title">PAN-CARDS</h1>
          </div>

          <nav className="main-nav" aria-label="Navigation principale">
            {NAV_ITEMS.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/'}
                className={({ isActive }) =>
                  isActive ? 'nav-link active' : 'nav-link'
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
        </div>
      </header>

      <div className="status-strip">
        <div className="status-strip-inner">
          <span>{profile ? `🎮 JOUEUR : @${profile.username}` : '🎮 CONNECTE-TOI POUR JOUER'}</span>
          {profile ? (
            <span className="hud">
              <span className="hud-pill" title="Poubelles (monnaie du jeu)">
                🗑️ {displayedPoubelles}
              </span>
              <NavLink to="/booster" className="hud-pill hud-pill-accent" title="Boosters disponibles">
                🎁 {displayedBoosters}/8
              </NavLink>
            </span>
          ) : (
            <NavLink to="/profil" className="hud-pill hud-pill-accent">
              Jouer →
            </NavLink>
          )}
        </div>
      </div>

      <main className="page-container">
        <Outlet />
      </main>

      <footer className="site-footer">
        <div className="site-footer-inner">
          <span>PAN-CARDS</span>
        </div>
      </footer>
    </div>
  );
}
