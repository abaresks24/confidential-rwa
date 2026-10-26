"use client";
import { useCallback, useState } from "react";
import {
  isConnected,
  requestAccess,
  getAddress,
  signTransaction,
} from "@stellar/freighter-api";

export type Wallet = {
  address: string | null;
  installed: boolean | null;
  connecting: boolean;
  error: string | null;
};

export function useFreighter() {
  const [w, setW] = useState<Wallet>({
    address: null,
    installed: null,
    connecting: false,
    error: null,
  });

  const connect = useCallback(async () => {
    setW((s) => ({ ...s, connecting: true, error: null }));
    try {
      const conn = await isConnected();
      if (!conn.isConnected) {
        setW((s) => ({ ...s, installed: false, connecting: false, error: "Freighter extension not detected." }));
        return;
      }
      const access = await requestAccess();
      if (access.error) throw new Error(access.error);
      const addr = access.address || (await getAddress()).address;
      setW({ address: addr, installed: true, connecting: false, error: null });
    } catch (e) {
      setW((s) => ({ ...s, connecting: false, error: String((e as Error)?.message || e) }));
    }
  }, []);

  const sign = useCallback(
    async (xdr: string, networkPassphrase: string) => {
      const res = await signTransaction(xdr, { networkPassphrase });
      if (res.error) throw new Error(res.error);
      return res.signedTxXdr;
    },
    []
  );

  return { wallet: w, connect, sign };
}
