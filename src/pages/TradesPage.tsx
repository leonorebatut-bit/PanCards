import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import type { Profile, TradeCard, TradeView } from '../types/database';

type Tab = 'received' | 'sent' | 'new' | 'history';

interface OwnedCopy {
  id: string;
  card_id: number;
  card: TradeCard | null;
}

interface CardGroup {
  card: TradeCard;
  copyIds: string[];
}

const MAX_PER_SIDE = 10;

const STATUS_LABELS: Record<TradeView['status'], string> = {
  pending: 'En attente',
  accepted: 'Accepté',
  rejected: 'Refusé',
  cancelled: 'Annulé',
  ignored: 'Ignoré',
};

function cardNumber(id: number): string {
  return `N° ${String(id).padStart(4, '0')}`;
}

function groupCopies(copies: OwnedCopy[]): CardGroup[] {
  const map = new Map<number, CardGroup>();
  for (const copy of copies) {
    if (!copy.card) continue;
    const group = map.get(copy.card_id) ?? { card: copy.card, copyIds: [] };
    group.copyIds.push(copy.id);
    map.set(copy.card_id, group);
  }
  // Doublons d'abord (ce qu'on échange le plus volontiers), puis par numéro
  return [...map.values()].sort(
    (a, b) => b.copyIds.length - a.copyIds.length || a.card.id - b.card.id
  );
}

function errorText(err: unknown): string {
  if (err && typeof err === 'object' && 'message' in err) {
    return String((err as { message: unknown }).message);
  }
  return 'Une erreur est survenue.';
}

function MiniCard({
  card,
  badge,
  children,
}: {
  card: TradeCard;
  badge?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="trade-mini">
      <Link to={`/pancarte/${card.id}`} className="trade-mini-img-wrap">
        <img src={card.thumb_url} alt={cardNumber(card.id)} loading="lazy" />
      </Link>
      <div className="trade-mini-body">
        <span>{cardNumber(card.id)}</span>
        {badge && <span className="trade-mini-badge">{badge}</span>}
      </div>
      {children}
    </div>
  );
}

/** Liste de cartes groupées, avec des boutons + / − pour choisir des exemplaires */
function CardPicker({
  groups,
  selected,
  onChange,
  ownedByMe,
}: {
  groups: CardGroup[];
  selected: string[];
  onChange: (ids: string[]) => void;
  ownedByMe?: Set<number>;
}) {
  if (groups.length === 0) {
    return <p className="trade-empty">Aucune carte.</p>;
  }
  return (
    <div className="trade-grid">
      {groups.map((g) => {
        const chosen = g.copyIds.filter((id) => selected.includes(id));
        const free = g.copyIds.filter((id) => !selected.includes(id));
        const isNew = ownedByMe !== undefined && !ownedByMe.has(g.card.id);
        const badgeParts = [
          g.copyIds.length > 1 ? `×${g.copyIds.length}` : '',
          isNew ? 'NOUVELLE' : '',
        ].filter(Boolean);
        const badge = badgeParts.length > 0 ? badgeParts.join(' · ') : undefined;
        return (
          <div key={g.card.id} className={chosen.length > 0 ? 'trade-pick is-picked' : 'trade-pick'}>
            <MiniCard card={g.card} badge={badge}>
              <div className="trade-pick-controls">
                <button
                  type="button"
                  className="trade-step"
                  disabled={chosen.length === 0}
                  onClick={() => onChange(selected.filter((id) => id !== chosen[chosen.length - 1]))}
                  aria-label="Retirer un exemplaire"
                >
                  −
                </button>
                <span>{chosen.length}</span>
                <button
                  type="button"
                  className="trade-step"
                  disabled={free.length === 0 || selected.length >= MAX_PER_SIDE}
                  onClick={() => onChange([...selected, free[0]])}
                  aria-label="Ajouter un exemplaire"
                >
                  +
                </button>
              </div>
            </MiniCard>
          </div>
        );
      })}
    </div>
  );
}

