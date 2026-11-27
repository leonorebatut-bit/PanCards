import { useEffect, useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import { Icon, type IconName } from './Icon';

const NAV_ITEMS: Array<{ to: string; label: string; icon: IconName }> = [
  { to: '/', label: 'Accueil', icon: 'home' },
  { to: '/booster', label: 'Boosters', icon: 'booster' },
  { to: '/collection', label: 'Mon album', icon: 'album' },
  { to: '/ajouter', label: 'Créer une carte', icon: 'plus' },
  { to: '/echanges', label: 'Échanges', icon: 'swap' },
  { to: '/communaute', label: 'Joueurs', icon: 'users' },
  { to: '/regles', label: 'Règles', icon: 'rules' },
  { to: '/profil', label: 'Profil', icon: 'user' },
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
            <h1 className="brand-title">PanCards</h1>
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
                <Icon name={item.icon} />
                {item.label}
              </NavLink>
            ))}
          </nav>
        </div>
      </header>

      <div className="status-strip">
        <div className="status-strip-inner">
          <span>{profile ? `@${profile.username}` : 'Connecte-toi pour jouer'}</span>
          {profile ? (
            <span className="hud">
              <span className="hud-pill" title="Poubelles (monnaie du jeu)">
                <Icon name="trash" size={14} /> {displayedPoubelles}
              </span>
              <NavLink to="/booster" className="hud-pill hud-pill-accent" title="Boosters disponibles">
                <Icon name="booster" size={14} /> {displayedBoosters}/8
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
          <span>PanCards</span>
        </div>
      </footer>
    </div>
  );
}
