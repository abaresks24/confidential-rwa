# =============================================================================
# Fly backend image for confidential-rwa.
#
# This image runs the Next.js server (web/) which serves BOTH the treasurer UI
# and ALL /api/* route handlers. The write routes (confidential register /
# deposit / transfer, auditor decrypt) shell out to:
#   - the `stellar` CLI (Soroban invokes + key management),
#   - `nargo` + `bb` via circuits/prove.sh (real UltraHonk proofs),
#   - the OZ confidential circuits/lib (sparse-cloned below).
#
# NO Rust toolchain: the contracts are already deployed on testnet; the server
# only proves, signs and submits.
#
# Target arch: linux/amd64 (Fly).
# =============================================================================

# ---- Stage 1: build the Next.js standalone bundle ---------------------------
# trixie (Debian 13, glibc 2.41 + libstdc++ GLIBCXX_3.4.32): bb 0.87.0's
# prebuilt binary requires GLIBC>=2.38 / GLIBCXX_3.4.32, which bookworm lacks.
FROM --platform=linux/amd64 node:20-trixie-slim AS web-build
WORKDIR /app/web

RUN corepack enable

# Install web deps (pnpm) against the committed lockfile.
# minimum-release-age=0 disables pnpm's supply-chain age gate, which otherwise
# rejects transitive deps published within its cutoff window (CI-only concern;
# the lockfile is already pinned + committed).
COPY web/package.json web/pnpm-lock.yaml ./
# strict-dep-builds=false: do not ERROR when optional native deps (sharp)
# have un-approved build scripts. We don't need sharp's native binding — Next's
# image optimizer is unused by this single-page app, so an un-built sharp is OK.
RUN pnpm config set minimum-release-age 0 \
    && pnpm config set strict-dep-builds false \
    && pnpm install --frozen-lockfile

# Build. output:"standalone" => .next/standalone/server.js + traced node_modules.
COPY web/ ./
RUN pnpm build


# ---- Stage 2: runtime image -------------------------------------------------
FROM --platform=linux/amd64 node:20-trixie-slim AS runtime
WORKDIR /app

ENV DEBIAN_FRONTEND=noninteractive
ENV NODE_ENV=production
# Repo root the server resolves scripts/, deployments/, out/, circuits/,
# reference/ from (lib/chain.ts honours REPO_ROOT).
ENV REPO_ROOT=/app
# Toolchain install roots.
ENV PATH="/root/.nargo/bin:/root/.bb:${PATH}"

# OS deps: curl/git for toolchain + sparse clone; bash/xxd(vim-common) for the
# shell scripts; ca-certs; libstdc++ for bb; jq used by some scripts.
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates curl git bash jq xxd \
      libstdc++6 libc++1 libdbus-1-3 \
    && rm -rf /var/lib/apt/lists/*

# ---- stellar CLI (prebuilt linux x86_64 binary, pinned 27.0.0) --------------
RUN curl -fsSL -o /tmp/stellar.tar.gz \
      "https://github.com/stellar/stellar-cli/releases/download/v27.0.0/stellar-cli-27.0.0-x86_64-unknown-linux-gnu.tar.gz" \
    && tar -xzf /tmp/stellar.tar.gz -C /usr/local/bin stellar \
    && rm /tmp/stellar.tar.gz \
    && stellar --version

# ---- nargo 1.0.0-beta.11 (via noirup) ---------------------------------------
RUN curl -fsSL https://raw.githubusercontent.com/noir-lang/noirup/main/install | bash \
    && /root/.nargo/bin/noirup -v 1.0.0-beta.11 \
    && nargo --version

# ---- bb 0.87.0 (via bbup) ---------------------------------------------------
# NOTE: `bb --version` is NOT run as a build gate. bb's crypto init crashes under
# QEMU x86_64 emulation (Assertion `multiplicative_constant == fr::one()`), so a
# local amd64-emulated build on Apple Silicon would fail here even though the
# binary is correct. On a NATIVE amd64 host (Fly remote builders) bb runs fine.
# We assert the binary is present + executable instead.
RUN curl -fsSL https://raw.githubusercontent.com/AztecProtocol/aztec-packages/master/barretenberg/bbup/install | bash \
    && /root/.bb/bbup -v 0.87.0 \
    && test -x /root/.bb/bb \
    && echo "bb binary installed at /root/.bb/bb"

# ---- OZ confidential circuits + lib (sparse clone, NOT the full 2.3G repo) ---
# prove.sh expects them at reference/stellar-contracts/packages/confidential/*.
# v0.8.0 == ddc327e (the exact VK-pinned ref used to build the deployed suite).
RUN git clone --no-checkout --depth 1 --filter=blob:none \
      https://github.com/OpenZeppelin/stellar-contracts.git \
      /app/reference/stellar-contracts \
    && git -C /app/reference/stellar-contracts sparse-checkout init --cone \
    && git -C /app/reference/stellar-contracts sparse-checkout set packages/confidential \
    && git -C /app/reference/stellar-contracts fetch --depth 1 origin ddc327eb92d63709436da3a8455f641c2d5476c5 \
    && git -C /app/reference/stellar-contracts checkout ddc327eb92d63709436da3a8455f641c2d5476c5 \
    && ls /app/reference/stellar-contracts/packages/confidential/circuits/Nargo.toml

# ---- repo payload the server shells ----------------------------------------
COPY circuits/ /app/circuits/
COPY scripts/ /app/scripts/
COPY deployments/ /app/deployments/
# Genesis confidential proof artifacts (register_alice/conf_total,
# register_carol, transfer_ac/transfer.json, transfer_state openings). The
# entrypoint stages these into /app/out on first boot IF absent, so the
# confidential deposit/auditor/send flows have the same self-consistent
# opening state the local e2e produces. Values match the LIVE on-chain
# commitments byte-for-byte (verified via the OZ Pedersen gadget).
COPY seed/ /app/seed/

# scripts/*.mjs need @stellar/stellar-sdk at scripts/node_modules.
RUN cd /app/scripts && npm install --omit=dev --no-audit --no-fund

# ---- Next.js standalone server ----------------------------------------------
# Standalone layout: server.js + .next + node_modules at the bundle root; the
# static assets and public/ must be placed alongside .next.
COPY --from=web-build /app/web/.next/standalone/ /app/web/
COPY --from=web-build /app/web/.next/static/ /app/web/.next/static/
# (no web/public/ in this project)

# ---- entrypoint -------------------------------------------------------------
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

ENV PORT=8080
EXPOSE 8080

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
