import React from 'react';
import ReactDOM from 'react-dom/client';
import './styles/global.css';

const root = ReactDOM.createRoot(document.getElementById('root')!);

// Sans ces variables (injectées au moment du build), le client Supabase ne
// peut pas être créé : on affiche une explication au lieu d'une page blanche.
// Accès directs (et non import.meta.env[clé]) pour que Vite les remplace
// de façon certaine au moment du build.
const envStatus: Array<[string, unknown]> = [
  ['VITE_SUPABASE_URL', import.meta.env.VITE_SUPABASE_URL],
  ['VITE_SUPABASE_ANON_KEY', import.meta.env.VITE_SUPABASE_ANON_KEY],
];
const missingEnv = envStatus.filter(([, value]) => !value).map(([key]) => key);

if (missingEnv.length > 0) {
  root.render(
    <div className="page-container">
      <div className="alert-error">
        <strong>Configuration incomplète du site.</strong>
        <p>
          Variable(s) manquante(s) au moment du build : {missingEnv.join(', ')}.
          Ajoute-les dans les variables de build de l&apos;hébergeur puis relance
          un déploiement.
        </p>
      </div>
    </div>
  );
} else {
  import('./App')
    .then(({ App }) => {
      root.render(
        <React.StrictMode>
          <App />
        </React.StrictMode>
      );
    })
    .catch((err: unknown) => {
      console.error(err);
      root.render(
        <div className="page-container">
          <div className="alert-error">
            <strong>Le site n&apos;a pas pu se charger.</strong>
            <p>
              Recharge la page. Si le problème continue, ouvre la console du
              navigateur (F12) pour voir l&apos;erreur.
            </p>
          </div>
        </div>
      );
    });
}
