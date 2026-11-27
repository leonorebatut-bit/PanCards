import { Link } from 'react-router-dom';
import { Icon } from '../components/Icon';

export function HomePage() {
  return (
    <section className="home-hero">
      <h2 className="hero-headline">OUVRE DES BOOSTERS, COLLECTIONNE TOUTES LES PANCARTES !</h2>
      <Link to="/booster" className="btn-primary">
        <Icon name="booster" /> Ouvrir un booster
      </Link>
    </section>
  );
}
