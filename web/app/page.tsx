"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

// =============================================================================
// SAGITTAIRE — landing (scrollytelling).
//
// A tall intro stage (~200vh) with a sticky 100vh hero drives a scroll
// choreography, then the protocol explanation unrolls below:
//
//   0.00 → start: big black centaur centered, "Sagittaire" + one line, top bar.
//   ↓ paper background parallaxes DOWN (unrolls), title + sentence FADE OUT.
//   ↓ the centaur SHRINKS and RISES toward a small mark in the top bar.
//   ↓ the protocol explanation sections arrive (problem → idea → yield →
//     lifecycle → close), with in-brand CSS/SVG diagrams, not cards.
//
// Scroll is driven in JS via a rAF-throttled scroll handler writing CSS custom
// properties (--p = hero progress 0..1, --bgY = parallax offset) — NOT CSS
// scroll-timeline, so it works in Safari. prefers-reduced-motion skips the
// choreography entirely and shows the static content.
//
// Presentation only. No backend/contract logic here — the live treasurer demo
// lives at /app and keeps calling NEXT_PUBLIC_BACKEND_URL.
// =============================================================================

const GITHUB = "https://github.com/abaresks24/confidential-rwa";

export default function Home() {
  const stageRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLElement>(null);
  const [scrolled, setScrolled] = useState(false); // top-bar gets the small mark

  useEffect(() => {
    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const root = rootRef.current;
    if (!root) return;

    if (reduce) {
      // No choreography: hero rests in its start state, small mark shown so the
      // top bar stays branded, content is immediately readable below.
      root.style.setProperty("--p", "0");
      root.style.setProperty("--bgY", "0px");
      setScrolled(true);
      return;
    }

    let raf = 0;
    const update = () => {
      raf = 0;
      const stage = stageRef.current;
      if (!stage) return;
      const vh = window.innerHeight;
      // The sticky hero is pinned for (stageHeight - vh) of scrolling.
      const start = stage.offsetTop;
      const span = stage.offsetHeight - vh;
      const raw = span > 0 ? (window.scrollY - start) / span : 0;
      const p = Math.min(1, Math.max(0, raw));
      root.style.setProperty("--p", p.toFixed(4));

      // Paper parallax: unroll downward as you scroll the whole document.
      // Slow factor keeps it subtle; the layer is oversized to never reveal an
      // edge. Positive = texture moves DOWN relative to viewport.
      const bgY = window.scrollY * 0.22;
      root.style.setProperty("--bgY", `${bgY.toFixed(1)}px`);

      setScrolled(p > 0.55);
    };

    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <main className="sc" ref={rootRef}>
      {/* Parallax paper layer — the REAL fine texture, unrolling as you scroll.
          Oversized + translated in JS so no edge is ever revealed. */}
      <div className="sc__paper" aria-hidden="true" />
      <div className="sc__wash" aria-hidden="true" />

      {/* Persistent top bar. The shrunken centaur settles here once scrolled. */}
      <nav className={`sc__bar ${scrolled ? "is-scrolled" : ""}`}>
        <Link className="sc__home" href="/" aria-label="Sagittaire — home">
          <img
            className="sc__bar-mark"
            src="/brand/centaur-cream.svg"
            alt=""
            width={30}
            height={35}
          />
          <span className="sc__bar-word">Sagittaire</span>
        </Link>
        <div className="sc__bar-actions">
          <Link className="sc__docs" href="/docs">
            Docs
          </Link>
          <Link className="sg-btn sg-btn--primary sc__launch" href="/app">
            Launch app
          </Link>
        </div>
      </nav>

      {/* INTRO STAGE — tall; the hero inside is sticky for the scroll story. */}
      <section className="sc__stage" ref={stageRef}>
        <div className="sc__sticky">
          <div className="sc__hero">
            <img
              className="sc__mark"
              src="/brand/centaur-ink.svg"
              alt="Sagittaire — the centaur archer"
              width={414}
              height={481}
            />
            <div className="sc__heroText">
              <h1 className="sc__title">Sagittaire</h1>
              <p className="sc__line">
                Your tokenized treasury keeps earning, and no one can read how
                much you hold.
              </p>
            </div>
          </div>
          <span className="sc__scrollcue" aria-hidden="true">
            Scroll
          </span>
        </div>
      </section>

      {/* ===================================================================
          PROTOCOL EXPLANATION — unrolls below the intro stage.
          Visual, in-brand CSS/SVG diagrams. Plain, honest copy.
          =================================================================== */}
      <div className="sc__story">
        {/* (a) THE PROBLEM — public balances on Stellar. */}
        <section className="sc__sec sc__sec--problem">
          <p className="sc__kicker">The problem</p>
          <h2 className="sc__h2">
            On Stellar, every balance is readable by anyone.
          </h2>
          <p className="sc__body">
            Tokenized real-world assets — treasury funds, money-market shares,
            tokenized bills — are arriving on public ledgers. But a balance on
            Stellar is open: anyone with an explorer can see exactly how much a
            treasury holds, and watch it move.
          </p>

          <LedgerDiagram />
        </section>

        {/* (b) THE IDEA — the three-layer flow. */}
        <section className="sc__sec sc__sec--idea">
          <p className="sc__kicker">The idea</p>
          <h2 className="sc__h2">
            Three layers: yield underneath, privacy on top.
          </h2>
          <p className="sc__body">
            A rebasing fund pays interest the familiar way. A wrapper turns that
            into a fixed number of shares whose value rises. A confidential
            token then seals the share count on-chain — so the holding earns in
            the open and is held in private.
          </p>

          <FlowDiagram />
        </section>

        {/* (c) WHY YIELD STAYS HIDDEN — stable share count, public rate rises. */}
        <section className="sc__sec sc__sec--yield">
          <p className="sc__kicker">Why the yield still stays hidden</p>
          <h2 className="sc__h2">
            The share count never changes. Only a public rate moves.
          </h2>
          <p className="sc__body">
            Interest does not mint new shares into your sealed balance. Instead
            the wrapper&rsquo;s exchange rate — public, the same for everyone —
            climbs over time. Your encrypted share count sits perfectly still,
            so nothing about your position leaks, yet its value grows.
          </p>

          <RateDiagram />
        </section>

        {/* (d) THE LIFECYCLE — deposit → hidden yield → transfer → audit → reject. */}
        <section className="sc__sec sc__sec--life">
          <p className="sc__kicker">The lifecycle</p>
          <h2 className="sc__h2">From deposit to a compliant, confidential transfer.</h2>

          <ol className="sc__life">
            <li className="sc__life-step">
              <h3>Deposit</h3>
              <p>
                Wrap the rebasing fund into shares and mint the confidential
                token. The on-chain balance becomes an encrypted commitment.
              </p>
            </li>
            <li className="sc__life-step">
              <h3>Hidden yield</h3>
              <p>
                The public exchange rate accrues. Your sealed share count is
                untouched — the position grows with nothing observable changing.
              </p>
            </li>
            <li className="sc__life-step">
              <h3>Confidential transfer</h3>
              <p>
                Move shares to another eligible holder. Amounts stay encrypted;
                a zero-knowledge proof convinces the chain the maths balances.
              </p>
            </li>
            <li className="sc__life-step">
              <h3>Auditor view</h3>
              <p>
                An authorised auditor&rsquo;s key rides each operation, so they
                — and only they — can decrypt the amount for selective
                disclosure.
              </p>
            </li>
            <li className="sc__life-step">
              <h3>Eligibility reject</h3>
              <p>
                A transfer to a non-allowlisted account is refused on-chain by
                the policy gate, before it can settle.
              </p>
            </li>
          </ol>
        </section>

        {/* (e) CLOSING — one honest line + the three links. */}
        <section className="sc__sec sc__sec--close">
          <p className="sc__closingLine">
            Confidential, not anonymous. Running on Stellar testnet today.
          </p>
          <div className="sc__closingLinks">
            <Link className="sg-btn sg-btn--primary" href="/app">
              Launch app
            </Link>
            <Link className="sc__ghostlink" href="/docs">
              Read the docs
            </Link>
            <a
              className="sc__ghostlink"
              href={GITHUB}
              target="_blank"
              rel="noreferrer"
            >
              GitHub ↗
            </a>
          </div>
          <img
            className="sc__sigil"
            src="/brand/centaur-ink.svg"
            alt=""
            width={120}
            height={140}
            aria-hidden="true"
          />
        </section>
      </div>
    </main>
  );
}

/* ---------------------------------------------------------------------------
   DIAGRAMS — pure SVG/CSS, in-brand. Presentation only.
   --------------------------------------------------------------------------- */

/** (a) A public ledger row with every figure exposed, vs one sealed figure. */
function LedgerDiagram() {
  return (
    <div className="dg dg--ledger" aria-hidden="true">
      <div className="dg-ledger-head">Public ledger</div>
      <ul className="dg-ledger-rows">
        <li>
          <span className="dg-ledger-acct">GTREASURY…K4OH</span>
          <span className="dg-ledger-amt dg-ledger-amt--open">
            12,480,000.00
          </span>
        </li>
        <li>
          <span className="dg-ledger-acct">GFUND… 7AH</span>
          <span className="dg-ledger-amt dg-ledger-amt--open">3,902,114.51</span>
        </li>
        <li className="is-sealed">
          <span className="dg-ledger-acct">GSAGITTAIRE…D4SU</span>
          <span className="dg-ledger-amt dg-ledger-amt--sealed">
            <span className="dg-seal" /> sealed
          </span>
        </li>
      </ul>
      <p className="dg-caption">
        Every amount is legible — except the one Sagittaire holds.
      </p>
    </div>
  );
}

/** (b) rtFUND → wsFUND → confidential, as a vertical in-brand flow. */
function FlowDiagram() {
  const nodes = [
    {
      name: "rtFUND",
      tag: "rebasing",
      desc: "Yield-bearing fund. Balances grow as interest is paid — like any money-market position.",
      kind: "ours",
    },
    {
      name: "wsFUND",
      tag: "ShareWrapper",
      desc: "Fixed share count; a public exchange rate rises instead of the balance. Non-rebasing.",
      kind: "ours",
    },
    {
      name: "confidential token",
      tag: "sealed",
      desc: "Encrypted share balance on-chain. Transfers prove correctness in zero knowledge.",
      kind: "sealed",
    },
  ];
  return (
    <div className="dg dg--flow" aria-hidden="true">
      {nodes.map((n, i) => (
        <div key={n.name} className="dg-flowcell">
          <div className={`dg-node dg-node--${n.kind}`}>
            <div className="dg-node-top">
              <span className="dg-node-name">{n.name}</span>
              <span className={`dg-node-tag dg-node-tag--${n.kind}`}>
                {n.tag}
              </span>
            </div>
            <p className="dg-node-desc">{n.desc}</p>
          </div>
          {i < nodes.length - 1 && (
            <span className="dg-flow-arrow" aria-hidden="true">
              <span className="dg-flow-line" />
              <span className="dg-flow-head" />
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

/** (c) Flat encrypted share bars while a public rate curve rises. */
function RateDiagram() {
  return (
    <div className="dg dg--rate" aria-hidden="true">
      <div className="dg-rate-col">
        <span className="dg-rate-label">Encrypted share count</span>
        <div className="dg-rate-bars">
          {[0, 1, 2, 3, 4].map((i) => (
            <span key={i} className="dg-rate-bar">
              <span className="dg-rate-lock" />
            </span>
          ))}
        </div>
        <span className="dg-rate-foot">unchanged · sealed</span>
      </div>

      <div className="dg-rate-col dg-rate-col--curve">
        <span className="dg-rate-label">Public exchange rate</span>
        <svg
          className="dg-rate-svg"
          viewBox="0 0 260 120"
          preserveAspectRatio="none"
          role="presentation"
        >
          <defs>
            <linearGradient id="rateFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="rgba(243,233,221,0.22)" />
              <stop offset="100%" stopColor="rgba(243,233,221,0)" />
            </linearGradient>
          </defs>
          <path
            d="M0,108 C70,104 120,86 170,58 C210,36 240,22 260,14 L260,120 L0,120 Z"
            fill="url(#rateFill)"
          />
          <path
            d="M0,108 C70,104 120,86 170,58 C210,36 240,22 260,14"
            fill="none"
            stroke="var(--cream)"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </svg>
        <span className="dg-rate-foot">rising · the same for everyone</span>
      </div>
    </div>
  );
}
