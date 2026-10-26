# Deployment — online demo for judges

Goal: a judge opens a URL and uses the real app (live testnet state + real confidential
write actions). Split by what can run serverless vs what needs a persistent server.

```
Browser ──▶ Vercel (static React build + serverless READ API via Stellar RPC)
                  │  write actions (register / deposit / transfer)
                  ▼
            Fly.io container  (prover + signer)
              - node server (web/server)  ── shells ──▶ stellar CLI, nargo, bb, scripts/*
              - demo signing keys injected as Fly secrets (NOT in the image)
```

## Why a server is needed
Confidential writes = generate an UltraHonk proof (`bb` 0.87.0) from a witness
(`nargo` beta.11 over the OZ confidential circuits) **and** sign+submit a Soroban tx
(`stellar` CLI). None of that runs in a Vercel serverless function. Reads
(balances/commitments/`exchange_rate`/allowlist, auditor decrypt = client-side math)
do not need it.

## Fly backend — image requirements (NO Rust toolchain needed at runtime)
Contracts are already deployed; the server only proves + signs + submits.
- `node` 20 (runs `web/server`).
- `stellar` CLI (prebuilt linux binary; pin the deployed version line).
- `nargo` 1.0.0-beta.11 + `bb` 0.87.0 (via `noirup` / `bbup`).
- The OZ confidential **circuits + lib** (sparse clone of
  `OpenZeppelin/stellar-contracts` → `packages/confidential`) — `prove.sh` builds in a
  throwaway copy. Full 2.3G clone NOT required; sparse-checkout the confidential package.
- Repo `circuits/`, `scripts/`, `deployments/testnet.json`.
- RAM: `bb` proving needs headroom — start at **2GB**, bump if OOM.

### Signing keys (do NOT bake into the image)
Scripts use `stellar keys` aliases (`crwa-admin`, `crwa-alice`, `crwa-carol`, `crwa-issuer`).
In the container, recreate them at boot from **Fly secrets** holding the seeds:
```
fly secrets set SK_ADMIN=S... SK_ALICE=S... SK_CAROL=S... SK_ISSUER=S...
# entrypoint: stellar keys add crwa-admin --secret-key "$SK_ADMIN" (etc.)
```
These are **testnet** keys (low stakes) but still injected as secrets, never committed.

### CORS
Server must allow the Vercel origin (`ACCESS_CONTROL_ALLOW_ORIGIN` = the Vercel URL),
and expose a `/health` endpoint for Fly checks.

## Frontend — Vercel
- Vite static build.
- `VITE_BACKEND_URL` → the Fly app URL (write actions); reads go through Vercel serverless
  functions calling Stellar RPC directly.

## One-time operator steps (interactive — user runs these)
```
fly auth login          # browser login (cannot be automated)
vercel login            # if not already authed
```

## Deploy
```
# backend
fly launch --no-deploy        # create app from the Dockerfile (name: confidential-rwa-api)
fly secrets set SK_...=...     # inject demo seeds
fly deploy                     # remote build + deploy

# frontend
cd web && vercel --prod        # set VITE_BACKEND_URL to the fly app URL
```

## Verification (done by the deploy agent, not trusted blindly)
1. `GET https://<fly-app>/health` → 200.
2. Frontend loads on the Vercel URL; live reads show real on-chain state (exchange_rate,
   alice commitment) matching a direct `stellar contract invoke`.
3. A write action from the deployed UI (e.g. a small confidential transfer) lands on
   testnet — confirm the tx on Horizon.
4. Fallback if Fly proving is too slow/OOM in-budget: ship read-only live on Vercel +
   keep write actions in the recorded demo, and say so honestly in the README.
