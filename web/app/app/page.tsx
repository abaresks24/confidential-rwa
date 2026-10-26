"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useFreighter } from "@/components/useFreighter";
import { api } from "@/lib/api";

// =============================================================================
// SAGITTAIRE — the product. No prose, no explanations. A top tab bandeau swaps
// focused holder screens: Portfolio, Wrap, Unwrap, Send. Every screen is wired
// to the LIVE backend (confidential-rwa-api on Fly) against Stellar testnet:
//   Portfolio -> GET  /api/portfolio?address=G...   (real balances + history)
//   Wrap      -> POST /api/wrap   {address, amount}  (deposit + confidential seal)
//   Unwrap    -> POST /api/unwrap {amount}           (redeem to rtFUND, with NAV)
//   Send      -> POST /api/send   {to, token, amount, from}
//
// The Auditor is NOT a holder tab. It is a privileged key-holder role reached by
// a quiet link in the top bar. It takes an auditor key and POSTs it to
// /api/auditor/reveal to decrypt EVERY confidential holder. No wallet needed.
// =============================================================================

const RATE_ONE = 10_000_000;

type Cfg = {
  network: string;
  passphrase: string;
  contracts: Record<string, string>;
  accounts: Record<string, string>;
  auditor_id: string;
  explorer: string;
};

// ---- live response shapes (from lib/chain.ts) ------------------------------
type Tx = { hash: string; successful: boolean; created_at: string; operation_count: number; link: string };
type Token = { symbol: string; name: string; raw: string; human: string; underlying_human?: string; contract: string };
type CToken = {
  symbol: string;
  name: string;
  contract: string;
  registered: boolean;
  allowlisted: boolean;
  receiving_commitment: string;
  spendable_commitment: string;
  sealed: boolean;
  decrypted_raw: string | null;
  decrypted_human: string | null;
};
type Portfolio = {
  address: string;
  label: string | null;
  role: string;
  enrolled: boolean;
  registered: boolean;
  allowlisted: boolean;
  exchange_rate_human: string;
  tokens: Token[];
  ctokens: CToken[];
  history: Tx[];
  error?: string;
};

type TxStep = { step: string; hash: string; link: string; ok: boolean };

type TabKey = "portfolio" | "wrap" | "unwrap" | "send";
const TABS: { key: TabKey; label: string }[] = [
  { key: "portfolio", label: "Portfolio" },
  { key: "wrap", label: "Wrap" },
  { key: "unwrap", label: "Unwrap" },
  { key: "send", label: "Send" },
];

type AuditorHolder = {
  label?: string;
  address?: string;
  balance_human?: string;
  commitment?: string;
  verified?: boolean;
  note?: string;
};
type AuditorReveal = { ok?: boolean; label?: string; holders?: AuditorHolder[] };

