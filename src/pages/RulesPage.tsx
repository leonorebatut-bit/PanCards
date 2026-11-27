export function RulesPage() {
  return (
    <section className="panel-box rules-page">
      <span className="hero-kicker">TIRAGE ÉQUIPROBABLE · 5 PANCARTES</span>
      <h2 className="hero-headline" style={{ fontSize: '1.8rem' }}>
        Règles
      </h2>
      <p>
        Chaque booster contient 5 photographies tirées au sort parmi l&apos;ensemble des
        pancartes publiées. Un booster gratuit se recharge toutes les 15 minutes
        (plafond : 8 boosters).
      </p>
      <ul>
        <li>Un booster supplémentaire s&apos;achète 200 poubelles.</li>
        <li>Défausser un doublon rapporte 10 poubelles.</li>
        <li>
          Ta première note et ton premier commentaire sur une carte rapportent chacun
          1 poubelle.
        </li>
        <li>Une pancarte proposée puis validée rapporte 100 poubelles.</li>
        <li>La note moyenne d&apos;une carte s&apos;affiche à partir de 6 votes.</li>
        <li>Un commentaire privé n&apos;est visible que par toi.</li>
      </ul>
    </section>
  );
}
