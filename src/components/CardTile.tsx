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
          alt={card.original_filename}
          className="pancarte-card-img"
          loading="lazy"
        />
      </div>
      <div className="pancarte-card-body">
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.78rem' }}>
          {card.original_filename}
        </div>
        {card.description && (
          <p style={{ margin: '0.35rem 0 0', fontSize: '0.85rem' }}>{card.description}</p>
        )}
      </div>
    </Link>
  );
}
