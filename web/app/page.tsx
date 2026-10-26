"use client";
import { useCallback, useEffect, useState } from "react";
import { useFreighter } from "@/components/useFreighter";

const RATE_ONE = 10_000_000;

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

  const refresh = useCallback(async () => {
    try {
      const [c, s] = await Promise.all([
        cfg ?? fetch("/api/config").then((r) => r.json()),
        fetch("/api/state").then((r) => r.json()),
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
        const r = await fetch(url, {
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
      const built = await fetch("/api/tx/build-deposit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ address: wallet.address, amount: "300000000" }),
      }).then((r) => r.json());
      if (built.error) {
        setResults((p) => ({ ...p, "wallet-deposit": { ok: false, label: "Could not build transaction", log: built.error } }));
        return;
      }
      const signed = await sign(built.xdr, cfg.passphrase);
      const sub = await fetch("/api/tx/submit", {
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

  const conf = st?.confidential;
  const hiddenCommitted = !!conf && !conf.is_identity;
  const loading = !st && !loadError;

  // step completion flags (drive the "done" tags for legibility)
  const depositDone = !!(results["deposit"]?.ok || results["wallet-deposit"]?.ok);
  const accrueDone = !!results["accrue"]?.ok;
  const rejectDone = !!results["reject"]?.ok;
  const sealDone = hiddenCommitted || !!results["conf"]?.ok;
  const auditDone = !!auditData?.ok;
  const redeemDone = !!results["redeem"]?.ok;

  return (
    <div className="wrap">
      <header className="top">
        <div className="brand">
          <span className="eyebrow">Confidential Treasury · Stellar</span>
          <h1>Private yield on a tokenized fund</h1>
          <p>
            Move idle treasury into a tokenized fund that keeps earning interest — while the amount you hold
            stays private on the public ledger.
          </p>
        </div>
        <div className="wallet">
          {cfg && (
            <span className="net-pill" title="Live contracts on this network">
              <span className="dot" />
              {cfg.network}
            </span>
          )}
          {wallet.address ? (
            <span className="pill good mono-pill" title={wallet.address}>Wallet {short(wallet.address, 6)}</span>
          ) : (
            <button className="primary" onClick={connect} disabled={wallet.connecting}>
              {wallet.connecting ? <span className="spinner" /> : "Connect wallet"}
            </button>
          )}
          <button
            className="ghost"
            aria-pressed={auditorView}
            title="Permissioned regulator disclosure"
            onClick={() => setAuditorView((v) => !v)}
          >
            {auditorView ? "Auditor view: on" : "Auditor view"}
          </button>
        </div>
      </header>

      {wallet.error && (
        <div className="banner-err" role="alert">
          {wallet.error} Install Freighter from freighter.app, or use the demo-treasurer buttons below — no wallet needed.
        </div>
      )}
      {loadError && (
        <div className="banner-err" role="alert">
          Could not reach the chain state service: {loadError.slice(0, 160)}. Retrying every few seconds…
        </div>
      )}

      {/* 10-SECOND VALUE STORY */}
      <div className="callout">
        <span className="ico" aria-hidden>🏦</span>
        <div className="body">
          <strong>The idea in one line.</strong> Your holding on the ledger is a sealed figure nobody can read —
          yet it keeps gaining value as the fund&apos;s published price rises. A permissioned auditor can still
          reveal your true balance on demand. Hidden amount, visible growth, full oversight.
        </div>
      </div>

      {/* HERO: hidden balance + growing public value */}
      <div className="hero" style={{ marginTop: 16 }}>
        <div className="stat hidden-accent">
          <div className="k">Your holding</div>
          {loading ? (
            <div className="skeleton" style={{ height: 40, marginTop: 10, width: "70%" }} />
          ) : auditorView && auditData?.plaintext_human ? (
            <>
              <div className="v" style={{ color: "var(--warn)" }}>{auditData.plaintext_human as string} units</div>
              <div className="note">Revealed with the auditor key — matches the sealed on-chain commitment exactly.</div>
            </>
          ) : hiddenCommitted ? (
            <>
              <div className="v"><span className="hidden-badge">🔒 Hidden</span></div>
              <div className="commitment mono">on-chain commitment {short(conf!.receiving_commitment, 16)}</div>
              <div className="note">Stored as a sealed commitment. Nobody reading the public ledger can see the amount.</div>
            </>
          ) : (
            <>
              <div className="v" style={{ color: "var(--muted)", fontSize: 24 }}>Not sealed yet</div>
              <div className="note">Visible balance: {units(st?.alice.wsFUND)} units. Run step 4 below to make it private.</div>
            </>
          )}
        </div>

        <div className="stat value-accent">
          <div className="k">Published price per unit</div>
          {loading ? (
            <div className="skeleton" style={{ height: 40, marginTop: 10, width: "50%" }} />
          ) : (
            <>
              <div className="v" style={{ color: "var(--good)" }}>{st?.exchange_rate_human ?? "—"}</div>
              {accrueDone && <span className="trend" aria-hidden>▲ growing with interest</span>}
              <div className="note">
                The fund&apos;s public NAV. It rises as interest accrues, so your hidden holding is worth more over
                time — without the amount ever being revealed.
              </div>
            </>
          )}
        </div>
      </div>

      {/* PRIMARY: one-click deposit */}
      <div className="card">
        <div className="card-head">
          <span className="step-num">1</span>
          <h2>Deposit treasury into the vault</h2>
          {depositDone && <span className="done-tag">✓ done</span>}
        </div>
        <p className="sub">Move your treasury into the yield wrapper. Sign it in your own wallet, or run the demo account.</p>
        <div className="row">
          <button className="primary" onClick={walletDeposit} disabled={!wallet.address || busy === "wallet-deposit"}>
            {busy === "wallet-deposit" ? <span className="spinner" /> : "Deposit with my wallet (300 units)"}
          </button>
          <button onClick={() => step("deposit", "/api/step/deposit")} disabled={!!busy}>
            {busy === "deposit" ? <span className="spinner" /> : "Deposit as demo treasurer"}
          </button>
        </div>
        <Res r={results["wallet-deposit"]} explorer={cfg?.explorer} id={cfg?.contracts.wsFUND} />
        <Res r={results["deposit"]} explorer={cfg?.explorer} id={cfg?.contracts.wsFUND} />
        <div className="footnote">
          The wallet path builds a real <span className="mono">wsFUND.deposit</span> transaction and signs it with
          Freighter. It needs the connected account to hold the fund token (rtFUND) on testnet; otherwise the network
          returns a clear error, shown verbatim — never a fake success. The demo-treasurer button signs with the
          enrolled account that already holds funds.
        </div>
      </div>

      {/* YIELD */}
      <div className="card">
        <div className="card-head">
          <span className="step-num">2</span>
          <h2>Watch the value grow (interest)</h2>
          {accrueDone && <span className="done-tag">✓ done</span>}
        </div>
        <p className="sub">The fund pays interest. The published price per unit rises; your hidden amount never changes.</p>
        <button onClick={() => step("accrue", "/api/step/accrue", { bps: 500 })} disabled={!!busy}>
          {busy === "accrue" ? <span className="spinner" /> : "Simulate 5% interest (issuer)"}
        </button>
        <Res r={results["accrue"]} explorer={cfg?.explorer} id={cfg?.contracts.rtFUND} />
      </div>

      {/* ELIGIBILITY REJECT */}
      <div className="card">
        <div className="card-head">
          <span className="step-num">3</span>
          <h2>Eligibility is enforced on-chain</h2>
          {rejectDone && <span className="done-tag">✓ blocked</span>}
        </div>
        <p className="sub">
          The fund can only be held by approved parties. Move it to an un-approved account and the network rejects
          the transfer — not this app, the chain itself.
        </p>
        <div className="footnote" style={{ marginTop: 0, marginBottom: 14 }}>
          Approved to hold: treasurer{" "}
          <span className={`pill ${st?.alice.allowlisted === "true" ? "good" : ""}`}>
            {st?.alice.allowlisted === "true" ? "yes" : "no"}
          </span>{" "}
          · other party{" "}
          <span className={`pill ${st?.bob.allowlisted === "true" ? "good" : ""}`}>
            {st?.bob.allowlisted === "true" ? "yes" : "no"}
          </span>
        </div>
        <button className="danger" onClick={() => step("reject", "/api/step/register-bob")} disabled={!!busy}>
          {busy === "reject" ? <span className="spinner" /> : "Attempt transfer to un-approved party"}
        </button>
        {results["reject"] && (
          <div className={`result ${results["reject"].ok ? "ok" : "fail"}`}>
            <div className="result-head">
              <span className="ico" aria-hidden>{results["reject"].ok ? "🛡" : "⚠"}</span>
              <span>{results["reject"].ok ? "Blocked on-chain, exactly as intended." : "Unexpected result — review the log."}</span>
            </div>
            <div>{results["reject"].label as string}</div>
            {!!results["reject"].error_line && (
              <div className="mono" style={{ marginTop: 6, fontSize: 12 }}>{results["reject"].error_line as string}</div>
            )}
          </div>
        )}
        <div className="footnote">
          The rejection is the OpenZeppelin allowlist policy firing on-chain (contract error #3602), not a UI check.
        </div>
      </div>

      {/* CONFIDENTIAL SEAL */}
      <div className="card">
        <div className="card-head">
          <span className="step-num">4</span>
          <h2>Seal the balance (make it private)</h2>
          {sealDone && <span className="done-tag">✓ sealed</span>}
        </div>
        <p className="sub">Move the holding into the confidential ledger. The amount becomes a sealed commitment — see the hero card above update to 🔒 Hidden.</p>
        <button onClick={() => step("conf", "/api/step/conf-deposit", { amount: 300000000 })} disabled={!!busy}>
          {busy === "conf" ? <span className="spinner" /> : "Seal balance confidentially"}
        </button>
        <Res r={results["conf"]} explorer={cfg?.explorer} id={cfg?.contracts.compliant_token} />
      </div>

      {/* AUDITOR */}
      <div className="card">
        <div className="card-head">
          <span className="step-num">5</span>
          <h2>Auditor view (regulator disclosure)</h2>
          {auditDone && <span className="done-tag">✓ revealed</span>}
        </div>
        <p className="sub">
          A permissioned auditor can reveal the true balance behind the seal. Reveal it here, then watch the hero
          card above switch from 🔒 Hidden to the real figure.
        </p>
        <button onClick={async () => { await step("audit", "/api/step/audit"); setAuditorView(true); }} disabled={!!busy}>
          {busy === "audit" ? <span className="spinner" /> : "Reveal true balance (auditor)"}
        </button>
        {auditData && (
          <div className={`result ${auditData.ok ? "ok" : "fail"}`}>
            <div className="result-head">
              <span className="ico" aria-hidden>{auditData.ok ? "🔎" : "⚠"}</span>
              <span>{auditData.ok ? "Revealed to the auditor." : "Could not reveal — review the log."}</span>
            </div>
            <div>{auditData.label as string}</div>
            {!!auditData.plaintext_human && (
              <div style={{ marginTop: 6 }}>
                True balance: <strong style={{ color: "var(--warn)" }}>{auditData.plaintext_human as string} units</strong>
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

      {/* WITHDRAW */}
      <div className="card">
        <div className="card-head">
          <span className="step-num">6</span>
          <h2>Withdraw with yield</h2>
          {redeemDone && <span className="done-tag">✓ done</span>}
        </div>
        <p className="sub">Take it all back out. Because the published price grew, you receive more than you put in.</p>
        <button onClick={() => step("redeem", "/api/step/redeem")} disabled={!!busy}>
          {busy === "redeem" ? <span className="spinner" /> : "Withdraw everything"}
        </button>
        <Res r={results["redeem"]} explorer={cfg?.explorer} id={cfg?.contracts.wsFUND} />
      </div>

      <div className="card">
        <div className="card-head">
          <h2>Under the hood</h2>
        </div>
        <p className="sub">
          Every button above calls a live contract on Stellar {cfg?.network ?? "testnet"}. No mocked data. The
          ShareWrapper is our contribution; the confidential suite is OpenZeppelin v0.8.0, composed as-is.
        </p>
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
              <a className="mono" style={{ fontSize: 12 }} href={`${cfg.explorer}${v}`} target="_blank" rel="noreferrer">
                {short(v, 6)} ↗
              </a>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function Res({ r, explorer, id }: { r?: StepResult; explorer?: string; id?: string }) {
  if (!r) return null;
  return (
    <div className={`result ${r.ok ? "ok" : "fail"}`}>
      <div className="result-head">
        <span className="ico" aria-hidden>{r.ok ? "✓" : "⚠"}</span>
        <span>{(r.label as string) || (r.ok ? "Done." : "Something went wrong.")}</span>
        {explorer && id && (
          <a className="mono" style={{ fontSize: 12, marginLeft: "auto" }} href={`${explorer}${id}`} target="_blank" rel="noreferrer">
            view contract ↗
          </a>
        )}
      </div>
      {!!r.log && <div className="log">{String(r.log).slice(0, 2000)}</div>}
    </div>
  );
}