function short(s: string | undefined, n = 10) {
  if (!s) return "";
  return s.length <= n * 2 ? s : `${s.slice(0, n)}…${s.slice(-6)}`;
}
function when(iso: string) {
  try {
    return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch {
    return iso;
  }
}

// ---- a demo identity the viewer can inspect --------------------------------
// Freighter carries a Stellar ed25519 key for signing. The confidential view
// keys (Grumpkin) live with the enrolled demo accounts, so the sealed c-token
// balance is legible only for Alice and Carol. The viewer picks whose live
// position to inspect; a connected wallet shows its own public balances.
type Who = { key: string; label: string; address: string; sub: string };

export default function Page() {
  const { wallet, connect, disconnect, sign } = useFreighter();
  const [cfg, setCfg] = useState<Cfg | null>(null);
  const [tab, setTab] = useState<TabKey>("portfolio");
  const [view, setView] = useState<"product" | "auditor">("product");

  useEffect(() => {
    fetch(api("/api/config")).then((r) => r.json()).then(setCfg).catch(() => {});
  }, []);

  // The set of inspectable identities: the connected wallet (if any) plus the
  // enrolled demo accounts whose confidential position is fully legible.
  const whoList = useMemo<Who[]>(() => {
    const list: Who[] = [];
    if (wallet.address) list.push({ key: "wallet", label: "Your wallet", address: wallet.address, sub: "connected" });
    return list;
  }, [wallet.address]);

  const [whoKey, setWhoKey] = useState<string>("wallet");
  // Default to the connected wallet the moment it appears.
  useEffect(() => {
    if (wallet.address) setWhoKey("wallet");
  }, [wallet.address]);
  const active = whoList.find((w) => w.key === whoKey) || whoList[0] || null;

  // ---- entrance motion (JS-driven, Safari-safe, reduced-motion aware) ------
  const panelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = panelRef.current;
    if (!el) return;
    const reduce = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) { el.style.opacity = "1"; el.style.transform = "none"; return; }
    el.style.opacity = "0";
    el.style.transform = "translateY(14px)";
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        el.style.transition = "opacity 420ms cubic-bezier(0.22,0.61,0.36,1), transform 420ms cubic-bezier(0.22,0.61,0.36,1)";
        el.style.opacity = "1";
        el.style.transform = "none";
      });
    });
    return () => { cancelAnimationFrame(raf1); cancelAnimationFrame(raf2); };
  }, [tab, view]);

  const explorerC = cfg?.explorer || "https://stellar.expert/explorer/testnet/contract/";

  return (
    <div className="pr">
      <nav className="pr__bar">
        <Link className="pr__home" href="/" aria-label="Sagittaire home" onClick={() => setView("product")}>
          <img className="pr__mark" src="/brand/centaur-ink.svg" alt="" width={28} height={33} />
          <span className="pr__word">Sagittaire</span>
        </Link>

        {view === "product" ? (
          <div className="pr__tabs" role="tablist" aria-label="Holder sections">
            {TABS.map((t) => (
              <button key={t.key} role="tab" aria-selected={tab === t.key}
                className={`pr__tab ${tab === t.key ? "is-active" : ""}`} onClick={() => setTab(t.key)}>
                {t.label}
              </button>
            ))}
          </div>
        ) : (
          <div className="pr__tabs" aria-hidden />
        )}

        <div className="pr__bar-actions">
          <button className={`pr__auditor-link ${view === "auditor" ? "is-active" : ""}`}
            onClick={() => setView((v) => (v === "auditor" ? "product" : "auditor"))} aria-pressed={view === "auditor"}>
            Auditor
          </button>
          {wallet.address ? (
            <button className="pr__wallet pr__wallet--btn" title="Click to disconnect" onClick={disconnect}>
              <span className="pr__wallet-dot" aria-hidden />
              {short(wallet.address, 6)}
              <span className="pr__wallet-x" aria-hidden>✕</span>
            </button>
          ) : (
            <button className="primary" onClick={connect} disabled={wallet.connecting}>
              {wallet.connecting ? <span className="spinner" /> : "Connect wallet"}
            </button>
          )}
        </div>
      </nav>

      {view === "product" && (
        <div className="pr__tabs pr__tabs--mobile" role="tablist" aria-label="Holder sections">
          {TABS.map((t) => (
            <button key={t.key} role="tab" aria-selected={tab === t.key}
              className={`pr__tab ${tab === t.key ? "is-active" : ""}`} onClick={() => setTab(t.key)}>
              {t.label}
            </button>
          ))}
        </div>
      )}

      <main className="pr__main">
        {wallet.error && (
          <div className="pr__alerts">
            <div className="pr__banner" role="alert">{wallet.error} Install Freighter from freighter.app.</div>
          </div>
        )}

        <div className="pr__panel" ref={panelRef} key={view === "auditor" ? "auditor" : tab}>
          {view === "auditor" ? (
            <AuditorView />
          ) : (
            <>
              {tab === "portfolio" && (
                <PortfolioScreen whoList={whoList} whoKey={whoKey} setWhoKey={setWhoKey}
                  active={active} explorerC={explorerC} onConnect={connect} connecting={wallet.connecting}
                  sign={sign} passphrase={cfg?.passphrase} walletAddress={wallet.address} />
              )}
              {tab === "wrap" && <WrapScreen active={active} sign={sign} passphrase={cfg?.passphrase} walletAddress={wallet.address} />}
              {tab === "unwrap" && <UnwrapScreen cfg={cfg} />}
              {tab === "send" && <SendScreen cfg={cfg} />}
            </>
          )}
        </div>
      </main>
    </div>
  );
}

// ---- a chooser of whose live position to inspect ---------------------------
function WhoChips({ whoList, whoKey, setWhoKey }: { whoList: Who[]; whoKey: string; setWhoKey: (k: string) => void }) {
  if (whoList.length <= 1) return null;
  return (
    <div className="pr__who" role="tablist" aria-label="View account">
      {whoList.map((w) => (
        <button key={w.key} role="tab" aria-selected={whoKey === w.key}
          className={`pr__whochip ${whoKey === w.key ? "is-active" : ""}`} onClick={() => setWhoKey(w.key)}>
          <span className="pr__whochip-label">{w.label}</span>
          <span className="pr__whochip-sub">{w.sub}</span>
        </button>
      ))}
    </div>
  );
}

