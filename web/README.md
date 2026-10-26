# Treasury Vault — frontend (Next.js, app router, TS)

A plain-language web app for a corporate treasurer. It drives the **real**
confidential-RWA flow against the **live Stellar testnet** contracts recorded in
`../deployments/testnet.json`, and wires the **Freighter** wallet.

What the treasurer sees (no crypto jargon in the UI):

1. **Deposit treasury into the vault** — one click. Either signed in the user's
   own Freighter wallet (real `wsFUND.deposit` tx, built + prepared server-side,
   signed in-browser, broadcast) or as the demo treasurer (server-signed).
2. **Balance shown as HIDDEN** — once sealed, the balance is a Pedersen
   commitment on-chain; the UI shows a lock, not a number.
3. **Public "value per unit" grows** after interest accrues (live exchange rate).
4. **Eligibility reject** — attempting to move the fund to an un-approved party
   is rejected **on-chain** (OZ allowlist policy, error `#3602`), surfaced as a
   clear UX moment.
5. **Auditor view toggle** — a permissioned auditor reveals the true balance and
   it matches the sealed on-chain commitment.
6. **Withdraw with yield** — redeem for more than deposited.

## Run

```bash
cd web
pnpm install
pnpm dev
# open http://localhost:3000
```

Prerequisites (same as the rest of the repo):

- `stellar` CLI (v27) on PATH with the `crwa-*` key aliases imported.
- A deployed suite in `../deployments/testnet.json` (from `scripts/deploy.sh`).
- The Phase-1 proving module already produced `../out/register_alice/*`
  (run `scripts/e2e.sh` once so the treasurer account is enrolled in the
  confidential ledger).
- Freighter browser extension (freighter.app) for the wallet-signed deposit.

## Architecture

- **Next.js app router**, TypeScript, pnpm.
- `app/page.tsx` — the single treasurer screen (client component).
- `components/useFreighter.ts` — `@stellar/freighter-api` wallet hook.
- `lib/tx.ts` — builds a real unsigned/prepared `wsFUND.deposit` transaction with
  `@stellar/stellar-sdk` against Soroban testnet RPC; submits the Freighter-signed
  XDR.
- `lib/chain.ts` — server-only driver that shells the real `stellar` CLI and the
  proving module for the steps a browser wallet cannot perform (confidential
  register/deposit which need an UltraHonk proof, the Pedersen auditor decrypt).
  Same calls as `scripts/e2e.sh`.
- `app/api/*` — route handlers (Node runtime) exposing those to the browser.

## No fabricated data

Every number is a live `stellar contract invoke` read, a real state-changing
invoke, or the output of the real proving scripts. Nothing is mocked.

## Honesty (carried verbatim into the UI)

- The demo **auditor key is the generator point** (publicly known) and the
  confidential deposit uses **zero blinding** (`c = a·G`), so the auditor
  "reveal" is an exact point recomputation, not a private ECDH channel.
- The enrolment proof is a **real UltraHonk proof** accepted by the on-chain
  verifier, but it is **not zero-knowledge**.
- The sealed commitment, the on-chain eligibility rejection, and the growing
  exchange rate are all **real on testnet**.
- A hiding confidential *transfer* is not fabricated and is out of scope here.

## Verified in-browser / against live testnet (2026-10-25)

- `GET /api/config` → contract ids from `deployments/testnet.json`.
- `GET /api/state` → live reads: `exchange_rate=1.7954597`, treasurer
  `allowlisted=true`, other party `allowlisted=false`, a real non-identity
  `receiving_commitment`, `registered=true`, auditor key present.
- `POST /api/step/accrue` → rate grew `1.7954597 → 1.8852326` on-chain.
- `POST /api/step/register-bob` → rejected on-chain, `Error(Contract, #3602)`.
- `POST /api/step/audit` → recomputed `total·G` matches on-chain commitment;
  true balance `150.00` units revealed.
- `POST /api/tx/build-deposit` → returns a real prepared 1424-char transaction
  XDR for the connected account (signed in-browser by Freighter at demo time).
- `pnpm build` → compiles, types valid, all 11 routes built.

The previous Vite prototype is archived in `_vite_legacy/`.
