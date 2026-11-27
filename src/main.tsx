import React from 'react';
import ReactDOM from 'react-dom/client';
import './styles/global.css';

const root = ReactDOM.createRoot(document.getElementById('root')!);

// Sans ces variables (injectées au moment du build), le client Supabase ne
// peut pas être créé : on affiche une explication au lieu d'une page blanche.
const missingEnv = ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY'].filter(
  (key) => !import.meta.env[key]
);

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
  void import('./App').then(({ App }) => {
    root.render(
      <React.StrictMode>
        <App />
      </React.StrictMode>
    );
  });
}
