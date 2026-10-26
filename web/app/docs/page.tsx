"use client";

import Image from "next/image";
import Link from "next/link";
import { useFreighter } from "@/components/useFreighter";

// =============================================================================
// SAGITTAIRE — full protocol documentation (/docs).
// An editorial reading sheet on the textured red paper. Serif headings, Inter
// body, a readable parchment column, a pure-CSS architecture diagram, the live
// contracts table, and honest caveats. Presentation only — the single live
// action is Freighter connect in the top bar (same hook as /app).
// Source of truth: docs/ARCHITECTURE.md, deployments/testnet.json,
// circuits/README.md.
// =============================================================================

const GITHUB = "https://github.com/abaresks24/confidential-rwa";
const EXPLORER = "https://stellar.expert/explorer/testnet/contract/";

// Deployed testnet contract IDs — read from deployments/testnet.json.
const CONTRACTS: {
  name: string;
  id: string;
  origin: "ours" | "oz";
  role: string;
}[] = [
  {
    name: "rtFUND",
    id: "CDTZL6HUYZMC2FVX5QNSY5YWF2ALELI6IRZKJ4OHLJ4B5P5NWBXBUZJU",
    origin: "ours",
    role: "Mock rebasing RWA (SEP-41). Balances grow via an admin accrue(bps) — BENJI-like interest paid as new shares.",
  },
  {
    name: "wsFUND",
    id: "CCQNKSFQNWJINCOMYVCVWHC6SYNTS3MU7G6SF3XMKDMC4VVVTETOY3AH",
    origin: "ours",
    role: "ShareWrapper (SEP-41). wstETH-style non-rebasing shares over rtFUND; deposit / redeem / exchange_rate. The novel adapter.",
  },
  {
    name: "compliant_token",
    id: "CDJRMM26MSY6FNCG53OIED74C5UJ5OPBHKNG4LZA2ZTKSV25QWNPD4SU",
    origin: "oz",
    role: "OpenZeppelin confidential token over wsFUND. Holds encrypted share balances as Pedersen commitments.",
  },
  {
    name: "verifier",
    id: "CDI4DXFNVFPJXI7HA5PN4PEGVDE6YEA7AWUOV2ZV6RLCNFXD7YI4BO3E",
    origin: "oz",
    role: "On-chain UltraHonk proof verifier against the pinned per-operation verification keys.",
  },
  {
    name: "auditor",
    id: "CCI6UCDLXQU7FPDVWZNHYAXCQXBW2HYT4XFTUC6ME6LTX2UOWSX7SO6P",
    origin: "oz",
    role: "Auditor registry. The auditor's key rides each operation's ECDH ciphertext for selective disclosure.",
  },
  {
    name: "allowlist_policy",
    id: "CABO3F5CJU5J4AUARCR6N6KTGPRGNEAQBYLBR3M27ZTACGHJJ3JNGUVY",
    origin: "oz",
    role: "Eligibility gate (OZ allowlist-policy / Policy trait). The sole on-chain eligibility check; rejects non-allowlisted accounts.",
  },
  {
    name: "factory",
    id: "CA5KJS2XWA74M727HVPQGRVGFBNTC4NONV67PBI46ZQCNDSB44F2BG3F",
    origin: "oz",
    role: "OZ confidential-token factory that deployed and wired the suite.",
  },
];

const TOC = [
  ["problem", "The problem"],
  ["idea", "The idea"],
  ["yield", "Why yield stays hidden"],
  ["confidential", "The confidential layer"],
  ["lifecycle", "The lifecycle"],
  ["architecture", "Architecture"],
  ["caveats", "Honest caveats"],
  ["contracts", "Deployed contracts"],
] as const;

