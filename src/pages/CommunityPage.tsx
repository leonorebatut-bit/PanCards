import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import type { Profile } from '../types/database';

export function CommunityPage() {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadProfiles() {
      const { data } = await supabase
        .from('profiles')
        .select('*')
        .order('created_at', { ascending: false });
      setProfiles((data as Profile[]) ?? []);
      setLoading(false);
    }
    void loadProfiles();
  }, []);

  if (loading) return <p>Chargement de la communauté...</p>;

  return (
    <div>
      <div className="section-header">
        <h2 className="section-title">Communauté ({profiles.length} membres)</h2>
      </div>

      <div className="cards-grid">
        {profiles.map((p) => (
          <article key={p.id} className="panel-box" style={{ margin: 0 }}>
            <span className="hero-kicker">
              {p.is_public ? 'COLLECTION PUBLIQUE' : 'COLLECTION PRIVÉE'}
            </span>
            <h3 style={{ fontFamily: 'var(--font-display)', margin: '0.4rem 0' }}>
              @{p.username}
            </h3>
            <p style={{ fontSize: '0.9rem', minHeight: '2.5rem' }}>
              {p.bio || 'Aucune biographie renseignée.'}
            </p>
            <Link to={`/communaute/${p.id}`} className="btn-secondary">
              Consulter le profil →
            </Link>
          </article>
        ))}
      </div>
    </div>
  );
}
