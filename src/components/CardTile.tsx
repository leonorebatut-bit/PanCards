import { Link } from 'react-router-dom';
import type { Card } from '../types/database';

export function CardTile({ card }: { card: Card }) {
  return (
    <Link to={`/pancarte/${card.id}`} className="pancarte-card" style={{ display: 'block' }}>
      <div className="pancarte-card-top">
        <span>N° {String(card.id).padStart(4, '0')}</span>
        <span>VOIR LA FICHE →</span>
      </div>
      <div className="pancarte-card-img-wrap">
        <img
          src={card.thumb_url}
          alt={`Pancarte n° ${card.id}`}
          className="pancarte-card-img"
          loading="lazy"
        />
      </div>
      {card.description && (
        <div className="pancarte-card-body">
          <p style={{ margin: 0, fontSize: '0.85rem' }}>{card.description}</p>
        </div>
      )}
    </Link>
  );
}
