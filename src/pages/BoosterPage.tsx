import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import type { BoosterDrawnCard, PoubelleTransaction } from '../types/database';

function formatCountdown(totalSeconds: number): string {
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

const OPERATION_LABELS: Record<PoubelleTransaction['operation_type'], string> = {
  signup_bonus: 'Bonus d’inscription',
  discard_card: 'Défausse d’une pancarte',
  rate_card: 'Note attribuée à une pancarte',
  comment_card: 'Première légende / commentaire',
  submission_approved: 'Pancarte proposée validée',
  buy_booster: 'Achat d’un booster',
  admin_adjustment: 'Ajustement administratif',
};

export function BoosterPage() {
  const { user, profile, loading: authLoading, refreshProfile } = useAuth();

  const [boostersAvailable, setBoostersAvailable] = useState<number>(0);
  const [secondsLeft, setSecondsLeft] = useState<number>(0);
  const [poubelles, setPoubelles] = useState<number>(0);

  const [opening, setOpening] = useState(false);
  const [buying, setBuying] = useState(false);
  const [drawnCards, setDrawnCards] = useState<BoosterDrawnCard[]>([]);
  const [revealedCount, setRevealedCount] = useState<number>(0);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [infoMsg, setInfoMsg] = useState<string | null>(null);

  const [transactions, setTransactions] = useState<PoubelleTransaction[]>([]);

  const syncBoostersAndHistory = useCallback(async () => {
    if (!user) return;

    const [syncRes, txRes] = await Promise.all([
      supabase.rpc('sync_user_boosters'),
      supabase
        .from('transactions')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(25),
    ]);

    if (!syncRes.error && Array.isArray(syncRes.data) && syncRes.data[0]) {
      const row = syncRes.data[0] as {
        boosters_available: number;
        seconds_until_next: number;
        poubelles_balance: number;
      };
      setBoostersAvailable(row.boosters_available);
      setSecondsLeft(row.seconds_until_next);
      setPoubelles(row.poubelles_balance);
    }

    if (!txRes.error && txRes.data) {
      setTransactions(txRes.data as PoubelleTransaction[]);
    }
  }, [user]);

  useEffect(() => {
    if (user) {
      void syncBoostersAndHistory();
    }
  }, [user, syncBoostersAndHistory]);

  // Décompte en direct toutes les secondes et resynchronisation à 0
  useEffect(() => {
    if (!user || boostersAvailable >= 8 || secondsLeft <= 0) return;

    const timer = window.setInterval(() => {
      setSecondsLeft((prev) => {
        if (prev <= 1) {
          void syncBoostersAndHistory();
          void refreshProfile();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => window.clearInterval(timer);
  }, [user, boostersAvailable, secondsLeft, syncBoostersAndHistory, refreshProfile]);

  // Révélation séquentielle des 5 cartes tirées
  useEffect(() => {
    if (drawnCards.length === 0 || revealedCount >= drawnCards.length) return;

    const stepTimer = window.setTimeout(() => {
      setRevealedCount((c) => c + 1);
    }, 260);

    return () => window.clearTimeout(stepTimer);
  }, [drawnCards, revealedCount]);

  const handleOpenBooster = async () => {
    setErrorMsg(null);
    setInfoMsg(null);
    setOpening(true);
    setDrawnCards([]);
    setRevealedCount(0);

    const { data, error } = await supabase.rpc('open_booster');

    if (error) {
      setErrorMsg(error.message);
      setOpening(false);
      return;
    }

    const cards = (data as BoosterDrawnCard[]) ?? [];
    setDrawnCards(cards);
    setRevealedCount(1);
    await syncBoostersAndHistory();
    await refreshProfile();
    setOpening(false);
  };

  const handleBuyBooster = async () => {
    setErrorMsg(null);
    setInfoMsg(null);
    setBuying(true);

    const { error } = await supabase.rpc('buy_booster');

    if (error) {
      setErrorMsg(error.message);
    } else {
      setInfoMsg('Booster acheté pour 200 poubelles et ajouté à ton stock.');
      await syncBoostersAndHistory();
      await refreshProfile();
    }
    setBuying(false);
  };

  if (authLoading) return <p>Chargement...</p>;

  if (!user || !profile) {
    return (
      <div className="panel-box">
        <h2 className="hero-headline" style={{ fontSize: '1.6rem' }}>
          Connexion requise
        </h2>
        <p>Connecte-toi pour ouvrir tes boosters et gérer tes poubelles.</p>
        <Link to="/profil" className="btn-primary">
          Se connecter →
        </Link>
      </div>
    );
  }

  return (
    <div>
      {errorMsg && <div className="alert-error">{errorMsg}</div>}
      {infoMsg && <div className="alert-ok">{infoMsg}</div>}

      <section className="hero-editorial">
        <div className="hero-main">
          <span className="hero-kicker">TIRAGE ÉQUIPROBABLE · 5 PANCARTES</span>
          <h2 className="hero-headline">OUVRIR UN BOOSTER</h2>
          <p className="hero-lead">
            Chaque booster contient 5 photographies tirées au sort parmi
            l&apos;ensemble des pancartes publiées. Un booster gratuit se
            recharge toutes les 15 minutes (plafond : 8 boosters).
          </p>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.85rem' }}>
            <button
              type="button"
              className="btn-primary"
              disabled={opening || boostersAvailable <= 0}
              onClick={handleOpenBooster}
            >
              {opening
                ? 'Tirage en cours...'
                : `Ouvrir un booster (${boostersAvailable} dispo)`}
            </button>

            <button
              type="button"
              className="btn-secondary"
              disabled={buying || poubelles < 200}
              onClick={handleBuyBooster}
            >
              {buying
                ? 'Achat...'
                : 'Acheter 1 booster (200 poubelles)'}
            </button>
          </div>
        </div>

        <aside className="hero-aside">
          <div className="stat-box">
            <div className="stat-label">Boosters disponibles</div>
            <div className="stat-value">{boostersAvailable} / 8</div>
            <div
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '0.82rem',
                marginTop: '0.35rem',
              }}
            >
              {boostersAvailable >= 8
                ? 'Stock maximal atteint'
                : `Prochain booster dans ${formatCountdown(secondsLeft)}`}
            </div>
          </div>

          <div className="stat-box">
            <div className="stat-label">Solde de poubelles</div>
            <div className="stat-value">{poubelles}</div>
            <div
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '0.8rem',
                marginTop: '0.35rem',
              }}
            >
              Défausse : +10 · Note / Légende : +1 · Upload validé : +100
            </div>
          </div>
        </aside>
      </section>

      {drawnCards.length > 0 && (
        <section className="panel-box">
          <div className="section-header">
            <h3 className="section-title">Contenu du booster</h3>
            {revealedCount < drawnCards.length && (
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setRevealedCount(drawnCards.length)}
              >
                Tout révéler
              </button>
            )}
          </div>

          <div className="cards-grid">
            {drawnCards.map((item, idx) => {
              const isRevealed = idx < revealedCount;
              return (
                <article
                  key={item.user_card_id}
                  className="pancarte-card"
                  style={{
                    opacity: isRevealed ? 1 : 0.2,
                    transition: 'opacity 0.25s ease',
                  }}
                >
                  <div className="pancarte-card-top">
                    <span>N° {String(item.card_id).padStart(4, '0')}</span>
                    {item.is_new_to_collection ? (
                      <span className="badge-dup">NOUVELLE</span>
                    ) : (
                      <span className="badge-unique">DOUBLON</span>
                    )}
                  </div>

                  <div className="pancarte-card-img-wrap">
                    <img
                      src={item.thumb_url}
                      alt={item.original_filename}
                      className="pancarte-card-img"
                    />
                  </div>

                  <div className="pancarte-card-body">
                    <div
                      style={{
                        fontFamily: 'var(--font-mono)',
                        fontSize: '0.78rem',
                      }}
                    >
                      {item.original_filename}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      )}

      {/* Historique des transactions de poubelles */}
      <section className="panel-box">
        <div className="section-header">
          <h3 className="section-title">Historique des poubelles</h3>
          <span className="section-meta">25 dernières opérations</span>
        </div>

        {transactions.length === 0 ? (
          <p style={{ margin: 0 }}>Aucune transaction enregistrée.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table
              style={{
                width: '100%',
                borderCollapse: 'collapse',
                fontFamily: 'var(--font-mono)',
                fontSize: '0.82rem',
              }}
            >
              <thead>
                <tr
                  style={{
                    borderBottom: '2px solid var(--color-black)',
                    textAlign: 'left',
                  }}
                >
                  <th style={{ padding: '0.5rem' }}>Date</th>
                  <th style={{ padding: '0.5rem' }}>Opération</th>
                  <th style={{ padding: '0.5rem' }}>Carte</th>
                  <th style={{ padding: '0.5rem', textAlign: 'right' }}>Montant</th>
                  <th style={{ padding: '0.5rem', textAlign: 'right' }}>Solde</th>
                </tr>
              </thead>
              <tbody>
                {transactions.map((tx) => (
                  <tr
                    key={tx.id}
                    style={{ borderBottom: '1px solid var(--color-gray-300)' }}
                  >
                    <td style={{ padding: '0.5rem' }}>
                      {new Date(tx.created_at).toLocaleString('fr-FR')}
                    </td>
                    <td style={{ padding: '0.5rem' }}>
                      {OPERATION_LABELS[tx.operation_type] ?? tx.operation_type}
                    </td>
                    <td style={{ padding: '0.5rem' }}>
                      {tx.card_id ? `N° ${tx.card_id}` : '—'}
                    </td>
                    <td
                      style={{
                        padding: '0.5rem',
                        textAlign: 'right',
                        fontWeight: 700,
                        color:
                          tx.amount >= 0 ? 'var(--color-black)' : 'var(--color-red)',
                      }}
                    >
                      {tx.amount >= 0 ? `+${tx.amount}` : tx.amount}
                    </td>
                    <td style={{ padding: '0.5rem', textAlign: 'right' }}>
                      {tx.balance_after}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
