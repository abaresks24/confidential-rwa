"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useFreighter } from "@/components/useFreighter";
import { api } from "@/lib/api";

// =============================================================================
// SAGITTAIRE — the live treasurer demo, rebuilt as calm editorial sections.
//
// Every button calls the REAL backend (NEXT_PUBLIC_BACKEND_URL): /api/config +
// /api/state polling, the /api/step/* on-chain actions, and the Freighter-signed
// /api/tx/* deposit path. None of that wiring is touched here — only the layout
// and copy. The page is organised as plainly-titled sections, each with a short
// explanation and the live on-chain result.
//
// Scroll choreography (section reveal + paper parallax) is driven in JS via a
// rAF-throttled scroll/IntersectionObserver so it works in Safari — NOT CSS
// scroll-timeline. prefers-reduced-motion skips it and shows content directly.
// =============================================================================

const RATE_ONE = 10_000_000;
const GITHUB = "https://github.com/abaresks24/confidential-rwa";

type Cfg = {
  network: string;
  passphrase: string;
  contracts: Record<string, string>;
  accounts: Record<string, string>;
  auditor_id: string;
  ours: string[];
  oz_as_is: string[];
  note: string;
  explorer: string;
};

type State = {
  exchange_rate: string;
  exchange_rate_human: string;
  total_underlying: string;
  alice: { wsFUND: string; rtFUND: string; allowlisted: string };
  bob: { wsFUND: string; rtFUND: string; allowlisted: string };
  confidential: {
    registered: boolean;
    receiving_commitment: string;
    spendable_commitment: string;
    spending_public_key: string;
    is_identity: boolean;
    cumulative_total: string;
  };
  auditor_key: string;
};

type StepResult = Record<string, unknown> & { ok?: boolean; label?: string; log?: string };

function short(s: string, n = 10) {
  if (!s) return "—";
  return s.length <= n * 2 ? s : `${s.slice(0, n)}…${s.slice(-6)}`;
}
function units(raw: string | undefined) {
  if (!raw) return "0.00";
  return (Number(raw) / RATE_ONE).toFixed(2);
}

