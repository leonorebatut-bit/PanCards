import type { Card } from '../types/database';

interface CardTileProps {
  card: Card;
}

export function CardTile({ card }: CardTileProps) {
  const formattedId = `N° ${String(card.id).padStart(4, '0')}`;

  return (
    <article className="pancarte-card">
      <div className="pancarte-card-top">
        <span>{formattedId}</span>
        <span>{card.original_filename}</span>
      </div>

      <div className="pancarte-card-img-wrap">
        <img
          src={card.thumb_url}
          alt={card.description || `Pancarte d'archive ${formattedId}`}
          className="pancarte-card-img"
          loading="lazy"
        />
      </div>

      <div className="pancarte-card-body">
        {card.description ? (
          <p style={{ margin: 0 }}>{card.description}</p>
        ) : (
          <span className="pancarte-card-empty-desc">
            Aucune légende enregistrée pour le moment.
          </span>
        )}
      </div>
    </article>
  );
}
