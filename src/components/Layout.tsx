import { NavLink, Outlet } from 'react-router-dom';

const NAV_ITEMS = [
  { to: '/', label: 'Accueil' },
  { to: '/booster', label: 'Ouvrir un booster' },
  { to: '/collection', label: 'Ma collection' },
  { to: '/ajouter', label: 'Ajouter ma pancarte' },
  { to: '/echanges', label: 'Échanges' },
  { to: '/communaute', label: 'Communauté' },
  { to: '/profil', label: 'Mon profil' },
];

export function Layout() {
  return (
    <div>
      <header className="site-header">
        <div className="site-header-inner">
          <div className="brand-block">
            <h1 className="brand-title">PAN-CARDS</h1>
            <span className="brand-subtitle">Archive militante &amp; collection</span>
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
          <span>ÉDITION ARCHIVE — PHASE 1 : CATALOGUE INITIAL</span>
          <span>CONNEXION REQUISE POUR BOOSTERS &amp; POUBELLES (PHASE 2)</span>
        </div>
      </div>

      <main className="page-container">
        <Outlet />
      </main>

      <footer className="site-footer">
        <div className="site-footer-inner">
          <span>PAN-CARDS — ARCHIVE PHOTOGRAPHIQUE COMMUNAUTAIRE</span>
          <span>AUCUNE RARETÉ ARTIFICIELLE · 1 CARTE = 1 TRACE</span>
        </div>
      </footer>
    </div>
  );
}
