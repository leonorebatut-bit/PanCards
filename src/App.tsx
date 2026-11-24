import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { Layout } from './components/Layout';
import { HomePage } from './pages/HomePage';
import { BoosterPage } from './pages/BoosterPage';
import { ProfilePage } from './pages/ProfilePage';
import { CollectionPage } from './pages/CollectionPage';
import { CommunityPage } from './pages/CommunityPage';
import { PublicProfilePage } from './pages/PublicProfilePage';

function PhasePlaceholder({ title, phase }: { title: string; phase: string }) {
  return (
    <section className="panel-box">
      <span className="hero-kicker">{phase}</span>
      <h2 className="hero-headline" style={{ fontSize: '1.8rem' }}>
        {title}
      </h2>
      <p style={{ marginBottom: 0 }}>
        Ce module sera connecté à la base lors de la phase suivante.
      </p>
    </section>
  );
}

export function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Layout />}>
            <Route index element={<HomePage />} />
            <Route path="booster" element={<BoosterPage />} />
            <Route path="collection" element={<CollectionPage />} />
            <Route
              path="ajouter"
              element={
                <PhasePlaceholder title="Ajouter ma pancarte" phase="Phase 4 : Contributions" />
              }
            />
            <Route
              path="echanges"
              element={
                <PhasePlaceholder title="Échanges entre joueurs" phase="Phase 5 : Communauté" />
              }
            />
            <Route path="communaute" element={<CommunityPage />} />
            <Route path="communaute/:userId" element={<PublicProfilePage />} />
            <Route path="profil" element={<ProfilePage />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