// =============================================================================
// PORTFOLIO — real balances for the inspected account, split into public
// Tokens and sealed C-tokens, plus live on-chain transaction history.
// =============================================================================
function PortfolioScreen({
  whoList, whoKey, setWhoKey, active, explorerC, onConnect, connecting,
  sign, passphrase, walletAddress,
}: {
  whoList: Who[]; whoKey: string; setWhoKey: (k: string) => void;
  active: Who | null; explorerC: string; onConnect: () => void; connecting: boolean;
  sign: (xdr: string, passphrase: string) => Promise<string>;
  passphrase?: string;
  walletAddress?: string | null;
}) {
  const [data, setData] = useState<Portfolio | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [enrolling, setEnrolling] = useState(false);
  const [enrollRes, setEnrollRes] = useState<
    { ok?: boolean; blocked?: boolean; error_line?: string | null; hash?: string; error?: string } | null
  >(null);

  const load = useCallback(async (address: string) => {
    setLoading(true); setErr(null);
    try {
      const r = await fetch(api(`/api/portfolio?address=${encodeURIComponent(address)}`));
      const j: Portfolio = await r.json();
      if (j.error) { setErr(j.error); setData(null); } else { setData(j); }
    } catch (e) { setErr(String((e as Error)?.message || e)); setData(null); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    if (!active) return;
    load(active.address);
    const t = setInterval(() => load(active.address), 12000);
    return () => clearInterval(t);
  }, [active, load]);

  // Confidential enrollment (register), signed in Freighter by the connected
  // wallet. The backend builds the contract-bound proof + unsigned tx and
  // simulates it: an allowlisted wallet gets an XDR to sign (real on-chain
  // enrollment); a non-allowlisted wallet is rejected by the policy (#3602) at
  // simulation, reported honestly with no signature and no broadcast.
  const enroll = useCallback(async () => {
    if (!active) return;
    setEnrolling(true); setEnrollRes(null);
    try {
      const built = await fetch(api("/api/tx/build-register"), {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ address: active.address }),
      }).then((r) => r.json());
      if (!built?.ok) {
        setEnrollRes({ ok: false, blocked: !!built?.blocked, error_line: built?.error_line, error: built?.error });
        return;
      }
      if (!passphrase) { setEnrollRes({ ok: false, error: "Network not loaded yet. Retry." }); return; }
      const signed = await sign(built.xdr, passphrase);
      const sub = await fetch(api("/api/tx/submit"), {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ signedXdr: signed }),
      }).then((r) => r.json());
      setEnrollRes({ ok: !!sub.ok, hash: sub.hash, error: sub.ok ? undefined : sub.error });
      await load(active.address);
    } catch (e) {
      setEnrollRes({ ok: false, error: String((e as Error)?.message || e) });
    } finally {
      setEnrolling(false); }
  }, [active, passphrase, sign, load]);

  // The enroll CTA is actionable only for the connected wallet (it signs).
  const canEnroll = !!active && !!walletAddress && active.address === walletAddress;

  if (!active) {
    return (
      <section className="pr__screen pr__screen--narrow">
        <ScreenHead title="Portfolio" sub="Connect a wallet to see your live position on Stellar testnet" />
        <div className="pr__card pr__form">
          <button className="primary pr__big-btn" onClick={onConnect} disabled={connecting}>
            {connecting ? <span className="spinner" /> : "Connect wallet"}
          </button>
          <div className="pr__hint">A connected wallet shows its real public balances and history. The sealed confidential balance is legible only for enrolled accounts.</div>
        </div>
      </section>
    );
  }

  return (
    <section className="pr__screen">
      <ScreenHead title="Portfolio" sub={`Live position for ${active.label}`}
        badge={data?.allowlisted ? "Eligible" : undefined} />
      <WhoChips whoList={whoList} whoKey={whoKey} setWhoKey={setWhoKey} />

      <div className="pr__addrline">
        <span className="pr__k">Account</span>
        <a className="mono" href={`https://stellar.expert/explorer/testnet/account/${active.address}`} target="_blank" rel="noreferrer">
          {short(active.address, 10)} ↗
        </a>
        {data?.label && <span className="pr__rolepill">{data.label}</span>}
      </div>

      {err && <div className="pr__banner" role="alert">Could not load the position: {err.slice(0, 140)}. Retrying.</div>}

      {loading && !data ? (
        <div className="skeleton" style={{ height: 220, borderRadius: 16 }} />
      ) : data ? (
        <>
          {/* Public tokens */}
          <div className="pr__card">
            <div className="pr__k">Tokens · public</div>
            <div className="pr__tokgrid">
              {data.tokens.map((t) => (
                <div className="pr__tok" key={t.symbol}>
                  <div className="pr__tok-head">
                    <span className="pr__tok-sym">{t.symbol}</span>
                    <a className="pr__tok-link mono" href={`${explorerC}${t.contract}`} target="_blank" rel="noreferrer">contract ↗</a>
                  </div>
                  <div className="pr__tok-num">{t.human}</div>
                  <div className="pr__tok-name">{t.name}</div>
                  {t.underlying_human && (
                    <div className="pr__tok-foot">worth {t.underlying_human} rtFUND at NAV {data.exchange_rate_human}</div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Confidential c-tokens */}
          <div className="pr__card pr__card--seal">
            <div className="pr__k">C-tokens · confidential</div>
            {!data.registered ? (
              <div className="pr__enroll">
                <div className="pr__enroll-head">
                  <Lock open />
                  <div>
                    <div className="pr__sealvis-k">Not enrolled for confidential transfers</div>
                    <div className="pr__tok-foot">
                      Enrollment publishes this wallet&apos;s confidential keys on-chain so it can hold and receive a sealed balance. It succeeds only if the issuer has placed this address on the allowlist.
                    </div>
                  </div>
                </div>
                {canEnroll ? (
                  <>
                    <button className="primary pr__big-btn" onClick={enroll} disabled={enrolling}>
                      {enrolling ? <span className="spinner" /> : "Enroll this wallet"}
                    </button>
                    {enrollRes && (
                      <div className={`result ${enrollRes.ok ? "ok" : "fail"}`}>
                        <div className="result-head">
                          <span className="ico" aria-hidden>{enrollRes.ok ? "✓" : "✗"}</span>
                          <span>
                            {enrollRes.ok
                              ? "Enrolled on-chain. This wallet can now hold confidential balances."
                              : enrollRes.blocked
                                ? "Rejected on-chain. This wallet is not on the issuer allowlist."
                                : enrollRes.error || "Enrollment did not go through."}
                          </span>
                          {enrollRes.hash && (
                            <a className="mono pr__reslink" href={`https://stellar.expert/explorer/testnet/tx/${enrollRes.hash}`} target="_blank" rel="noreferrer">view tx ↗</a>
                          )}
                        </div>
                        {enrollRes.blocked && (
                          <div className="pr__redeemfoot">
                            The OpenZeppelin allowlist policy enforced this{enrollRes.error_line ? <> with <span className="mono">{enrollRes.error_line}</span></> : ""}. The gate fires at simulation, so nothing is signed or broadcast.
                          </div>
                        )}
                      </div>
                    )}
                  </>
                ) : (
                  <div className="pr__hint">Connect this wallet to enroll it. Enrollment is signed by the wallet itself in Freighter.</div>
                )}
              </div>
            ) : data.ctokens.length === 0 ? (
              <div className="pr__sealvis pr__sealvis--empty">
                <Lock />
                <div className="pr__sealvis-k">Enrolled · no sealed balance yet</div>
                <div className="pr__sealvis-u">This wallet is registered for confidential transfers. It has no sealed position yet.</div>
              </div>
            ) : (
              data.ctokens.map((c) => (
                <div className="pr__ctok" key={c.symbol}>
                  <div className="pr__ctok-head">
                    <Lock />
                    <div>
                      <div className="pr__tok-sym">{c.symbol}</div>
                      <div className="pr__tok-name">{c.name}</div>
                    </div>
                    <a className="pr__tok-link mono" href={`${explorerC}${c.contract}`} target="_blank" rel="noreferrer">contract ↗</a>
                  </div>
                  <div className="pr__ctok-body">
                    <div className="pr__ctok-cell">
                      <div className="pr__k">Decrypted balance · viewing key</div>
                      <div className="pr__bignum">{c.decrypted_human ?? "sealed"}<span className="pr__tok-u"> units</span></div>
                    </div>
                    <div className="pr__ctok-cell">
                      <div className="pr__k">Sealed commitment · on-chain</div>
                      <div className="mono pr__commit">{short(c.spendable_commitment || c.receiving_commitment, 16)}</div>
                      <div className="pr__tok-foot">Hidden from the public. The amount above is recovered with the viewing key.</div>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* On-chain history */}
          <div className="pr__card">
            <div className="pr__k">Activity · on-chain</div>
            {data.history.length === 0 ? (
              <div className="pr__hint">No transactions yet for this account.</div>
            ) : (
              <div className="pr__hist">
                {data.history.map((h) => (
                  <a className="pr__histrow" key={h.hash} href={h.link} target="_blank" rel="noreferrer">
                    <span className={`pr__histdot ${h.successful ? "is-ok" : "is-bad"}`} aria-hidden />
                    <span className="mono pr__histhash">{short(h.hash, 8)}</span>
                    <span className="pr__histmeta">{h.operation_count} op{h.operation_count === 1 ? "" : "s"}</span>
                    <span className="pr__histtime">{when(h.created_at)}</span>
                    <span className="pr__histlink mono">view ↗</span>
                  </a>
                ))}
              </div>
            )}
          </div>
        </>
      ) : null}
    </section>
  );
}

// =============================================================================
// WRAP — one action: deposit rtFUND into the confidential position and seal it.
// POST /api/wrap {address, amount}. Returns a list of real on-chain txs.
// =============================================================================
function WrapScreen({ active, sign, passphrase, walletAddress }: {
  active: Who | null;
  sign: (xdr: string, passphrase: string) => Promise<string>;
  passphrase?: string;
  walletAddress?: string | null;
}) {
  const [amt, setAmt] = useState("300");
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<{ ok?: boolean; hash?: string; error?: string } | null>(null);

  // The deposit (rtFUND -> wsFUND) is built server-side and SIGNED BY THE
  // CONNECTED WALLET in Freighter, then submitted. This is a real self-custody
  // action: the wallet authorises pulling its own rtFUND into the wrapper.
  const canSign = !!active && !!walletAddress && active.address === walletAddress;

  const wrap = useCallback(async () => {
    if (!active) return;
    setBusy(true); setRes(null);
    try {
      const amount = String(Math.max(0, Math.round(Number(amt) || 0)) * RATE_ONE);
      const built = await fetch(api("/api/tx/build-deposit"), {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ address: active.address, amount }),
      }).then((r) => r.json());
      if (built.error) { setRes({ ok: false, error: built.error }); return; }
      if (!passphrase) { setRes({ ok: false, error: "Network not loaded yet. Retry." }); return; }
      const signed = await sign(built.xdr, passphrase);
      const sub = await fetch(api("/api/tx/submit"), {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ signedXdr: signed }),
      }).then((r) => r.json());
      setRes({ ok: !!sub.ok, hash: sub.hash, error: sub.ok ? undefined : (sub.error || `status ${sub.status}`) });
    } catch (e) { setRes({ ok: false, error: String((e as Error)?.message || e) }); }
    finally { setBusy(false); }
  }, [active, amt, sign, passphrase]);

  return (
    <section className="pr__screen pr__screen--narrow">
      <ScreenHead title="Wrap" sub="Convert rtFUND into non-rebasing wsFUND shares, signed in your wallet"
        badge={res?.ok ? "Wrapped" : undefined} />
      <div className="pr__card pr__form">
        <AmountField label="Amount" suffix="rtFUND" value={amt} onChange={setAmt} />
        <div className="pr__actions">
          <button className="primary pr__big-btn" onClick={wrap} disabled={busy || !canSign || Number(amt) <= 0}>
            {busy ? <span className="spinner" /> : "Wrap and sign in wallet"}
          </button>
        </div>
        {!canSign && <div className="pr__hint">Connect your wallet to wrap. The deposit is signed by your wallet in Freighter.</div>}
        <div className="pr__hint">Converts rtFUND into wsFUND, a non-rebasing share whose value grows with the published NAV. Sealing a share into the confidential ledger is a separate issuer action.</div>
        {res && (
          <div className={`result ${res.ok ? "ok" : "fail"}`}>
            <div className="result-head">
              <span className="ico" aria-hidden>{res.ok ? "✓" : "!"}</span>
              <span>{res.ok ? "Wrapped into wsFUND, signed by your wallet and confirmed on-chain." : (res.error || "Wrap did not go through.")}</span>
              {res.hash && <a className="mono pr__reslink" href={`https://stellar.expert/explorer/testnet/tx/${res.hash}`} target="_blank" rel="noreferrer">view tx ↗</a>}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

// =============================================================================
// UNWRAP — redeem the position back to rtFUND, priced at the published NAV.
// POST /api/unwrap {amount}.
// =============================================================================
function UnwrapScreen({ cfg }: { cfg: Cfg | null }) {
  const [amt, setAmt] = useState("100");
  const [busy, setBusy] = useState(false);
  const [nav, setNav] = useState<string | null>(null);
  const [res, setRes] = useState<Record<string, unknown> | null>(null);

  // Read the live NAV from the treasurer's portfolio so the number is real.
  useEffect(() => {
    const alice = cfg?.accounts?.alice;
    if (!alice) return;
    fetch(api(`/api/portfolio?address=${alice}`)).then((r) => r.json())
      .then((j: Portfolio) => setNav(j.exchange_rate_human || null)).catch(() => {});
  }, [cfg]);

  const redeem = useCallback(async () => {
    setBusy(true); setRes(null);
    try {
      const amount = Math.max(0, Math.round(Number(amt) || 0)) * RATE_ONE;
      const r = await fetch(api("/api/unwrap"), {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ amount }),
      });
      setRes(await r.json());
    } catch (e) { setRes({ ok: false, error: String((e as Error)?.message || e) }); }
    finally { setBusy(false); }
  }, [amt]);

  const ok = !!res?.ok;
  return (
    <section className="pr__screen pr__screen--narrow">
      <ScreenHead title="Unwrap" sub="Redeem the position back to rtFUND, priced at the published NAV"
        badge={ok ? "Redeemed" : undefined} />
      <div className="pr__card pr__form">
        <AmountField label="Amount" suffix="shares" value={amt} onChange={setAmt} />
        <div className="pr__rate-note">
          <span>Published NAV · per share</span>
          <strong>{(res?.nav_human as string) || nav || "…"}</strong>
        </div>
        <div className="pr__actions">
          <button className="primary pr__big-btn" onClick={redeem} disabled={busy || Number(amt) <= 0}>
            {busy ? <span className="spinner" /> : "Redeem to rtFUND"}
          </button>
        </div>
        {res && (
          <div className={`result ${ok ? "ok" : "fail"}`}>
            <div className="result-head">
              <span className="ico" aria-hidden>{ok ? "✓" : "!"}</span>
              <span>{(res.label as string) || (ok ? "Redeemed." : "Could not redeem.")}</span>
              {!!res.tx_link && <a className="mono pr__reslink" href={res.tx_link as string} target="_blank" rel="noreferrer">view tx ↗</a>}
            </div>
            {ok && !!res.got_back_human && (
              <div className="pr__redeemfoot">Received <strong>{res.got_back_human as string} rtFUND</strong> at NAV {res.nav_human as string}.</div>
            )}
            {!!res.error && <div className="log">{String(res.error).slice(0, 600)}</div>}
          </div>
        )}
      </div>
    </section>
  );
}

// =============================================================================
// SEND — confidential or public transfer. POST /api/send {to, token, amount, from}.
// A recipient off the allowlist is GENUINELY rejected by the on-chain policy
// (#3602). Quick-fills: Carol is eligible, Bob is not.
// =============================================================================
function SendScreen({ cfg }: { cfg: Cfg | null }) {
  const [to, setTo] = useState("");
  const [amt, setAmt] = useState("40");
  const [token, setToken] = useState<"confidential" | "rtFUND" | "wsFUND">("confidential");
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<Record<string, unknown> | null>(null);

  // Demo recipients: the whitelisted wallet succeeds, the non-whitelisted one
  // is rejected on-chain by the allowlist policy (#3602).
  const eligible = "GB5V4L4V5WNPTRTOHABHK2X5SIAACXHQBCRB62FU3DK2IQVYYX5U67RG";
  const ineligible = "GBG4SUAAKTBPEYGPM3FG4XAPU3DDKDOTBAWFBPIHWNNCZZQCAH2423VM";

  const send = useCallback(async () => {
    setBusy(true); setRes(null);
    try {
      const amount = Math.max(0, Math.round(Number(amt) || 0)) * RATE_ONE;
      const r = await fetch(api("/api/send"), {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ to: to.trim(), amount, token }),
      });
      setRes(await r.json());
    } catch (e) { setRes({ ok: false, error: String((e as Error)?.message || e) }); }
    finally { setBusy(false); }
  }, [to, amt, token]);

  const ok = !!res?.ok && !res?.reverted && res?.broadcast !== false;
  const blocked = !!res && (res.reverted === true || res.broadcast === false || !!res.error_line);

  return (
    <section className="pr__screen pr__screen--narrow">
      <ScreenHead title="Send" sub="Transfer to an eligible account. The chain rejects anyone off the allowlist"
        badge={ok ? "Sent" : blocked ? "Rejected on-chain" : undefined} />
      <div className="pr__card pr__form">
        <div className="pr__field">
          <label className="pr__label" htmlFor="pr-to">Recipient address</label>
          <div className="pr__amount">
            <input id="pr-to" className="pr__amount-input" value={to} onChange={(e) => setTo(e.target.value.trim())}
              placeholder="G…" autoComplete="off" spellCheck={false} />
          </div>
          <div className="pr__quickfills">
            <button className="pr__quick" onClick={() => setTo(eligible)}>Whitelisted wallet</button>
            <button className="pr__quick pr__quick--bad" onClick={() => setTo(ineligible)}>Non-whitelisted wallet</button>
          </div>
        </div>

        <div className="pr__field">
          <label className="pr__label">Token</label>
          <div className="pr__seg" role="tablist">
            {(["confidential", "rtFUND", "wsFUND"] as const).map((t) => (
              <button key={t} role="tab" aria-selected={token === t}
                className={`pr__segbtn ${token === t ? "is-active" : ""}`} onClick={() => setToken(t)}>
                {t === "confidential" ? "Confidential" : t}
              </button>
            ))}
          </div>
        </div>

        <AmountField label="Amount" suffix={token === "confidential" ? "units" : token} value={amt} onChange={setAmt} />

        <div className="pr__actions">
          <button className="primary pr__big-btn" onClick={send} disabled={busy || !to || Number(amt) <= 0}>
            {busy ? <span className="spinner" /> : token === "confidential" ? "Send confidential transfer" : `Send ${token}`}
          </button>
        </div>

        {res && (
          <div className={`result ${ok ? "ok" : blocked ? "fail" : "fail"}`}>
            <div className="result-head">
              <span className="ico" aria-hidden>{ok ? "✓" : "✗"}</span>
              <span>
                {ok
                  ? (res.label as string) || "Transfer confirmed on-chain."
                  : blocked
                    ? "Rejected on-chain. The recipient is not on the allowlist."
                    : (res.label as string) || "Transfer did not go through."}
              </span>
              {!!res.tx_link && <a className="mono pr__reslink" href={res.tx_link as string} target="_blank" rel="noreferrer">view tx ↗</a>}
            </div>
            {blocked && (
              <div className="pr__redeemfoot">
                The OpenZeppelin allowlist policy enforced this{res.error_line ? <> with <span className="mono">{res.error_line as string}</span></> : ""}. The gate fires before broadcast, so no transaction is submitted and no funds move.
              </div>
            )}
            {!!res.error && !blocked && <div className="log">{String(res.error).slice(0, 600)}</div>}
          </div>
        )}
        <div className="pr__hint">Confidential sends carry a real UltraHonk transfer proof. Eligibility is enforced by the chain, not by this app.</div>
      </div>
    </section>
  );
}

// =============================================================================
// AUDITOR — a privileged key-holder role, not a holder tab. The key is POSTed
// to /api/auditor/reveal, which decrypts EVERY confidential holder.
// In this public demo the auditor key is 1 (sk=1).
// =============================================================================
function AuditorView() {
  const [key, setKey] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<AuditorReveal | null>(null);

  // Wallet lookup: search any address and read its live rtFUND/wsFUND balances
  // plus confidential status. Public balances resolve for any wallet; the
  // confidential amount decrypts only where this auditor holds the viewing key.
  const [q, setQ] = useState("");
  const [qData, setQData] = useState<Portfolio | null>(null);
  const [qLoading, setQLoading] = useState(false);
  const [qErr, setQErr] = useState<string | null>(null);
  const lookup = useCallback(async () => {
    const a = q.trim();
    if (!a || !a.startsWith("G") || a.length !== 56) { setQErr("Enter a valid Stellar address (G...)."); setQData(null); return; }
    setQLoading(true); setQErr(null);
    try {
      const j: Portfolio = await fetch(api(`/api/portfolio?address=${encodeURIComponent(a)}`)).then((r) => r.json());
      if ((j as { error?: string }).error) { setQErr(String((j as { error?: string }).error)); setQData(null); }
      else setQData(j);
    } catch (e) { setQErr(String((e as Error)?.message || e)); setQData(null); }
    finally { setQLoading(false); }
  }, [q]);

  const reveal = useCallback(async () => {
    const k = key.trim();
    if (!k) { setError("Enter the auditor key to reveal confidential holders."); setData(null); return; }
    setLoading(true); setError(null);
    try {
      const res = await fetch(api("/api/auditor/reveal"), {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ key: k }),
      });
      const json: AuditorReveal = await res.json().catch(() => ({ ok: false }));
      if (json?.ok === false || !Array.isArray(json?.holders)) {
        setData(null);
        setError("That key does not grant disclosure. Check the auditor key and try again.");
        return;
      }
      setData(json);
    } catch { setData(null); setError("Could not reach the disclosure service. Try again."); }
    finally { setLoading(false); }
  }, [key]);

  const holders = data?.holders ?? [];
  const revealed = holders.length > 0;

  return (
    <section className="pr__screen">
      <ScreenHead title="Auditor" sub="Selective disclosure. Look up any wallet, or paste the auditor key to reveal every confidential holder"
        badge={revealed ? `${holders.length} revealed` : undefined} />

      <div className="pr__card pr__form">
        <div className="pr__field">
          <label className="pr__label" htmlFor="pr-audkey">Paste the auditor key</label>
          <div className="pr__amount pr__keyfield">
            <input id="pr-audkey" className="pr__amount-input pr__key-input" value={key}
              onChange={(e) => setKey(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") reveal(); }}
              placeholder="auditor key" autoComplete="off" spellCheck={false} />
          </div>
        </div>
        <div className="pr__actions">
          <button className="primary pr__big-btn" onClick={reveal} disabled={loading}>
            {loading ? <span className="spinner" /> : "Reveal"}
          </button>
        </div>
        {error && (
          <div className="result fail" role="alert">
            <div className="result-head"><span className="ico" aria-hidden>!</span><span>{error}</span></div>
          </div>
        )}
        {!error && !revealed && !loading && (
          <div className="pr__hint">No wallet needed. Enter the auditor key to decrypt the confidential ledger. In this demo the key is <code>1</code>.</div>
        )}
      </div>

      {/* Wallet lookup explorer: shown only once the auditor key is accepted. */}
      {revealed && (
      <div className="pr__card pr__form">
        <div className="pr__k">Look up a wallet</div>
        <div className="pr__field">
          <div className="pr__amount pr__keyfield">
            <input className="pr__amount-input pr__key-input" value={q}
              onChange={(e) => setQ(e.target.value.trim())}
              onKeyDown={(e) => { if (e.key === "Enter") lookup(); }}
              placeholder="G… wallet address" autoComplete="off" spellCheck={false} />
          </div>
        </div>
        <div className="pr__actions">
          <button className="primary pr__big-btn" onClick={lookup} disabled={qLoading}>
            {qLoading ? <span className="spinner" /> : "Search"}
          </button>
        </div>
        {qErr && (
          <div className="result fail"><div className="result-head"><span className="ico" aria-hidden>!</span><span>{qErr}</span></div></div>
        )}
        {qData && (
          <div className="pr__lookup">
            <div className="pr__lookuphead">
              <span className="pr__tok-sym">{qData.label || qData.role}</span>
              {qData.allowlisted && <span className="pr__verified">allowlisted</span>}
              <a className="pr__tok-link mono" href={`https://stellar.expert/explorer/testnet/account/${qData.address}`} target="_blank" rel="noreferrer">{short(qData.address, 10)} ↗</a>
            </div>
            <div className="pr__tokgrid">
              {qData.tokens.map((t) => (
                <div className="pr__tok" key={t.symbol}>
                  <div className="pr__tok-head"><span className="pr__tok-sym">{t.symbol}</span></div>
                  <div className="pr__tok-num">{t.human}</div>
                </div>
              ))}
            </div>
            <div className="pr__tok-foot">
              Confidential: {!qData.registered
                ? "not enrolled"
                : qData.ctokens[0]?.decrypted_human
                  ? `decrypted ${qData.ctokens[0].decrypted_human} units`
                  : "sealed commitment, viewing key not held by this auditor"}
            </div>
          </div>
        )}
      </div>
      )}

      {revealed && (
        <div className="pr__card">
          <div className="pr__k">Confidential holders · decrypted</div>
          <div className="pr__audtable">
            {holders.map((h, i) => (
              <div className="pr__audrow" key={`${h.address}-${i}`}>
                <div className="pr__audwho">
                  <div className="pr__audlabel">
                    {h.label || `Holder ${i + 1}`}
                    {h.verified && <span className="pr__verified" title="Recomputed against the on-chain commitment">verified</span>}
                  </div>
                  {h.address && <div className="pr__audaddr mono">{short(h.address, 10)}</div>}
                </div>
                <div className="pr__audbal">
                  <span className="pr__audbal-num">{h.balance_human ?? ""}</span>
                  <span className="pr__audbal-u">units</span>
                </div>
                <div className="pr__audcommit mono" title={h.commitment || ""}>{h.commitment ? short(h.commitment, 12) : ""}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="disclosure">
        <strong>Selective disclosure.</strong> This is the issuer and regulator capability. The auditor key decrypts every confidential holding at once. Confidential, not anonymous. Balances are hidden from the public yet fully legible to the key-holder.
      </div>
    </section>
  );
}

// ---- shared bits -----------------------------------------------------------
function ScreenHead({ title, sub, badge }: { title: string; sub: string; badge?: string }) {
  return (
    <div className="pr__screenhead">
      <div>
        <h1 className="pr__h1">{title}</h1>
        <p className="pr__sub">{sub}</p>
      </div>
      {badge && <span className="pr__badge">{badge}</span>}
    </div>
  );
}

function AmountField({ label, suffix, value, onChange }: { label: string; suffix: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="pr__field">
      <label className="pr__label">{label}</label>
      <div className="pr__amount">
        <input className="pr__amount-input" inputMode="decimal" value={value}
          onChange={(e) => onChange(e.target.value.replace(/[^0-9.]/g, ""))} placeholder="0" />
        <span className="pr__amount-suffix">{suffix}</span>
      </div>
    </div>
  );
}

function Lock({ open = false }: { open?: boolean }) {
  return (
    <svg className={`pr__lock ${open ? "is-open" : ""}`} viewBox="0 0 48 60" width={40} height={50} aria-hidden>
      <path className="pr__lock-shackle" d={open ? "M14 26 V18 a10 10 0 0 1 20 0 V22" : "M14 26 V18 a10 10 0 0 1 20 0 V26"}
        fill="none" strokeWidth="4" strokeLinecap="round" />
      <rect className="pr__lock-body" x="8" y="26" width="32" height="26" rx="4" />
      <circle className="pr__lock-hole" cx="24" cy="37" r="3.4" />
      <rect className="pr__lock-hole" x="22.6" y="38" width="2.8" height="7" rx="1.4" />
    </svg>
  );
}