export default function Docs() {
  const { wallet, connect } = useFreighter();

  return (
    <main className="doc">
      <nav className="doc__bar">
        <Link className="doc__home" href="/">
          <Image src="/brand/mark-cream.png" alt="Sagittaire — back to home" width={30} height={30} />
          <span>Sagittaire</span>
        </Link>
        {wallet.address ? (
          <span className="doc__wallet" title={wallet.address}>
            Wallet {wallet.address.slice(0, 6)}…{wallet.address.slice(-6)}
          </span>
        ) : (
          <button className="primary doc__connect" onClick={connect} disabled={wallet.connecting}>
            {wallet.connecting ? <span className="spinner" /> : "Connect wallet"}
          </button>
        )}
      </nav>

      <div className="doc__layout">
        <article className="doc__sheet doc__sheet--long">
          <p className="doc__eyebrow">Protocol documentation</p>
          <h1 className="doc__h1">A treasury that earns in the open and holds in private.</h1>
          <p className="doc__lede">
            Sagittaire makes a yield-bearing real-world asset <em>confidential</em> on Stellar: the
            fund keeps paying interest like any money-market position, but the size of your holding is
            sealed on the public ledger. This is a walkthrough of how it works, what is real on
            testnet today, and what is honestly still a demo.
          </p>

          {/* 1 — PROBLEM ----------------------------------------------------- */}
          <section id="problem" className="doc__section">
            <span className="doc__num">§1 · The problem</span>
            <h2 className="doc__h2">Every balance on Stellar is public.</h2>
            <p>
              Tokenized real-world assets — treasury funds, money-market shares, tokenized bills — are
              arriving on Stellar. But a Stellar balance is readable by anyone with a block explorer.
              For a tokenized fund that means a company&apos;s entire treasury position, its size and its
              counterparties, is in the clear. No institution runs its balance sheet on a public
              spreadsheet, so the thing that makes the ledger trustworthy is exactly what keeps serious
              capital off it.
            </p>
            <p>
              The fix cannot be &quot;hide everything.&quot; A fund still has to pay yield in public, pass
              eligibility checks, and answer to a regulator. The size of a position needs to be private;
              its legitimacy does not.
            </p>
          </section>

          <hr className="doc__rule" />

          {/* 2 — IDEA -------------------------------------------------------- */}
          <section id="idea" className="doc__section">
            <span className="doc__num">§2 · The idea</span>
            <h2 className="doc__h2">Slip a non-rebasing share token in front of the rebasing fund.</h2>
            <p>
              OpenZeppelin ships a complete confidential-token stack for Stellar — encrypted balances,
              UltraHonk proofs, an auditor, freeze and clawback, a factory. But its confidential token
              assumes a <strong>non-rebasing underlying</strong>: a token whose balances never change on
              their own, with no fee-on-transfer and a deterministic revert.
            </p>
            <p>
              Yield-bearing RWAs break that assumption. Funds like Franklin Templeton&apos;s BENJI{" "}
              <strong>rebase</strong> — interest is paid as new shares, so every holder&apos;s balance
              grows on its own. You cannot wrap a rebasing token directly without violating the invariant
              the confidential token relies on.
            </p>
            <p>
              Sagittaire&apos;s contribution is the adapter that lifts that limitation without breaking it:
              a <code>wstETH</code>-style, non-rebasing <strong>ShareWrapper</strong> (wsFUND) that sits
              between the rebasing RWA (rtFUND) and the OpenZeppelin confidential token.
            </p>

            <div className="doc__insight">
              <div className="doc__insight-k">The invariant, kept</div>
              <p>
                wsFUND represents a <strong>fixed share count</strong>. When interest accrues, the number
                of shares you hold does not move — only how much fund each share is worth. So the token
                the confidential layer wraps is genuinely non-rebasing, and OpenZeppelin&apos;s assumption
                holds exactly. The limitation is lifted by construction, not by patching OZ.
              </p>
            </div>
          </section>

          <hr className="doc__rule" />

          {/* 3 — WHY YIELD STAYS HIDDEN -------------------------------------- */}
          <section id="yield" className="doc__section">
            <span className="doc__num">§3 · Why yield stays hidden</span>
            <h2 className="doc__h2">The encrypted number is a share count. Yield is a public rate.</h2>
            <p>
              The value sealed inside the confidential token is a <strong>stable share count</strong> —
              it only changes when you deposit, transfer, or redeem. It does not move when the fund earns
              interest.
            </p>
            <p>
              Yield surfaces instead as a <strong>public exchange rate</strong>: how much rtFUND one
              wsFUND share is worth. When the issuer calls <code>accrue()</code> on rtFUND, the wrapper&apos;s
              exchange rate rises for everyone. Your hidden share count is unchanged — but the same shares
              now redeem for more fund than you deposited. The private part (how many shares) and the
              public part (what a share is worth) are cleanly separated, so confidentiality and yield
              compose without fighting each other.
            </p>
          </section>

          <hr className="doc__rule" />

          {/* 4 — CONFIDENTIAL LAYER ------------------------------------------ */}
          <section id="confidential" className="doc__section">
            <span className="doc__num">§4 · The confidential layer</span>
            <h2 className="doc__h2">Hidden balances, provable operations, a permissioned reveal.</h2>
            <p>
              On the ledger, a holder&apos;s confidential balance is stored only as a{" "}
              <strong>Pedersen commitment</strong> on the Grumpkin curve — there is no plaintext amount
              anywhere in storage. Every state-changing operation carries an <strong>UltraHonk proof</strong>{" "}
              that the hidden arithmetic is valid, checked on-chain by the verifier contract against a set
              of pinned verification keys (one per operation: register, withdraw, transfer, and so on).
            </p>
            <p>
              <strong>Eligibility is inherited from an allowlist policy.</strong> The confidential token&apos;s
              underlying is plain wsFUND (not a SAC passthrough), so the allowlist policy is the sole
              on-chain eligibility gate. A transfer or register to a non-allowlisted account is{" "}
              <strong>rejected by the contract</strong>, not merely hidden by the UI.
            </p>
            <p>
              <strong>An auditor can still see.</strong> Each operation attaches an ECDH ciphertext to the
              registered auditor key, so a permissioned auditor can recover a holder&apos;s true balance and
              the amount of a transfer — selective disclosure for a regulator, without weakening privacy
              against everyone else.
            </p>

            <div className="doc__insight">
              <div className="doc__insight-k">Be precise: confidential, not anonymous</div>
              <p>
                The UltraHonk proofs used here are the <strong>non-ZK</strong> variant — they prove the
                operation is valid but are not witness-hiding. Balances are hidden as commitments; the
                operations are not anonymous. This matches OpenZeppelin&apos;s own caveat and is a
                deliberate, honest scope.
              </p>
            </div>
          </section>

          <hr className="doc__rule" />

          {/* 5 — LIFECYCLE --------------------------------------------------- */}
          <section id="lifecycle" className="doc__section">
            <span className="doc__num">§5 · The lifecycle</span>
            <h2 className="doc__h2">From eligibility to private yield, step by step.</h2>
            <div className="doc__life">
              <div className="doc__life-step">
                <div className="doc__life-body">
                  <h3>Register</h3>
                  <p>
                    An allowlisted holder registers with the confidential token, posting an identity
                    commitment with a real contract-bound proof. The allowlist policy gates who may enter.
                  </p>
                </div>
              </div>
              <div className="doc__life-step">
                <div className="doc__life-body">
                  <h3>Deposit</h3>
                  <p>
                    The holder deposits rtFUND into the wrapper, receiving non-rebasing wsFUND shares,
                    then deposits those shares into the confidential token. Their on-ledger balance becomes
                    a Pedersen commitment — hidden.
                  </p>
                </div>
              </div>
              <div className="doc__life-step">
                <div className="doc__life-body">
                  <h3>Accrue</h3>
                  <p>
                    The issuer calls <code>accrue()</code> on rtFUND to simulate interest. The wrapper&apos;s
                    public exchange rate rises; the holder&apos;s hidden share count does not change.
                  </p>
                </div>
              </div>
              <div className="doc__life-step">
                <div className="doc__life-body">
                  <h3>Confidential transfer (P2P, real)</h3>
                  <p>
                    The holder sends shares to another eligible, confidentially-registered account. The
                    amount is a commitment carried by a real proof; recipient and sender channels both
                    update privately.
                  </p>
                </div>
              </div>
              <div className="doc__life-step">
                <div className="doc__life-body">
                  <h3>Auditor decrypt</h3>
                  <p>
                    Using the registered auditor key, the auditor recovers the true transferred amount and
                    balance from the ECDH ciphertext — the regulator&apos;s view.
                  </p>
                </div>
              </div>
              <div className="doc__life-step">
                <div className="doc__life-body">
                  <h3>Eligibility reject</h3>
                  <p>
                    A transfer or register aimed at a non-allowlisted address is rejected on-chain by the
                    policy — proof that eligibility is enforced by the contract, not the interface.
                  </p>
                </div>
              </div>
              <div className="doc__life-step">
                <div className="doc__life-body">
                  <h3>Redeem with yield</h3>
                  <p>
                    The holder redeems the same hidden share count back through the wrapper and receives{" "}
                    <strong>more rtFUND than they deposited</strong> — private yield realized, the amount
                    still never exposed on the ledger.
                  </p>
                </div>
              </div>
            </div>
          </section>

          <hr className="doc__rule" />

          {/* 6 — ARCHITECTURE ------------------------------------------------ */}
          <section id="architecture" className="doc__section">
            <span className="doc__num">§6 · Architecture</span>
            <h2 className="doc__h2">Three layers, one hidden number.</h2>
            <p className="doc__kicker">
              rtFUND rebases; wsFUND fixes the share count; the confidential token encrypts it. Red is our
              contribution, plum is composed from OpenZeppelin.
            </p>

            <div
              className="doc__diagram"
              role="img"
              aria-label="Three-layer architecture: rtFUND rebasing RWA, deposited into wsFUND non-rebasing ShareWrapper, deposited into the OpenZeppelin CompliantToken which holds encrypted Pedersen-commitment balances."
            >
              <div className="doc__node doc__node--ours">
                <div className="doc__node-top">
                  <span className="doc__node-name">rtFUND</span>
                  <span className="doc__node-tag doc__node-tag--ours">Ours</span>
                </div>
                <p className="doc__node-desc">
                  Rebasing RWA (SEP-41). Interest = index growth; balances grow via admin accrue().
                </p>
              </div>

              <div className="doc__arrow" aria-hidden="true">
                <span className="doc__arrow-label">deposit</span>
                <span className="doc__arrow-line" />
                <span className="doc__arrow-head">▼</span>
              </div>

              <div className="doc__node doc__node--ours">
                <div className="doc__node-top">
                  <span className="doc__node-name">wsFUND · ShareWrapper</span>
                  <span className="doc__node-tag doc__node-tag--ours">Ours · novel</span>
                </div>
                <p className="doc__node-desc">
                  Non-rebasing shares over rtFUND. Fixed share count; yield shows as a rising exchange
                  rate. A valid non-rebasing underlying for OZ.
                </p>
              </div>

              <div className="doc__arrow" aria-hidden="true">
                <span className="doc__arrow-label">deposit (valid underlying)</span>
                <span className="doc__arrow-line" />
                <span className="doc__arrow-head">▼</span>
              </div>

              <div className="doc__node doc__node--oz">
                <div className="doc__node-top">
                  <span className="doc__node-name">CompliantToken</span>
                  <span className="doc__node-tag doc__node-tag--oz">OpenZeppelin</span>
                </div>
                <p className="doc__node-desc">
                  Confidential shares. Encrypted balance = Pedersen commitment (Grumpkin); each op carries
                  an UltraHonk proof, gated by the allowlist policy, disclosable to the auditor.
                </p>
              </div>
            </div>
            <p className="doc__diagram-note">
              The encrypted amount is a share count, so it never has to change when interest accrues —
              which is exactly why a rebasing fund can become confidential.
            </p>
          </section>

          <hr className="doc__rule" />

          {/* 7 — CAVEATS ----------------------------------------------------- */}
          <section id="caveats" className="doc__section">
            <span className="doc__num">§7 · Honest caveats</span>
            <h2 className="doc__h2">What this is, and what it is not.</h2>
            <ul className="doc__caveats">
              <li>
                <strong>Confidential, not anonymous.</strong> The UltraHonk proofs are the non-ZK variant:
                valid but not witness-hiding. Balances are hidden commitments; operations are not
                anonymous.
              </li>
              <li>
                <strong>Testnet demo.</strong> Everything here runs on Stellar testnet with a scripted
                treasurer flow. It is a proof of the composition, not a production deployment.
              </li>
              <li>
                <strong>Demo auditor key.</strong> The auditor key in this deployment is a publicly-known
                value (auditor_id 0, K = H), chosen so the reveal genuinely decrypts the transfer
                ciphertext. Its disclosure is therefore publicly reproducible — a real deployment would
                use a privately-held auditor key.
              </li>
            </ul>
          </section>

          <hr className="doc__rule" />

          {/* 8 — CONTRACTS --------------------------------------------------- */}
          <section id="contracts" className="doc__section">
            <span className="doc__num">§8 · Deployed contracts</span>
            <h2 className="doc__h2">Live on Stellar testnet.</h2>
            <p>
              Every contract below is deployed and verified on testnet. The built WASM hashes match what
              is on-chain. Contract IDs link to Stellar Expert.
            </p>
            <div className="doc__table-wrap">
              <table className="doc__table">
                <thead>
                  <tr>
                    <th>Contract</th>
                    <th>Origin</th>
                    <th>Role</th>
                    <th>Address</th>
                  </tr>
                </thead>
                <tbody>
                  {CONTRACTS.map((c) => (
                    <tr key={c.name}>
                      <td className="doc__t-name">{c.name}</td>
                      <td>
                        <span className={`doc__t-origin doc__t-origin--${c.origin}`}>
                          {c.origin === "ours" ? "Ours" : "OpenZeppelin"}
                        </span>
                      </td>
                      <td>{c.role}</td>
                      <td className="doc__t-id">
                        <a href={`${EXPLORER}${c.id}`} target="_blank" rel="noreferrer" title={c.id}>
                          {c.id.slice(0, 6)}…{c.id.slice(-6)} ↗
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="doc__closing">
              <p className="doc__cta">
                <Link className="sg-btn sg-btn--primary" href="/app">
                  Open the live demo
                </Link>
                <a className="doc__ext" href={GITHUB} target="_blank" rel="noreferrer">
                  Source on GitHub ↗
                </a>
              </p>
              <p className="doc__meta">
                HackMeridian 2026 · Genesis · Stellar Composed. Built on OpenZeppelin Confidential
                Contracts v0.8.0 (MIT). The rebasing RWA (rtFUND) and the non-rebasing ShareWrapper
                (wsFUND) are our contribution; the confidential suite is composed from OpenZeppelin as-is.
              </p>
            </div>
          </section>
        </article>

        <aside className="doc__toc" aria-label="Table of contents">
          <div className="doc__toc-title">Contents</div>
          {TOC.map(([id, label]) => (
            <a key={id} href={`#${id}`}>
              {label}
            </a>
          ))}
        </aside>
      </div>
    </main>
  );
}