export default function Page() {
  const { wallet, connect, sign } = useFreighter();
  const [cfg, setCfg] = useState<Cfg | null>(null);
  const [st, setSt] = useState<State | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [auditorView, setAuditorView] = useState(false);
  const [results, setResults] = useState<Record<string, StepResult>>({});
  const [auditData, setAuditData] = useState<StepResult | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  // ---- live backend wiring (unchanged) ------------------------------------
  const refresh = useCallback(async () => {
    try {
      const [c, s] = await Promise.all([
        cfg ?? fetch(api("/api/config")).then((r) => r.json()),
        fetch(api("/api/state")).then((r) => r.json()),
      ]);
      if (!cfg) setCfg(c);
      if (s?.error) {
        setLoadError(String(s.error));
      } else {
        setSt(s);
        setLoadError(null);
      }
    } catch (e) {
      setLoadError(String((e as Error)?.message || e));
    }
  }, [cfg]);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 8000);
    return () => clearInterval(t);
  }, [refresh]);

  const step = useCallback(
    async (key: string, url: string, body?: unknown) => {
      setBusy(key);
      try {
        const r = await fetch(api(url), {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body ?? {}),
        }).then((x) => x.json());
        setResults((p) => ({ ...p, [key]: r }));
        if (key === "audit") setAuditData(r);
        await refresh();
        return r;
      } catch (e) {
        const r = { ok: false, label: "Request failed", log: String((e as Error)?.message || e) };
        setResults((p) => ({ ...p, [key]: r }));
        return r;
      } finally {
        setBusy(null);
      }
    },
    [refresh]
  );

  // Freighter-signed deposit: build XDR server-side, sign in wallet, submit.
  const walletDeposit = useCallback(async () => {
    if (!wallet.address || !cfg) return;
    setBusy("wallet-deposit");
    try {
      const built = await fetch(api("/api/tx/build-deposit"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ address: wallet.address, amount: "300000000" }),
      }).then((r) => r.json());
      if (built.error) {
        setResults((p) => ({ ...p, "wallet-deposit": { ok: false, label: "Could not build transaction", log: built.error } }));
        return;
      }
      const signed = await sign(built.xdr, cfg.passphrase);
      const sub = await fetch(api("/api/tx/submit"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ signedXdr: signed }),
      }).then((r) => r.json());
      setResults((p) => ({
        ...p,
        "wallet-deposit": {
          ok: !!sub.ok,
          label: sub.ok
            ? "Deposit signed in your wallet and confirmed on-chain"
            : `Deposit submitted — network status: ${sub.status}`,
          log: `tx hash: ${sub.hash ?? "—"}\nstatus: ${sub.status}\n${sub.error ?? ""}`,
        },
      }));
      await refresh();
    } catch (e) {
      setResults((p) => ({ ...p, "wallet-deposit": { ok: false, label: "Wallet signing cancelled or failed", log: String((e as Error)?.message || e) } }));
    } finally {
      setBusy(null);
    }
  }, [wallet.address, cfg, sign, refresh]);

  // ---- derived state -------------------------------------------------------
  const conf = st?.confidential;
  const hiddenCommitted = !!conf && !conf.is_identity;
  const loading = !st && !loadError;

  const depositDone = !!(results["deposit"]?.ok || results["wallet-deposit"]?.ok);
  const accrueDone = !!results["accrue"]?.ok;
  const rejectDone = !!results["reject"]?.ok;
  const sealDone = hiddenCommitted || !!results["conf"]?.ok;
  const auditDone = !!auditData?.ok;
  const redeemDone = !!results["redeem"]?.ok;

  // ---- scroll choreography (Safari-safe, reduced-motion aware) -------------
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const secs = Array.from(root.querySelectorAll<HTMLElement>(".app__sec"));
    if (reduce) {
      secs.forEach((s) => s.classList.add("is-in"));
      return;
    }

    // Reveal each section as it enters the viewport.
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            e.target.classList.add("is-in");
            io.unobserve(e.target);
          }
        }
      },
      { rootMargin: "0px 0px -12% 0px", threshold: 0.12 }
    );
    secs.forEach((s) => io.observe(s));

    // Gentle paper parallax as the document scrolls.
    let raf = 0;
    const update = () => {
      raf = 0;
      root.style.setProperty("--bgY", `${(window.scrollY * 0.18).toFixed(1)}px`);
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      io.disconnect();
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <div className="app" ref={rootRef}>
      <div className="app__paper" aria-hidden="true" />
      <div className="app__wash" aria-hidden="true" />

      {/* Top bar — black centaur home link + network + connect/wallet. */}
      <nav className="app__bar">
        <Link className="app__home" href="/" aria-label="Sagittaire — home">
          <img className="app__bar-mark" src="/brand/centaur-cream.svg" alt="" width={28} height={33} />
          <span className="app__bar-word">Sagittaire</span>
        </Link>
        <div className="app__bar-actions">
          {wallet.address ? (
            <span className="app__wallet" title={wallet.address}>
              {short(wallet.address, 6)}
            </span>
          ) : (
            <button className="primary" onClick={connect} disabled={wallet.connecting}>
              {wallet.connecting ? <span className="spinner" /> : "Connect wallet"}
            </button>
          )}
        </div>
      </nav>

      <div className="app__doc">
        {/* MASTHEAD */}
        <header className="app__masthead">
          <span className="app__eyebrow">Confidential Treasury · Stellar</span>
          <h1 className="app__title">A treasury that keeps earning, with the amount sealed.</h1>
          <p className="app__lede">
            Idle cash goes into a tokenized money-market fund. It earns interest like any fund, but the size of the
            position is a sealed figure on the public ledger — unreadable to the world, yet provable to a permissioned
            auditor. Every step below calls a live contract on Stellar {cfg?.network ?? "testnet"}; nothing is mocked.
          </p>

          {wallet.error && (
            <div className="app__banner" role="alert">
              {wallet.error} Install Freighter from freighter.app, or use the demo-treasurer actions below — no wallet
              needed.
            </div>
          )}
          {loadError && (
            <div className="app__banner" role="alert">
              Could not reach the chain-state service: {loadError.slice(0, 160)}. Retrying every few seconds…
            </div>
          )}
        </header>

        {/* 1 — AT A GLANCE */}
        <section className="app__sec">
          <div className="app__sechead">
            <span className="app__secnum">1</span>
            <div className="app__secmeta">
              <span className="app__kicker">At a glance</span>
              <h2 className="app__h2">Your holding is sealed; its value keeps growing.</h2>
            </div>
          </div>
          <p className="app__p">
            Two figures tell the whole story. On the left, your holding — a sealed commitment nobody reading the ledger
            can decode. On the right, the fund&apos;s published price per unit, which rises as interest accrues. The
            amount stays hidden while it quietly gains value.
          </p>

          <div className="app__glance">
            {/* Sealed holding */}
            <div className="app__panel app__panel--sealed">
              <div className="app__panel-k">Your holding</div>
              {loading ? (
                <div className="skeleton" style={{ height: 44, marginTop: 10, width: "70%" }} />
              ) : auditorView && auditData?.plaintext_human ? (
                <>
                  <div className="app__panel-v" style={{ color: "var(--warn)" }}>
                    {auditData.plaintext_human as string} units
                  </div>
                  <div className="app__panel-note">
                    Revealed with the auditor key — matches the sealed on-chain commitment exactly.
                  </div>
                </>
              ) : hiddenCommitted ? (
                <>
                  <div className="app__sealed-badge">
                    <span className="app__seal-dot" aria-hidden /> Sealed
                  </div>
                  <div className="app__commit">on-chain commitment {short(conf!.receiving_commitment, 16)}</div>
                  <div className="app__panel-note">
                    Stored as a Pedersen commitment. Nobody reading the public ledger can see the amount.
                  </div>
                </>
              ) : (
                <>
                  <div className="app__panel-v provisional">Not sealed yet</div>
                  <div className="app__panel-note">
                    Visible balance: {units(st?.alice.wsFUND)} units. Seal it in section 4 to make it private.
                  </div>
                </>
              )}
            </div>

            {/* Public price */}
            <div className="app__panel app__panel--value">
              <div className="app__panel-k">Published price per unit</div>
              {loading ? (
                <div className="skeleton" style={{ height: 44, marginTop: 10, width: "50%" }} />
              ) : (
                <>
                  <div className="app__panel-v" style={{ color: "var(--gold)" }}>
                    {st?.exchange_rate_human ?? "—"}
                  </div>
                  {accrueDone && <span className="app__trend" aria-hidden>↑ growing with interest</span>}
                  <div className="app__panel-note">
                    The fund&apos;s public NAV. It rises as interest accrues, so your hidden holding is worth more over
                    time — without the amount ever being revealed.
                  </div>
                </>
              )}
            </div>
          </div>
        </section>

        {/* 2 — DEPOSIT */}
        <section className="app__sec">
          <div className="app__sechead">
            <span className="app__secnum">2</span>
            <div className="app__secmeta">
              <span className="app__kicker">Deposit</span>
              <h2 className="app__h2">Move treasury into the yield wrapper.</h2>
            </div>
            {depositDone && <span className="app__done">Done</span>}
          </div>
          <p className="app__p">
            Deposit into the confidential yield wrapper. Sign it in your own Freighter wallet, or run the enrolled demo
            account that already holds funds.
          </p>
          <div className="app__stage">
            <div className="app__actions">
              <button className="primary" onClick={walletDeposit} disabled={!wallet.address || busy === "wallet-deposit"}>
                {busy === "wallet-deposit" ? <span className="spinner" /> : "Deposit with my wallet (300 units)"}
              </button>
              <button onClick={() => step("deposit", "/api/step/deposit")} disabled={!!busy}>
                {busy === "deposit" ? <span className="spinner" /> : "Deposit as demo treasurer"}
              </button>
            </div>
            <Res r={results["wallet-deposit"]} explorer={cfg?.explorer} id={cfg?.contracts.wsFUND} />
            <Res r={results["deposit"]} explorer={cfg?.explorer} id={cfg?.contracts.wsFUND} />
            <div className="app__fine">
              The wallet path builds a real <span className="mono">wsFUND.deposit</span> transaction and signs it with
              Freighter. It needs the connected account to hold the fund token (rtFUND) on testnet; otherwise the
              network returns a clear error, shown verbatim — never a fake success.
            </div>
          </div>
        </section>

        {/* 3 — YIELD */}
        <section className="app__sec">
          <div className="app__sechead">
            <span className="app__secnum">3</span>
            <div className="app__secmeta">
              <span className="app__kicker">Yield</span>
              <h2 className="app__h2">Interest accrues; the amount never changes.</h2>
            </div>
            {accrueDone && <span className="app__done">Done</span>}
          </div>
          <p className="app__p">
            The fund pays interest. The published price per unit rises — watch the right-hand figure in section 1 move —
            while your hidden holding stays exactly as it was.
          </p>
          <div className="app__stage">
            <div className="app__actions">
              <button onClick={() => step("accrue", "/api/step/accrue", { bps: 500 })} disabled={!!busy}>
                {busy === "accrue" ? <span className="spinner" /> : "Simulate 5% interest (issuer)"}
              </button>
            </div>
            <Res r={results["accrue"]} explorer={cfg?.explorer} id={cfg?.contracts.rtFUND} />
          </div>
        </section>

        {/* 4 — SEAL (confidential) */}
        <section className="app__sec">
          <div className="app__sechead">
            <span className="app__secnum">4</span>
            <div className="app__secmeta">
              <span className="app__kicker">Confidential</span>
              <h2 className="app__h2">Seal the balance into the confidential ledger.</h2>
            </div>
            {sealDone && <span className="app__done">Sealed</span>}
          </div>
          <p className="app__p">
            Move the holding into the confidential ledger. The amount becomes a sealed commitment — the holding panel in
            section 1 switches from a visible balance to <strong>Sealed</strong>.
          </p>
          <div className="app__stage">
            <div className="app__actions">
              <button onClick={() => step("conf", "/api/step/conf-deposit", { amount: 300000000 })} disabled={!!busy}>
                {busy === "conf" ? <span className="spinner" /> : "Seal balance confidentially"}
              </button>
            </div>
            <Res r={results["conf"]} explorer={cfg?.explorer} id={cfg?.contracts.compliant_token} />
          </div>
        </section>

        {/* 5 — ELIGIBILITY / TRANSFER */}
        <section className="app__sec">
          <div className="app__sechead">
            <span className="app__secnum">5</span>
            <div className="app__secmeta">
              <span className="app__kicker">Eligibility</span>
              <h2 className="app__h2">Only approved parties may hold the fund.</h2>
            </div>
            {rejectDone && <span className="app__done">Blocked</span>}
          </div>
          <p className="app__p">
            A confidential transfer still respects the rules. Move the fund to an un-approved account and the network
            rejects it — not this app, the chain itself, via the OpenZeppelin allowlist policy.
          </p>
          <div className="app__stage">
            <div className="app__elig">
              Approved to hold: treasurer{" "}
              <span className={`pill ${st?.alice.allowlisted === "true" ? "good" : ""}`}>
                {st?.alice.allowlisted === "true" ? "yes" : "no"}
              </span>
              <span aria-hidden>·</span> other party{" "}
              <span className={`pill ${st?.bob.allowlisted === "true" ? "good" : ""}`}>
                {st?.bob.allowlisted === "true" ? "yes" : "no"}
              </span>
            </div>
            <div className="app__actions">
              <button className="danger" onClick={() => step("reject", "/api/step/register-bob")} disabled={!!busy}>
                {busy === "reject" ? <span className="spinner" /> : "Attempt transfer to un-approved party"}
              </button>
            </div>
            {results["reject"] && (
              <div className={`result ${results["reject"].ok ? "ok" : "fail"}`}>
                <div className="result-head">
                  <span className="ico" aria-hidden>{results["reject"].ok ? "✓" : "!"}</span>
                  <span>
                    {results["reject"].ok
                      ? "Blocked on-chain, exactly as intended."
                      : "Unexpected result — review the log."}
                  </span>
                </div>
                <div>{results["reject"].label as string}</div>
                {!!results["reject"].error_line && (
                  <div className="mono" style={{ marginTop: 6, fontSize: 12 }}>
                    {results["reject"].error_line as string}
                  </div>
                )}
              </div>
            )}
            <div className="app__fine">
              The rejection is the OpenZeppelin allowlist policy firing on-chain (contract error #3602), not a UI check.
            </div>
          </div>
        </section>

        {/* 6 — AUDITOR */}
        <section className="app__sec">
          <div className="app__sechead">
            <span className="app__secnum">6</span>
            <div className="app__secmeta">
              <span className="app__kicker">Selective disclosure</span>
              <h2 className="app__h2">A permissioned auditor can reveal the true balance.</h2>
            </div>
            {auditDone && <span className="app__done">Revealed</span>}
          </div>
          <p className="app__p">
            Private to the world, provable to the regulator. Reveal the figure behind the seal here, then watch the
            holding panel in section 1 switch from <strong>Sealed</strong> to the real amount.
          </p>
          <div className="app__stage">
            <div className="app__actions">
              <button
                onClick={async () => {
                  await step("audit", "/api/step/audit");
                  setAuditorView(true);
                }}
                disabled={!!busy}
              >
                {busy === "audit" ? <span className="spinner" /> : "Reveal true balance (auditor)"}
              </button>
              {auditDone && (
                <button className="ghost" aria-pressed={auditorView} onClick={() => setAuditorView((v) => !v)}>
                  {auditorView ? "Hide from glance" : "Show in glance"}
                </button>
              )}
            </div>
            {auditData && (
              <div className={`result ${auditData.ok ? "ok" : "fail"}`}>
                <div className="result-head">
                  <span className="ico" aria-hidden>{auditData.ok ? "✓" : "!"}</span>
                  <span>{auditData.ok ? "Revealed to the auditor." : "Could not reveal — review the log."}</span>
                </div>
                <div>{auditData.label as string}</div>
                {!!auditData.plaintext_human && (
                  <div style={{ marginTop: 6 }}>
                    True balance:{" "}
                    <strong style={{ color: "var(--warn)" }}>{auditData.plaintext_human as string} units</strong>
                  </div>
                )}
                {!!auditData.onchain_commitment && (
                  <div className="commitment mono">
                    recomputed {short((auditData.recomputed_commitment as string) || "", 14)} == on-chain{" "}
                    {short((auditData.onchain_commitment as string) || "", 14)}
                  </div>
                )}
              </div>
            )}
            <div className="disclosure">
              <strong>Honesty note.</strong> The demo auditor key is the generator point (publicly known), and the
              confidential deposit uses zero blinding, so this &quot;reveal&quot; is an exact point recomputation — not a
              private ECDH channel. The sealed commitment, the on-chain rejection, and the UltraHonk enrolment proof are
              all real on testnet. The proof is not zero-knowledge. See the repo README.
            </div>
          </div>
        </section>

        {/* 7 — WITHDRAW */}
        <section className="app__sec">
          <div className="app__sechead">
            <span className="app__secnum">7</span>
            <div className="app__secmeta">
              <span className="app__kicker">Redeem</span>
              <h2 className="app__h2">Withdraw, with the yield.</h2>
            </div>
            {redeemDone && <span className="app__done">Done</span>}
          </div>
          <p className="app__p">
            Take it all back out. Because the published price grew, you receive more than you put in.
          </p>
          <div className="app__stage">
            <div className="app__actions">
              <button onClick={() => step("redeem", "/api/step/redeem")} disabled={!!busy}>
                {busy === "redeem" ? <span className="spinner" /> : "Withdraw everything"}
              </button>
            </div>
            <Res r={results["redeem"]} explorer={cfg?.explorer} id={cfg?.contracts.wsFUND} />
          </div>
        </section>

        {/* 8 — UNDER THE HOOD */}
        <section className="app__sec">
          <div className="app__sechead">
            <span className="app__secnum">8</span>
            <div className="app__secmeta">
              <span className="app__kicker">Under the hood</span>
              <h2 className="app__h2">Live contracts, composed on Stellar.</h2>
            </div>
          </div>
          <p className="app__p">
            No mocked data. The ShareWrapper is our contribution; the confidential suite is OpenZeppelin v0.8.0,
            composed as-is.
          </p>
          <div className="app__stage app__contracts">
            {!cfg ? (
              <>
                <div className="skeleton" style={{ height: 18, marginBottom: 10 }} />
                <div className="skeleton" style={{ height: 18, marginBottom: 10 }} />
                <div className="skeleton" style={{ height: 18 }} />
              </>
            ) : (
              Object.entries(cfg.contracts).map(([k, v]) => (
                <div key={k} className="contract-row">
                  <span className="mono" style={{ fontSize: 13 }}>
                    {k}{" "}
                    {cfg.ours.includes(k) ? (
                      <span className="pill good">ours</span>
                    ) : (
                      <span className="pill">OZ as-is</span>
                    )}
                  </span>
                  <a
                    className="mono"
                    style={{ fontSize: 12 }}
                    href={`${cfg.explorer}${v}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {short(v, 6)} ↗
                  </a>
                </div>
              ))
            )}
          </div>
        </section>
      </div>

      <footer className="app__footer">
        <span className="app__footer-sig">
          <img src="/brand/mark-ink-48.png" alt="" aria-hidden width={24} height={24} />
          <span>Sagittaire</span>
        </span>
        <a href={GITHUB} target="_blank" rel="noreferrer">GitHub ↗</a>
        <span aria-hidden>·</span>
        <span>HackMeridian 2026 · Stellar Composed</span>
        <span aria-hidden>·</span>
        <span>MIT · OpenZeppelin Confidential Contracts v0.8.0</span>
        <span className="app__footer-caveat">
          Confidential, not anonymous — balances are hidden Pedersen commitments; OpenZeppelin&apos;s UltraHonk proofs
          are non-ZK today. Testnet demo.
        </span>
      </footer>
    </div>
  );
}

function Res({ r, explorer, id }: { r?: StepResult; explorer?: string; id?: string }) {
  if (!r) return null;
  return (
    <div className={`result ${r.ok ? "ok" : "fail"}`}>
      <div className="result-head">
        <span className="ico" aria-hidden>{r.ok ? "✓" : "!"}</span>
        <span>{(r.label as string) || (r.ok ? "Done." : "Something went wrong.")}</span>
        {explorer && id && (
          <a
            className="mono"
            style={{ fontSize: 12, marginLeft: "auto" }}
            href={`${explorer}${id}`}
            target="_blank"
            rel="noreferrer"
          >
            view contract ↗
          </a>
        )}
      </div>
      {!!r.log && <div className="log">{String(r.log).slice(0, 2000)}</div>}
    </div>
  );
}
