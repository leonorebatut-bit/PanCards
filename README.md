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