function TradeSummary({
  trade,
  myId,
  children,
}: {
  trade: TradeView;
  myId: string;
  children?: React.ReactNode;
}) {
  const iAmProposer = trade.proposer.id === myId;
  const other = iAmProposer ? trade.receiver : trade.proposer;
  // « Tu donnes » = ce qui quitte ma collection
  const iGive = trade.items.filter((it) => (it.direction === 'offered') === iAmProposer);
  const iGet = trade.items.filter((it) => (it.direction === 'offered') !== iAmProposer);
  const date = new Date(trade.resolved_at ?? trade.created_at).toLocaleDateString('fr-FR', {
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <article className="panel-box trade-box">
      <div className="trade-box-head">
        <span className="hero-kicker">
          {iAmProposer ? 'PROPOSÉ À' : 'PROPOSÉ PAR'}{' '}
          <Link to={`/communaute/${other.id}`}>@{other.username}</Link>
        </span>
        <span className="trade-status">
          {STATUS_LABELS[trade.status]} · {date}
        </span>
      </div>
      {trade.message && <p className="trade-message">« {trade.message} »</p>}
      <div className="trade-sides">
        <div>
          <h4 className="trade-side-title">Tu donnes ({iGive.length})</h4>
          <div className="trade-grid">
            {iGive.map((it) => (
              <MiniCard key={it.user_card_id} card={it.card} />
            ))}
            {iGive.length === 0 && <p className="trade-empty">Rien</p>}
          </div>
        </div>
        <div>
          <h4 className="trade-side-title">Tu reçois ({iGet.length})</h4>
          <div className="trade-grid">
            {iGet.map((it) => (
              <MiniCard key={it.user_card_id} card={it.card} />
            ))}
            {iGet.length === 0 && <p className="trade-empty">Rien</p>}
          </div>
        </div>
      </div>
      {children && <div className="trade-actions">{children}</div>}
    </article>
  );
}

export function TradesPage() {
  const { user, loading: authLoading } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const partnerId = searchParams.get('avec') ?? '';

  const [tab, setTab] = useState<Tab | null>(partnerId ? 'new' : null);
  const [trades, setTrades] = useState<TradeView[]>([]);
  const [players, setPlayers] = useState<Profile[]>([]);
  const [myCopies, setMyCopies] = useState<OwnedCopy[]>([]);
  const [partnerCopies, setPartnerCopies] = useState<OwnedCopy[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [offered, setOffered] = useState<string[]>([]);
  const [requested, setRequested] = useState<string[]>([]);
  const [message, setMessage] = useState('');

  // Compte actuellement affiché : une réponse arrivée après un changement de
  // compte est ignorée (elle ne doit pas s'afficher pour l'autre joueur)
  const currentUid = useRef<string | null>(null);
  currentUid.current = user?.id ?? null;

  const loadTrades = useCallback(async (uid: string) => {
    const { data, error: err } = await supabase.rpc('get_my_trades');
    if (currentUid.current !== uid) return;
    if (err) {
      setError(errorText(err));
      return;
    }
    setTrades((data as TradeView[] | null) ?? []);
  }, []);

  const loadMyCopies = useCallback(async (uid: string) => {
    const { data, error: err } = await supabase
      .from('user_cards')
      .select('id, card_id, card:cards(id, thumb_url, description)')
      .eq('user_id', uid);
    if (currentUid.current !== uid) return;
    if (err) {
      setError(`Impossible de charger ta collection : ${err.message}`);
      return;
    }
    setMyCopies((data as unknown as OwnedCopy[] | null) ?? []);
  }, []);

  useEffect(() => {
    setTrades([]);
    setMyCopies([]);
    setPlayers([]);
    setError(null);
    setNotice(null);
    if (!user?.id) {
      if (!authLoading) setLoading(false);
      return;
    }
    const uid = user.id;
    async function loadAll() {
      setLoading(true);
      const [, , playersRes] = await Promise.all([
        loadTrades(uid),
        loadMyCopies(uid),
        supabase
          .from('profiles')
          .select('*')
          .neq('id', uid)
          .eq('is_suspended', false)
          .order('username', { ascending: true }),
      ]);
      if (currentUid.current !== uid) return;
      if (playersRes.error) {
        setError(`Impossible de charger la liste des joueurs : ${playersRes.error.message}`);
      } else {
        setPlayers((playersRes.data as Profile[] | null) ?? []);
      }
      setLoading(false);
    }
    void loadAll();
  }, [user?.id, authLoading, loadTrades, loadMyCopies]);

  const partner = players.find((p) => p.id === partnerId) ?? null;

  // Cartes du joueur choisi (visibles seulement si sa collection est publique)
  useEffect(() => {
    setRequested([]);
    setPartnerCopies([]);
    if (!partner || !partner.is_public) return;
    const wantedId = partner.id;
    let stale = false;
    async function loadPartner() {
      const { data, error: err } = await supabase
        .from('user_cards')
        .select('id, card_id, card:cards(id, thumb_url, description)')
        .eq('user_id', wantedId);
      // Un autre joueur a été choisi entre-temps : on ignore cette réponse
      if (stale) return;
      if (err) {
        setError(`Impossible de charger les cartes de ce joueur : ${err.message}`);
        return;
      }
      setPartnerCopies((data as unknown as OwnedCopy[] | null) ?? []);
    }
    void loadPartner();
    return () => {
      stale = true;
    };
  }, [partner?.id, partner?.is_public]);

  const myGroups = useMemo(() => groupCopies(myCopies), [myCopies]);
  const partnerGroups = useMemo(() => groupCopies(partnerCopies), [partnerCopies]);
  const myCardIds = useMemo(() => new Set(myCopies.map((c) => c.card_id)), [myCopies]);

  const received = trades.filter((t) => t.status === 'pending' && t.receiver.id === user?.id);
  const sent = trades.filter((t) => t.status === 'pending' && t.proposer.id === user?.id);
  const history = trades.filter((t) => t.status !== 'pending');

  const activeTab: Tab = tab ?? (received.length > 0 ? 'received' : 'new');

  function choosePartner(id: string) {
    setOffered([]);
    setRequested([]);
    setNotice(null);
    setError(null);
    if (id) setSearchParams({ avec: id });
    else setSearchParams({});
  }

  async function submitProposal() {
    if (!partner) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    const { error: err } = await supabase.rpc('propose_trade', {
      p_receiver_id: partner.id,
      p_offered_ids: offered,
      p_requested_ids: requested,
      p_message: message.trim() || null,
    });
    setBusy(false);
    if (err) {
      setError(errorText(err));
      return;
    }
    setNotice(`Proposition envoyée à @${partner.username}.`);
    setOffered([]);
    setRequested([]);
    setMessage('');
    if (user) await loadTrades(user.id);
    setTab('sent');
  }

  async function respond(trade: TradeView, accept: boolean) {
    setBusy(true);
    setError(null);
    setNotice(null);
    const { data, error: err } = await supabase.rpc('respond_trade', {
      p_trade_id: trade.id,
      p_accept: accept,
    });
    setBusy(false);
    if (err) {
      setError(errorText(err));
    } else if (data === 'accepted') {
      setNotice('Échange réalisé ! Les cartes sont dans ta collection.');
    } else if (data === 'invalid') {
      setError("Cet échange n'est plus possible : certaines cartes ne sont plus disponibles.");
    } else {
      setNotice('Proposition refusée.');
    }
    if (user) await Promise.all([loadTrades(user.id), loadMyCopies(user.id)]);
  }

  async function cancel(trade: TradeView) {
    setBusy(true);
    setError(null);
    setNotice(null);
    const { error: err } = await supabase.rpc('cancel_trade', { p_trade_id: trade.id });
    setBusy(false);
    if (err) setError(errorText(err));
    else setNotice('Proposition annulée.');
    if (user) await loadTrades(user.id);
  }

  if (authLoading || loading) return <p>Chargement des échanges...</p>;

  if (!user) {
    return (
      <section className="panel-box">
        <h2 className="section-title">Échanges entre joueurs</h2>
        <p style={{ marginBottom: 0 }}>
          <Link to="/profil">Connecte-toi</Link> pour échanger tes pancartes avec les autres joueurs.
        </p>
      </section>
    );
  }

  const tabs: { key: Tab; label: string }[] = [
    { key: 'received', label: `Reçues (${received.length})` },
    { key: 'sent', label: `Envoyées (${sent.length})` },
    { key: 'new', label: 'Nouvel échange' },
    { key: 'history', label: 'Historique' },
  ];

  return (
    <div>
      <div className="section-header">
        <h2 className="section-title">Échanges</h2>
      </div>

      <div className="trade-tabs" role="tablist">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={activeTab === t.key}
            className={activeTab === t.key ? 'trade-tab is-active' : 'trade-tab'}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {error && <div className="alert-error">{error}</div>}
      {notice && <div className="alert-ok">{notice}</div>}

      {activeTab === 'received' &&
        (received.length === 0 ? (
          <p className="panel-box">Aucune proposition reçue pour le moment.</p>
        ) : (
          received.map((t) => (
            <TradeSummary key={t.id} trade={t} myId={user.id}>
              <button
                type="button"
                className="btn-primary"
                disabled={busy}
                onClick={() => void respond(t, true)}
              >
                Accepter
              </button>
              <button
                type="button"
                className="btn-secondary"
                disabled={busy}
                onClick={() => void respond(t, false)}
              >
                Refuser
              </button>
            </TradeSummary>
          ))
        ))}

      {activeTab === 'sent' &&
        (sent.length === 0 ? (
          <p className="panel-box">Aucune proposition en attente.</p>
        ) : (
          sent.map((t) => (
            <TradeSummary key={t.id} trade={t} myId={user.id}>
              <button
                type="button"
                className="btn-secondary"
                disabled={busy}
                onClick={() => void cancel(t)}
              >
                Annuler la proposition
              </button>
            </TradeSummary>
          ))
        ))}

      {activeTab === 'history' &&
        (history.length === 0 ? (
          <p className="panel-box">Aucun échange terminé.</p>
        ) : (
          history.map((t) => <TradeSummary key={t.id} trade={t} myId={user.id} />)
        ))}

      {activeTab === 'new' && (
        <section className="panel-box">
          <div className="field-group">
            <label className="field-label" htmlFor="trade-partner">
              Avec qui veux-tu échanger ?
            </label>
            <select
              id="trade-partner"
              className="field-select"
              value={partner?.id ?? ''}
              onChange={(e) => choosePartner(e.target.value)}
            >
              <option value="">Choisis un joueur…</option>
              {players.map((p) => (
                <option key={p.id} value={p.id}>
                  @{p.username}
                  {p.is_public ? '' : ' (collection privée)'}
                </option>
              ))}
            </select>
          </div>

          {partner && (
            <>
              <div className="trade-sides">
                <div>
                  <h4 className="trade-side-title">
                    Tu donnes ({offered.length}/{MAX_PER_SIDE})
                  </h4>
                  <CardPicker groups={myGroups} selected={offered} onChange={setOffered} />
                </div>
                <div>
                  <h4 className="trade-side-title">
                    Tu demandes à @{partner.username} ({requested.length}/{MAX_PER_SIDE})
                  </h4>
                  {partner.is_public ? (
                    <CardPicker
                      groups={partnerGroups}
                      selected={requested}
                      onChange={setRequested}
                      ownedByMe={myCardIds}
                    />
                  ) : (
                    <p className="trade-empty">
                      Ce joueur garde sa collection privée : tu ne peux pas voir ses cartes. Tu peux
                      quand même lui offrir des cartes.
                    </p>
                  )}
                </div>
              </div>

              <div className="field-group">
                <label className="field-label" htmlFor="trade-message">
                  Petit message (facultatif)
                </label>
                <textarea
                  id="trade-message"
                  className="field-textarea"
                  maxLength={300}
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                />
              </div>

              <button
                type="button"
                className="btn-primary"
                disabled={busy || offered.length + requested.length === 0}
                onClick={() => void submitProposal()}
              >
                {requested.length === 0 ? 'Offrir ces cartes' : 'Envoyer la proposition'}
              </button>
            </>
          )}
        </section>
      )}
    </div>
  );
}
