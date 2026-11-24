import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Layout } from './components/Layout';
import { HomePage } from './pages/HomePage';

function PhasePlaceholder({ title, phase }: { title: string; phase: string }) {
  return (
    <section
      style={{
        border: '2px solid var(--color-black)',
        backgroundColor: 'var(--color-white)',
        padding: '2rem',
        boxShadow: '4px 4px 0px var(--color-black)',
      }}
    >
      <span className="hero-kicker">{phase}</span>
      <h2 className="hero-headline" style={{ fontSize: '1.8rem' }}>
        {title}
      </h2>
      <p style={{ marginBottom: 0 }}>
        Ce module est prévu dans la feuille de route et sera connecté à la base
        de données lors de la phase correspondante.
      </p>
    </section>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<HomePage />} />
          <Route
            path="booster"
            element={<PhasePlaceholder title="Ouvrir un booster" phase="Phase 3 : Jeu" />}
          />
          <Route
            path="collection"
            element={<PhasePlaceholder title="Ma collection" phase="Phase 2 : Comptes et collections" />}
          />
          <Route
            path="ajouter"
            element={<PhasePlaceholder title="Ajouter ma pancarte" phase="Phase 4 : Contributions" />}
          />
          <Route
            path="echanges"
            element={<PhasePlaceholder title="Échanges entre joueurs" phase="Phase 5 : Communauté" />}
          />
          <Route
            path="communaute"
            element={<PhasePlaceholder title="Profils et communauté" phase="Phase 5 : Communauté" />}
          />
          <Route
            path="profil"
            element={<PhasePlaceholder title="Mon profil" phase="Phase 2 : Comptes et collections" />}
          />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
