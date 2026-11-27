import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import { Icon } from '../components/Icon';
import type {
  Card,
  CollectionCardLink,
  CollectionFolder,
  UserCardCopy,
} from '../types/database';

type SortOption =
  | 'alpha'
  | 'acquired_desc'
  | 'oldest'
  | 'newest'
  | 'personal_rating'
  | 'copies_desc';

interface GroupedCardEntry {
  card: Card;
  copies: UserCardCopy[];
  count: number;
  firstAcquiredAt: string;
  lastAcquiredAt: string;
  personalRating: number | null;
}

export function CollectionPage() {
  const { user, loading: authLoading, refreshProfile } = useAuth();

  const [rawCopies, setRawCopies] = useState<UserCardCopy[]>([]);
  const [folders, setFolders] = useState<CollectionFolder[]>([]);
  const [folderLinks, setFolderLinks] = useState<CollectionCardLink[]>([]);
  const [ratingsMap, setRatingsMap] = useState<Record<number, number>>({});
  const [loading, setLoading] = useState(true);
  const [feedback, setFeedback] = useState<string | null>(null);

  // Filtres et tri
  const [search, setSearch] = useState('');
  const [onlyDuplicates, setOnlyDuplicates] = useState(false);
  const [selectedFolderId, setSelectedFolderId] = useState<string>('all');
  const [sortBy, setSortBy] = useState<SortOption>('acquired_desc');

  // Sélection multiple de cartes (card_id)
  const [selectedCardIds, setSelectedCardIds] = useState<number[]>([]);
  const [targetFolderId, setTargetFolderId] = useState<string>('');

  // Création de dossier
  const [newFolderName, setNewFolderName] = useState('');
  const [newFolderDesc, setNewFolderDesc] = useState('');

  async function loadAllCollectionData(uid: string) {
    setLoading(true);
    const [ucRes, colRes, ratRes] = await Promise.all([
      supabase
        .from('user_cards')
        .select('id, user_id, card_id, acquired_at, source, card:cards(*)')
        .eq('user_id', uid),
      supabase
        .from('collections')
        .select('*')
        .eq('user_id', uid)
        .order('created_at', { ascending: false }),
      supabase.from('ratings').select('card_id, stars').eq('user_id', uid),
    ]);

    if (!ucRes.error && ucRes.data) {
      const normalized = (
        ucRes.data as unknown as Array<
          Omit<UserCardCopy, 'card'> & { card: Card | null }
        >
      )
        .filter((r) => r.card !== null)
        .map((r) => ({ ...r, card: r.card! }));
      setRawCopies(normalized);
    }

    if (!colRes.error && colRes.data) {
      const folderList = colRes.data as CollectionFolder[];
      setFolders(folderList);
      if (folderList.length > 0) {
        const ids = folderList.map((f) => f.id);
        const { data: linksData } = await supabase
          .from('collection_cards')
          .select('*')
          .in('collection_id', ids);
        setFolderLinks((linksData as CollectionCardLink[]) ?? []);
        setTargetFolderId((prev) => prev || folderList[0].id);
      } else {
        setFolderLinks([]);
      }
    }

    if (!ratRes.error && ratRes.data) {
      const rMap: Record<number, number> = {};
      for (const item of ratRes.data as { card_id: number; stars: number }[]) {
        rMap[item.card_id] = item.stars;
      }
      setRatingsMap(rMap);
    }

    setLoading(false);
  }

  useEffect(() => {
    if (user?.id) {
      void loadAllCollectionData(user.id);
    } else if (!authLoading) {
      setLoading(false);
    }
  }, [user?.id, authLoading]);

  const groupedCards = useMemo<GroupedCardEntry[]>(() => {
    const map = new Map<number, UserCardCopy[]>();
    for (const copy of rawCopies) {
      const list = map.get(copy.card_id) ?? [];
      list.push(copy);
      map.set(copy.card_id, list);
    }

    const entries: GroupedCardEntry[] = [];
    for (const [cardId, copies] of map.entries()) {
      const sortedByDate = [...copies].sort(
        (a, b) =>
          new Date(a.acquired_at).getTime() - new Date(b.acquired_at).getTime()
      );
      entries.push({
        card: copies[0].card,
        copies: sortedByDate,
        count: copies.length,
        firstAcquiredAt: sortedByDate[0].acquired_at,
        lastAcquiredAt: sortedByDate[sortedByDate.length - 1].acquired_at,
        personalRating: ratingsMap[cardId] ?? null,
      });
    }

    const q = search.trim().toLowerCase();
    const filtered = entries.filter((entry) => {
      if (onlyDuplicates && entry.count < 2) return false;
      if (selectedFolderId !== 'all') {
        const inFolder = folderLinks.some(
          (l) =>
            l.collection_id === selectedFolderId && l.card_id === entry.card.id
        );
        if (!inFolder) return false;
      }
      if (q) {
        const hay = `${entry.card.id} ${
          entry.card.description ?? ''
        } ${entry.card.extra_info ?? ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    filtered.sort((a, b) => {
      switch (sortBy) {
        case 'alpha':
          return a.card.id - b.card.id;
        case 'acquired_desc':
          return (
            new Date(b.lastAcquiredAt).getTime() -
            new Date(a.lastAcquiredAt).getTime()
          );
        case 'newest':
          return b.card.id - a.card.id;
        case 'oldest':
          return a.card.id - b.card.id;
        case 'personal_rating':
          return (b.personalRating ?? -1) - (a.personalRating ?? -1);
        case 'copies_desc':
          return b.count - a.count;
        default:
          return 0;
      }
    });

    return filtered;
  }, [
    rawCopies,
    ratingsMap,
    search,
    onlyDuplicates,
    selectedFolderId,
    folderLinks,
    sortBy,
  ]);

  const toggleSelectCard = (cardId: number) => {
    setSelectedCardIds((prev) =>
      prev.includes(cardId)
        ? prev.filter((id) => id !== cardId)
        : [...prev, cardId]
    );
  };

  const handleCreateFolder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !newFolderName.trim()) return;
    setFeedback(null);

    const { data, error } = await supabase
      .from('collections')
      .insert({
        user_id: user.id,
        name: newFolderName.trim(),
        description: newFolderDesc.trim(),
      })
      .select()
      .single();

    if (error) {
      setFeedback(`Erreur création dossier : ${error.message}`);
    } else if (data) {
      setFolders((prev) => [data as CollectionFolder, ...prev]);
      setTargetFolderId(data.id);
      setNewFolderName('');
      setNewFolderDesc('');
      setFeedback('Dossier créé.');
    }
  };

  const handleDeleteFolder = async (folderId: string) => {
    setFeedback(null);
    const { error } = await supabase
      .from('collections')
      .delete()
      .eq('id', folderId);
    if (error) {
      setFeedback(`Suppression impossible : ${error.message}`);
    } else {
      setFolders((prev) => prev.filter((f) => f.id !== folderId));
      setFolderLinks((prev) => prev.filter((l) => l.collection_id !== folderId));
      if (selectedFolderId === folderId) setSelectedFolderId('all');
      setFeedback('Dossier supprimé (les cartes restent dans ta collection).');
    }
  };

  const handleAddSelectionToFolder = async () => {
    if (!targetFolderId || selectedCardIds.length === 0) return;
    setFeedback(null);

    const rows = selectedCardIds.map((cardId) => ({
      collection_id: targetFolderId,
      card_id: cardId,
    }));

    const { error } = await supabase
      .from('collection_cards')
      .upsert(rows, { onConflict: 'collection_id,card_id' });

    if (error) {
      setFeedback(`Erreur ajout au dossier : ${error.message}`);
    } else {
      await loadAllCollectionData(user!.id);
      setSelectedCardIds([]);
      setFeedback('Cartes ajoutées au dossier.');
    }
  };

  const handleRemoveCardFromFolder = async (folderId: string, cardId: number) => {
    const { error } = await supabase
      .from('collection_cards')
      .delete()
      .eq('collection_id', folderId)
      .eq('card_id', cardId);

    if (!error) {
      setFolderLinks((prev) =>
        prev.filter(
          (l) => !(l.collection_id === folderId && l.card_id === cardId)
        )
      );
    }
  };

  const handleDiscardDuplicatesOfSelection = async () => {
    if (!user || selectedCardIds.length === 0) return;

    const copyIdsToDiscard: string[] = [];
    for (const entry of groupedCards) {
      if (selectedCardIds.includes(entry.card.id) && entry.copies.length > 1) {
        for (let i = 1; i < entry.copies.length; i++) {
          copyIdsToDiscard.push(entry.copies[i].id);
        }
      }
    }

    if (copyIdsToDiscard.length === 0) {
      setFeedback(
        'Aucun doublon en surplus dans ta sélection (seuls les exemplaires en double sont défaussés par cette action).'
      );
      return;
    }

    const confirmed = window.confirm(
      `Défausser ${copyIdsToDiscard.length} doublon(s) pour gagner +${
        copyIdsToDiscard.length * 10
      } poubelles ? Cette action est irréversible.`
    );
    if (!confirmed) return;

    const { data, error } = await supabase.rpc('discard_user_cards', {
      p_user_card_ids: copyIdsToDiscard,
    });

    if (error) {
      setFeedback(`Erreur lors de la défausse : ${error.message}`);
    } else {
      const res = Array.isArray(data) ? data[0] : null;
      setFeedback(
        res
          ? `${res.discarded_count} doublon(s) défaussé(s) (+${res.total_earned} poubelles).`
          : 'Doublons défaussés.'
      );
      setSelectedCardIds([]);
      await loadAllCollectionData(user.id);
      await refreshProfile();
    }
  };

  if (authLoading || loading) {
    return <p>Chargement de ta collection...</p>;
  }

  if (!user) {
    return (
      <div className="panel-box">
        <h2 className="hero-headline" style={{ fontSize: '1.6rem' }}>
          Connexion requise
        </h2>
        <p>Connecte-toi pour consulter et organiser ta collection personnelle.</p>
        <Link to="/profil" className="btn-primary">
          Aller à la connexion →
        </Link>
      </div>
    );
  }

  return (
    <div>
      <div className="section-header">
        <h2 className="section-title">
          Ma collection ({rawCopies.length} exemplaires · {groupedCards.length}{' '}
          visibles)
        </h2>
        <span className="section-meta">
          {selectedCardIds.length} sélectionnée(s)
        </span>
      </div>

      {feedback && <div className="alert-ok">{feedback}</div>}

      {/* Barre de recherche, filtre et tri */}
      <div className="panel-box">
        <div className="toolbar-grid">
          <div className="field-group" style={{ margin: 0 }}>
            <label className="field-label" htmlFor="search-cards">
              Recherche
            </label>
            <input
              id="search-cards"
              className="field-input"
              type="search"
              placeholder="N°, légende..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <div className="field-group" style={{ margin: 0 }}>
            <label className="field-label" htmlFor="sort-cards">
              Trier par
            </label>
            <select
              id="sort-cards"
              className="field-select"
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as SortOption)}
            >
              <option value="acquired_desc">Date d&apos;obtention (récent)</option>
              <option value="alpha">Par numéro</option>
              <option value="newest">Cartes les plus récentes</option>
              <option value="oldest">Cartes les plus anciennes</option>
              <option value="personal_rating">Notes personnelles</option>
              <option value="copies_desc">Doublons / exemplaires</option>
            </select>
          </div>

          <div className="field-group" style={{ margin: 0 }}>
            <label className="field-label" htmlFor="filter-folder">
              Dossier
            </label>
            <select
              id="filter-folder"
              className="field-select"
              value={selectedFolderId}
              onChange={(e) => setSelectedFolderId(e.target.value)}
            >
              <option value="all">Toute la collection</option>
              {folders.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: '1rem',
          }}
        >
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
            <input
              type="checkbox"
              checked={onlyDuplicates}
              onChange={(e) => setOnlyDuplicates(e.target.checked)}
            />
            <span className="field-label" style={{ margin: 0 }}>
              Afficher uniquement les cartes en doublon (2+ exemplaires)
            </span>
          </label>

          {selectedCardIds.length > 0 && (
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              {folders.length > 0 && (
                <>
                  <select
                    className="field-select"
                    style={{ width: 'auto' }}
                    value={targetFolderId}
                    onChange={(e) => setTargetFolderId(e.target.value)}
                  >
                    {folders.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.name}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="btn-primary"
                    onClick={handleAddSelectionToFolder}
                  >
                    Ajouter {selectedCardIds.length} carte(s) au dossier
                  </button>
                </>
              )}
              <button
                type="button"
                className="btn-danger"
                onClick={handleDiscardDuplicatesOfSelection}
              >
                Défausser les doublons (+10 / carte)
              </button>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setSelectedCardIds([])}
              >
                Tout désélectionner
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Gestion des dossiers personnalisés */}
      <div className="panel-box">
        <h3 className="section-title" style={{ marginBottom: '0.85rem' }}>
          Dossiers personnalisés
        </h3>

        <form
          onSubmit={handleCreateFolder}
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
            gap: '0.75rem',
            marginBottom: '1rem',
          }}
        >
          <input
            className="field-input"
            type="text"
            placeholder="Nom du dossier (ex. Grèves, Climat...)"
            value={newFolderName}
            onChange={(e) => setNewFolderName(e.target.value)}
            required
          />
          <input
            className="field-input"
            type="text"
            placeholder="Description facultative"
            value={newFolderDesc}
            onChange={(e) => setNewFolderDesc(e.target.value)}
          />
          <button type="submit" className="btn-secondary">
            + Créer le dossier
          </button>
        </form>

        {folders.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.6rem' }}>
            {folders.map((folder) => {
              const countInFolder = folderLinks.filter(
                (l) => l.collection_id === folder.id
              ).length;
              return (
                <div
                  key={folder.id}
                  style={{
                    border: '2px solid var(--color-black)',
                    backgroundColor: 'var(--color-paper)',
                    padding: '0.5rem 0.75rem',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.65rem',
                  }}
                >
                  <div>
                    <strong>{folder.name}</strong>{' '}
                    <span className="section-meta">({countInFolder} cartes)</span>
                    {folder.description && (
                      <div style={{ fontSize: '0.8rem' }}>{folder.description}</div>
                    )}
                  </div>
                  <button
                    type="button"
                    className="btn-danger"
                    style={{ padding: '0.25rem 0.5rem', fontSize: '0.72rem' }}
                    onClick={() => handleDeleteFolder(folder.id)}
                  >
                    Suppr.
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Grille des cartes de la collection */}
      {groupedCards.length === 0 ? (
        <div className="panel-box">
          <p style={{ margin: 0 }}>
            Aucune pancarte ne correspond aux critères actuels.
          </p>
        </div>
      ) : (
        <div className="cards-grid">
          {groupedCards.map((entry) => {
            const isSelected = selectedCardIds.includes(entry.card.id);
            const cardFolderIds = folderLinks
              .filter((l) => l.card_id === entry.card.id)
              .map((l) => l.collection_id);

            return (
              <article
                key={entry.card.id}
                className="pancarte-card"
                style={{
                  outline: isSelected ? '3px solid var(--color-red)' : 'none',
                }}
              >
                <div className="pancarte-card-top">
                  <label
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.35rem',
                      cursor: 'pointer',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleSelectCard(entry.card.id)}
                    />
                    <span>N° {String(entry.card.id).padStart(4, '0')}</span>
                  </label>

                  {entry.count > 1 ? (
                    <span className="badge-dup">DOUBLON ×{entry.count}</span>
                  ) : (
                    <span className="badge-unique">×1 EXEMPLAIRE</span>
                  )}
                </div>

                <Link
                  to={`/pancarte/${entry.card.id}`}
                  className="pancarte-card-img-wrap"
                  style={{ display: 'block' }}
                  title="Voir, noter ou commenter cette carte"
                >
                  <img
                    src={entry.card.thumb_url}
                    alt={`Pancarte n° ${entry.card.id}`}
                    className="pancarte-card-img"
                    loading="lazy"
                  />
                </Link>

                <div className="pancarte-card-body">
                  <div
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: '0.76rem',
                      marginBottom: '0.35rem',
                    }}
                  >
                    {entry.personalRating !== null && (
                      <>
                        <Icon name="star" size={12} filled /> {entry.personalRating}/5
                      </>
                    )}
                  </div>

                  {selectedFolderId !== 'all' &&
                    cardFolderIds.includes(selectedFolderId) && (
                      <button
                        type="button"
                        className="btn-secondary"
                        style={{
                          padding: '0.2rem 0.45rem',
                          fontSize: '0.72rem',
                          marginTop: '0.25rem',
                        }}
                        onClick={() =>
                          handleRemoveCardFromFolder(
                            selectedFolderId,
                            entry.card.id
                          )
                        }
                      >
                        Retirer de ce dossier
                      </button>
                    )}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
