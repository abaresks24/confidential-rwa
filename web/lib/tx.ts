// =============================================================================
// Server-side transaction builder for the Freighter-signed path.
//
// Builds a REAL, unsigned wsFUND.deposit transaction (XDR) for the connected
// wallet address using @stellar/stellar-sdk against LIVE testnet. The browser
// signs it with Freighter and submits it back for broadcast. This is the
// genuine wallet-driven deposit the treasurer performs in one click.
//
// Requirement: the connected Freighter account must already hold rtFUND and
// have approved (or the wrapper pull) — in the demo the enrolled treasurer
// account (alice) holds rtFUND. A wallet with no rtFUND will get a clear
// on-chain error, which we surface verbatim (never a fake success).
// =============================================================================
import {
  Address,
  Contract,
  nativeToScVal,
  rpc,
  TransactionBuilder,
  BASE_FEE,
  xdr,
} from "@stellar/stellar-sdk";
import { C, d, buildRegisterData } from "./chain";

const RPC_URL = "https://soroban-testnet.stellar.org";

// =============================================================================
// Freighter-signed confidential ENROLLMENT (register).
//
// Builds a REAL, unsigned `register` transaction for the connected wallet: the
// backend generates the contract-bound UltraHonk register proof + RegisterData
// envelope (chain.buildRegisterData), assembles the invoke with the wallet as
// source, and simulates it. The allowlist policy is enforced AT SIMULATION:
//   - allowlisted account  -> simulation succeeds -> we return the XDR for the
//     wallet to sign in Freighter and submit (a real on-chain enrollment).
//   - non-allowlisted      -> simulation fails with #3602 NotAuthorizedByPolicy
//     -> no submittable tx exists; we report the genuine on-chain rejection
//     (blocked:true) honestly, never a fabricated success.
// =============================================================================
export async function buildRegisterXdr(address: string) {
  const { dataHex, auditorId } = await buildRegisterData(address);
  const server = new rpc.Server(RPC_URL);
  const account = await server.getAccount(address);
  const contract = new Contract(C.compliant_token);

  const op = contract.call(
    "register",
    nativeToScVal(Address.fromString(address), { type: "address" }),
    nativeToScVal(Number(auditorId), { type: "u32" }),
    xdr.ScVal.scvBytes(Buffer.from(dataHex, "hex"))
  );

  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: d.network_passphrase,
  })
    .addOperation(op)
    .setTimeout(120)
    .build();

  try {
    const prepared = await server.prepareTransaction(tx);
    return { ok: true, xdr: prepared.toXDR() };
  } catch (e) {
    const msg = String((e as Error)?.message || e);
    const line =
      (msg.match(/Error\(Contract[^)]*\)[^\n"]*/) || [])[0] ||
      (msg.match(/#\d{3,5}/) || [])[0] ||
      null;
    const blocked = /3602|NotAuthoriz|allow/i.test(msg);
    return { ok: false, blocked, error_line: line, error: msg.slice(0, 500) };
  }
}

export async function buildDepositXdr(walletAddress: string, underlyingAmount: string) {
  const server = new rpc.Server(RPC_URL);
  const account = await server.getAccount(walletAddress);
  const contract = new Contract(C.wsFUND);

  const op = contract.call(
    "deposit",
    nativeToScVal(Address.fromString(walletAddress), { type: "address" }),
    nativeToScVal(BigInt(underlyingAmount), { type: "i128" })
  );

  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: d.network_passphrase,
  })
    .addOperation(op)
    .setTimeout(120)
    .build();

  const prepared = await server.prepareTransaction(tx);
  return prepared.toXDR();
}

const HORIZON_URL = "https://horizon-testnet.stellar.org";

export async function submitSignedXdr(signedXdr: string) {
  const server = new rpc.Server(RPC_URL);
  const tx = TransactionBuilder.fromXDR(signedXdr, d.network_passphrase);
  // Compute the hash locally so confirmation never depends on the RPC response
  // decode (which throws "Bad union switch" when the SDK is older than the
  // network's TransactionMeta version — the tx still broadcasts fine).
  const hash = tx.hash().toString("hex");

  try {
    const sent = await server.sendTransaction(tx);
    if (sent.status === "ERROR") {
      return { ok: false, status: "ERROR", hash, error: JSON.stringify(sent.errorResult ?? {}) };
    }
  } catch {
    // The RPC broadcast still happened; the throw is only in response XDR
    // decode. Fall through and confirm the result via Horizon (plain JSON).
  }

  // Confirm via Horizon REST — returns JSON `successful`, no XDR meta decode.
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const r = await fetch(`${HORIZON_URL}/transactions/${hash}`);
    if (r.ok) {
      const j = (await r.json()) as { successful?: boolean };
      return { ok: j.successful === true, status: j.successful ? "SUCCESS" : "FAILED", hash };
    }
    await new Promise((res) => setTimeout(res, 1500));
  }
  return { ok: false, status: "TIMEOUT", hash };
}
