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
} from "@stellar/stellar-sdk";
import { C, d } from "./chain";

const RPC_URL = "https://soroban-testnet.stellar.org";

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

export async function submitSignedXdr(signedXdr: string) {
  const server = new rpc.Server(RPC_URL);
  const tx = TransactionBuilder.fromXDR(signedXdr, d.network_passphrase);
  const sent = await server.sendTransaction(tx);
  if (sent.status === "ERROR") {
    return { ok: false, status: sent.status, hash: sent.hash, error: JSON.stringify(sent.errorResult ?? {}) };
  }
  // poll
  let got = await server.getTransaction(sent.hash);
  const deadline = Date.now() + 30_000;
  while (got.status === "NOT_FOUND" && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 1500));
    got = await server.getTransaction(sent.hash);
  }
  return { ok: got.status === "SUCCESS", status: got.status, hash: sent.hash };
}
