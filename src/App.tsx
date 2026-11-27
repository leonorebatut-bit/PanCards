import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { Layout } from './components/Layout';
import { HomePage } from './pages/HomePage';
import { BoosterPage } from './pages/BoosterPage';
import { ProfilePage } from './pages/ProfilePage';
import { CollectionPage } from './pages/CollectionPage';
import { CommunityPage } from './pages/CommunityPage';
import { PublicProfilePage } from './pages/PublicProfilePage';
import { CardDetailPage } from './pages/CardDetailPage';
import { AddPancartePage } from './pages/AddPancartePage';
import { TradesPage } from './pages/TradesPage';
import { RulesPage } from './pages/RulesPage';

export function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Layout />}>
            <Route index element={<HomePage />} />
            <Route path="booster" element={<BoosterPage />} />
            <Route path="collection" element={<CollectionPage />} />
            <Route path="ajouter" element={<AddPancartePage />} />
            <Route path="pancarte/:cardId" element={<CardDetailPage />} />
            <Route path="echanges" element={<TradesPage />} />
            <Route path="communaute" element={<CommunityPage />} />
            <Route path="communaute/:userId" element={<PublicProfilePage />} />
            <Route path="profil" element={<ProfilePage />} />
            <Route path="regles" element={<RulesPage />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
