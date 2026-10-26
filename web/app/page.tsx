import Link from "next/link";

// =============================================================================
// SAGITTAIRE — landing.
// One viewport, centered on the textured red paper. The centaur is the star.
// Top bar: Docs (ghost) + Connect wallet (primary -> /app). Nothing else.
// No backend logic here — the live treasurer demo lives at /app.
// =============================================================================
export default function Home() {
  return (
    <main className="lp">
      <nav className="lp__bar">
        <Link className="lp__docs" href="/docs">
          Docs
        </Link>
        <Link className="sg-btn sg-btn--primary lp__connect" href="/app">
          Launch app
        </Link>
      </nav>

      <div className="lp__stage">
        {/* Crisp vector logo (regenerated from the real centaur vector). */}
        <img
          className="lp__mark"
          src="/brand/centaur-cream.svg"
          alt="Sagittaire — the centaur archer"
          width={414}
          height={481}
        />
        <h1 className="lp__title">Sagittaire</h1>
        <p className="lp__line">
          Your tokenized treasury keeps earning, and no one can read how much you hold.
        </p>
      </div>
    </main>
  );
}
