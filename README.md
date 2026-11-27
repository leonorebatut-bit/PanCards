# PanCards

pan-cards/
├── .env.example
├── .gitignore
├── index.html
├── package.json
├── tsconfig.json
├── tsconfig.node.json
├── vite.config.ts
├── README.md
├── scripts/
│   └── import-pancartes.ts
├── supabase/
│   └── migrations/
│       └── 001_init.sql
└── src/
    ├── main.tsx
    ├── App.tsx
    ├── vite-env.d.ts
    ├── types/
    │   └── database.ts
    ├── lib/
    │   └── supabase.ts
    ├── styles/
    │   ├── tokens.css
    │   └── global.css
    ├── components/
    │   ├── Layout.tsx
    │   └── CardTile.tsx
    └── pages/
        └── HomePage.tsx



        # PAN-CARDS

Archive photographique collaborative de pancartes de manifestations transformée en jeu de cartes à collectionner.

## Stack technique (100 % hébergeable gratuitement)
- **Frontend :** React 18, TypeScript, Vite, CSS personnalisé
- **Backend & Base de données :** Supabase (PostgreSQL, Auth, Storage, Row Level Security)
- **Hébergement :** Cloudflare Pages
- **Versionnement :** GitHub

---

## Installation locale

1. Cloner le dépôt et installer les dépendances :
   ```bash
   npm install

## Base de données Supabase

Les migrations se trouvent dans `supabase/migrations/` et s'exécutent dans l'ordre, via
l'éditeur SQL de Supabase (copier-coller du fichier puis « Run ») ou `supabase db push` :

1. `001_init.sql` : tables, index, règles RLS, buckets de stockage.
2. `002_rpc_and_fixes.sql` : fonctions du jeu (boosters, défausse, notes, commentaires,
   vitrine, propositions et modération), correctif du trigger de protection des profils,
   registre des récompenses, règles des buckets `submissions`, `pancartes` et `avatars`.
   Cette migration peut être rejouée sans risque ; elle remplace les fonctions de même nom.
3. `003_missing_profiles.sql` : crée les profils manquants des comptes existants
   (« Profil introuvable ») et rend l'inscription robuste. Peut être rejouée sans risque.

Pour donner les droits d'administration à un compte :

```sql
UPDATE public.profiles SET is_admin = true WHERE username = 'ton_pseudo';
```

### Propositions de pancartes

Une pancarte proposée est envoyée dans le bucket privé `submissions` (dossier de
l'utilisateur) avec une miniature générée dans le navigateur. Tant qu'elle est en attente,
`cards.image_url` et `cards.thumb_url` contiennent le chemin du fichier dans ce bucket.
À la validation, l'administrateur copie les fichiers dans le bucket public `pancartes`
et la carte reçoit ses URL publiques.
