"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

// =============================================================================
// SAGITTAIRE — landing (scrollytelling).
//
// A tall intro stage (~220vh) with a sticky 100vh hero drives a scroll
// choreography. As the user scrolls DOWN, the hero travels UP and fades,
// revealing the protocol explanation rising into view beneath it:
//
//   0.00 → start: big black centaur centered, "Sagittaire" + one line, top bar.
//   ↓ (--p 0→0.42)  title + sentence FADE OUT and collapse upward.
//   ↓ (--p 0→1)     the centaur SHRINKS and RISES toward the small top-bar mark.
//   ↓ (--hero 0→1, late phase) the WHOLE hero surface lifts UP and fades out,
//                   clearing the viewport upward.
//   ↓ beneath it the protocol explanation sections RISE into view from below
//     (problem → stack → yield → lifecycle → close), each fading up via an
//     IntersectionObserver. All motion is UPWARD — nothing ever moves down.
//
// Scroll is driven in JS via a rAF-throttled scroll handler writing CSS custom
// properties on .sc (--p hero progress 0..1, --hero late lift/fade 0..1) — NOT
// CSS scroll-timeline, so it works in Safari. The background itself is a SINGLE
// fixed global paper layer (globals.css body::before/::after), identical at
// every scroll position — no parallax, no per-section paper, hence no seam.
// prefers-reduced-motion skips the choreography entirely and shows the static
// content (sections visible, hero at rest).
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

    const sections = Array.from(
      root.querySelectorAll<HTMLElement>(".sc__sec")
    );

    if (reduce) {
      // No choreography: hero rests in its start state, small mark shown so the
      // top bar stays branded, every section is immediately readable below.
      root.style.setProperty("--p", "0");
      root.style.setProperty("--hero", "0");
      sections.forEach((s) => s.classList.add("is-in"));
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

      // Late phase: once the centaur has mostly flown up (p > 0.6), the WHOLE
      // hero surface lifts UP and fades, clearing the viewport upward so the
      // story below is revealed. Mapped 0.6→1 of p to 0→1 of --hero.
      const hero = Math.min(1, Math.max(0, (p - 0.6) / 0.4));
      root.style.setProperty("--hero", hero.toFixed(4));

      // NOTE: no background parallax. The paper is a single fixed global layer
      // (body::before) that is identical at every scroll position — this is
      // what keeps the background seamless with zero horizontal band. The only
      // motion is UPWARD (hero rises out), which never exposes a paper edge.

      setScrolled(p > 0.55);
    };

    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);

    // Story reveal: each explanation section rises into view from below the
    // first time it enters the viewport. rootMargin lifts the trigger line a
    // little so sections are already settled as they clear the hero.
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            e.target.classList.add("is-in");
            io.unobserve(e.target);
          }
        }
      },
      { threshold: 0.18, rootMargin: "0px 0px -8% 0px" }
    );
    sections.forEach((s) => io.observe(s));

    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (raf) cancelAnimationFrame(raf);
      io.disconnect();
    };
  }, []);

  return (
    <main className="sc" ref={rootRef}>
      {/* The background (paper + wash) is a SINGLE global fixed layer painted at
          the body level in globals.css — identical on every route and at every
          scroll position, so there is no horizontal seam. No per-section paper
          lives here. */}

      {/* Persistent top bar. The shrunken centaur settles here once scrolled. */}
      <nav className={`sc__bar ${scrolled ? "is-scrolled" : ""}`}>
        <Link className="sc__home" href="/" aria-label="Sagittaire home">
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
              alt="Sagittaire, the centaur archer"
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
        </div>
      </section>

      {/* ===================================================================
          PROTOCOL EXPLANATION — redesigned in the Pendle spirit, Sagittaire DA.
          Punchy headers, short confident copy, strong in-brand diagrams.
          The background stays the single global seamless paper.
          =================================================================== */}
      <div className="sc__story">
        {/* (0) ONE-LINE THESIS — the whole protocol in a sentence, like a hero
            value prop. Sets the frame before any detail. */}
        <section className="sc__sec sc__sec--thesis">
          <p className="sc__kicker">Confidential RWA on Stellar</p>
          <h2 className="sc__thesis">
            Yield in the open.
            <br />
            <em>Balance under seal.</em>
          </h2>
          <p className="sc__lede">
            Tokenized treasuries keep earning on a public ledger. The amount you
            hold stays encrypted, and only an auditor can read it.
          </p>
        </section>

        {/* (1) THE TENSION — public ledger, one sealed row. Visual-first. */}
        <section className="sc__sec sc__sec--problem">
          <div className="sc__split">
            <div className="sc__split-copy">
              <p className="sc__kicker">The tension</p>
              <h2 className="sc__h2">Public rails leak private holdings.</h2>
              <p className="sc__body">
                On Stellar, every balance is legible to anyone with an explorer.
                For a treasury, that is a non-starter.
              </p>
            </div>
            <LedgerDiagram />
          </div>
        </section>

        {/* (2) THE STACK — three tokens, one job each. The core diagram, front
            and centre like Pendle's two-product block. */}
        <section className="sc__sec sc__sec--idea">
          <p className="sc__kicker">The stack</p>
          <h2 className="sc__h2 sc__h2--wide">Three tokens. Each does one thing.</h2>
          <FlowDiagram />
        </section>

        {/* (3) THE MECHANISM — why it stays hidden, as a single sharp claim +
            the rate diagram. Short copy. */}
        <section className="sc__sec sc__sec--yield">
          <div className="sc__split sc__split--rev">
            <div className="sc__split-copy">
              <p className="sc__kicker">Why it holds</p>
              <h2 className="sc__h2">Your share count never moves.</h2>
              <p className="sc__body">
                Interest lifts a <strong>public exchange rate</strong>, the same
                for everyone. Your sealed share count sits still, so value grows
                with nothing observable changing.
              </p>
            </div>
            <RateDiagram />
          </div>
        </section>

        {/* (4) WHAT YOU GET — a confident capability strip (Pendle's use-case
            tabs / metrics, re-cast as in-brand value tiles). */}
        <section className="sc__sec sc__sec--props">
          <p className="sc__kicker">What the protocol gives you</p>
          <ul className="sc__props">
            <li className="sc__prop">
              <span className="sc__prop-ic" aria-hidden="true">●</span>
              <h3>Sealed balances</h3>
              <p>Holdings live on-chain as encrypted commitments. Nothing to read.</p>
            </li>
            <li className="sc__prop">
              <span className="sc__prop-ic" aria-hidden="true">↔</span>
              <h3>Proven transfers</h3>
              <p>Amounts stay encrypted; a zero-knowledge proof keeps the maths honest.</p>
            </li>
            <li className="sc__prop">
              <span className="sc__prop-ic" aria-hidden="true">◆</span>
              <h3>Auditor view</h3>
              <p>One authorised key can decrypt for selective, compliant disclosure.</p>
            </li>
            <li className="sc__prop">
              <span className="sc__prop-ic" aria-hidden="true">⊘</span>
              <h3>Policy gate</h3>
              <p>Transfers to non-allowlisted accounts are refused on-chain, before settling.</p>
            </li>
          </ul>
        </section>

        {/* (5) THE LIFECYCLE — five crisp beats, kept as the editorial list. */}
        <section className="sc__sec sc__sec--life">
          <p className="sc__kicker">The lifecycle</p>
          <h2 className="sc__h2 sc__h2--wide">Deposit to confidential transfer, in five beats.</h2>

          <ol className="sc__life">
            <li className="sc__life-step">
              <h3>Deposit</h3>
              <p>Wrap the fund into shares, mint the confidential token. The balance becomes a sealed commitment.</p>
            </li>
            <li className="sc__life-step">
              <h3>Hidden yield</h3>
              <p>The public rate accrues. Your sealed share count is untouched.</p>
            </li>
            <li className="sc__life-step">
              <h3>Confidential transfer</h3>
              <p>Move shares to an eligible holder. Amounts encrypted, proof attached.</p>
            </li>
            <li className="sc__life-step">
              <h3>Auditor view</h3>
              <p>The auditor key rides each op. Only the auditor can decrypt.</p>
            </li>
            <li className="sc__life-step">
              <h3>Eligibility reject</h3>
              <p>A non-allowlisted recipient is refused by the policy gate on-chain.</p>
            </li>
          </ol>
        </section>

        {/* (6) CLOSING — one honest line + the three links. */}
        <section className="sc__sec sc__sec--close">
          <p className="sc__closingLine">
            Confidential, not anonymous.
            <br />
            Live on Stellar testnet today.
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
        Every amount is legible. The one Sagittaire holds is not.
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
      desc: "Yield-bearing fund. Balances grow as interest is paid, like any money-market position.",
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
