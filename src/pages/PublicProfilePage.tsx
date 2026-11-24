import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import type { Card, CollectionFolder, Profile, ShowcaseItem } from '../types/database';
import { CardTile } from '../components/CardTile';

export function PublicProfilePage() {
  const { userId } = useParams<{ userId: string }>();
  const { user } = useAuth();

  const [targetProfile, setTargetProfile] = useState<Profile | null>(null);
  const [showcase, setShowcase] = useState<Card[]>([]);
  const [folders, setFolders] = useState<CollectionFolder[]>([]);
  const [publicCards, setPublicCards] = useState<Card[]>([]);
  const [totalCopies, setTotalCopies] = useState<number>(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!userId) return;

    async function loadPublicProfile() {
      setLoading(true);
      const { data: pData } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId!)
        .single();

      const prof = (pData as Profile | null) ?? null;
      setTargetProfile(prof);

      if (!prof) {
        setLoading(false);
        return;
      }

      const canViewCollection = prof.is_public || user?.id === prof.id;

      const { data: scData } = await supabase
        .from('user_showcase')
        .select('position, card:cards(*)')
        .eq('user_id', prof.id)
        .order('position', { ascending: true });

      if (scData) {
        setShowcase(
          (scData as unknown as ShowcaseItem[])
            .map((s) => s.card)
            .filter(Boolean)
        );
      }

      if (canViewCollection) {
        const [ucRes, colRes] = await Promise.all([
          supabase
            .from('user_cards')
            .select('card_id, card:cards(*)')
            .eq('user_id', prof.id),
          supabase
            .from('collections')
            .select('*')
            .eq('user_id', prof.id)
            .order('created_at', { ascending: false }),
        ]);

        if (ucRes.data) {
          setTotalCopies(ucRes.data.length);
          const uniqueMap = new Map<number, Card>();
          for (const row of ucRes.data as unknown as {
            card: Card | null;
          }[]) {
            if (row.card && !uniqueMap.has(row.card.id)) {
              uniqueMap.set(row.card.id, row.card);
            }
          }
          setPublicCards(Array.from(uniqueMap.values()));
        }

        if (colRes.data) {
          setFolders(colRes.data as CollectionFolder[]);
        }
      }

      setLoading(false);
    }

    void loadPublicProfile();
  }, [userId, user?.id]);

  if (loading) return <p>Chargement du profil...</p>;
  if (!targetProfile) {
    return (
      <div className="panel-box">
        <p style={{ margin: 0 }}>Profil introuvable.</p>
      </div>
    );
  }

  const canViewCollection =
    targetProfile.is_public || user?.id === targetProfile.id;

  return (
    <div>
      <section className="panel-box">
        <span className="hero-kicker">
          {targetProfile.is_public ? 'PROFIL PUBLIC' : 'PROFIL PRIVÉ'}
        </span>
        <h2 className="hero-headline" style={{ fontSize: '1.9rem', margin: '0.4rem 0' }}>
          @{targetProfile.username}
        </h2>
        <p>{targetProfile.bio || 'Aucune biographie.'}</p>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.85rem' }}>
          {canViewCollection
            ? `Cartes possédées : ${totalCopies} exemplaires (${publicCards.length} pancartes distinctes)`
            : 'Informations de collection privées.'}
        </div>
      </section>

      <section className="panel-box">
        <h3 className="section-title" style={{ marginBottom: '1rem' }}>
          Vitrine personnelle
        </h3>
        {showcase.length === 0 ? (
          <p style={{ margin: 0 }}>Aucune pancarte exposée en vitrine.</p>
        ) : (
          <div className="cards-grid">
            {showcase.map((card) => (
              <CardTile key={card.id} card={card} />
            ))}
          </div>
        )}
      </section>

      {!canViewCollection ? (
        <div className="panel-box">
          <p style={{ margin: 0 }}>
            Ce membre a choisi de garder sa collection et ses dossiers privés.
          </p>
        </div>
      ) : (
        <>
          {folders.length > 0 && (
            <section className="panel-box">
              <h3 className="section-title" style={{ marginBottom: '0.75rem' }}>
                Dossiers de collection
              </h3>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.6rem' }}>
                {folders.map((f) => (
                  <div
                    key={f.id}
                    style={{
                      border: '2px solid var(--color-black)',
                      padding: '0.5rem 0.75rem',
                      backgroundColor: 'var(--color-paper)',
                    }}
                  >
                    <strong>{f.name}</strong>
                    {f.description && (
                      <div style={{ fontSize: '0.82rem' }}>{f.description}</div>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}

          <section>
            <div className="section-header">
              <h3 className="section-title">Collection ({publicCards.length})</h3>
            </div>
            <div className="cards-grid">
              {publicCards.map((card) => (
                <CardTile key={card.id} card={card} />
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
