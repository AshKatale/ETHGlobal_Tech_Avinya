"use client";
import { useCallback, useState, useSyncExternalStore } from "react";
import { useAccount, useChainId, useConnect, useDisconnect, useSignMessage, useSwitchChain } from "wagmi";
import { api, ApiError } from "@/lib/api";
import { hederaTestnet } from "@/lib/chain";
import { getToken, setToken, subscribeToken } from "@/lib/session";

export type StepState = "todo" | "active" | "done" | "error";

interface NonceResponse {
  nonce: string;
  message: string;
  expiresAt: string;
}
interface VerifyResponse {
  token: string;
  expiresAt: string;
  user: { id: string; address: string };
}

function walletMessage(e: unknown): string {
  const err = e as { code?: number; name?: string; shortMessage?: string; message?: string };
  if (err?.code === 4001 || err?.name === "UserRejectedRequestError" || /rejected/i.test(err?.message ?? "")) {
    return "You rejected the request in your wallet.";
  }
  return err?.shortMessage ?? err?.message ?? "Wallet error";
}

export function useWallet() {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { connectors, connectAsync } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChainAsync } = useSwitchChain();
  const { signMessageAsync } = useSignMessage();
  const token = useSyncExternalStore(subscribeToken, getToken, () => null);
  const [error, setError] = useState<{ step: "connect" | "network" | "sign"; message: string } | null>(null);
  const [busy, setBusy] = useState<"connect" | "network" | "sign" | null>(null);

  const hasWallet = typeof window !== "undefined" && "ethereum" in window;
  const onHedera = isConnected && chainId === hederaTestnet.id;
  const [sessionAddress, setSessionAddress] = useState<string | null>(null);
  const signedIn = Boolean(token);

  const connect = useCallback(async () => {
    setError(null);
    setBusy("connect");
    try {
      await connectAsync({ connector: connectors[0], chainId: hederaTestnet.id });
    } catch (e) {
      setError({ step: "connect", message: walletMessage(e) });
    } finally {
      setBusy(null);
    }
  }, [connectAsync, connectors]);

  /** Adds Hedera Testnet to the wallet if missing, then switches to it. */
  const switchNetwork = useCallback(async () => {
    setError(null);
    setBusy("network");
    try {
      await switchChainAsync({ chainId: hederaTestnet.id });
    } catch (e) {
      setError({ step: "network", message: walletMessage(e) });
    } finally {
      setBusy(null);
    }
  }, [switchChainAsync]);

  const signIn = useCallback(async () => {
    if (!address) return;
    setError(null);
    setBusy("sign");
    try {
      const addr = address.toLowerCase();
      const n = await api<NonceResponse>("/auth/nonce", { body: { address: addr } });
      const signature = await signMessageAsync({ message: n.message });
      const v = await api<VerifyResponse>("/auth/verify", { body: { address: addr, nonce: n.nonce, signature } });
      setToken(v.token);
      setSessionAddress(v.user.address);
    } catch (e) {
      if (e instanceof ApiError) {
        const message =
          e.status === 400
            ? "Sign-in expired, try again."
            : e.status === 401
              ? "Signature did not match this address."
              : e.message;
        setError({ step: "sign", message });
      } else {
        setError({ step: "sign", message: walletMessage(e) });
      }
    } finally {
      setBusy(null);
    }
  }, [address, signMessageAsync]);

  const signOut = useCallback(() => {
    setToken(null);
    setSessionAddress(null);
    disconnect();
  }, [disconnect]);

  const steps: Record<"connect" | "network" | "sign", StepState> = {
    connect: isConnected ? "done" : error?.step === "connect" ? "error" : busy === "connect" ? "active" : "todo",
    network: onHedera ? "done" : error?.step === "network" ? "error" : busy === "network" ? "active" : "todo",
    sign: signedIn ? "done" : error?.step === "sign" ? "error" : busy === "sign" ? "active" : "todo",
  };

  return {
    address,
    isConnected,
    onHedera,
    signedIn,
    token,
    sessionAddress,
    hasWallet,
    busy,
    error,
    steps,
    connect,
    switchNetwork,
    signIn,
    signOut,
  };
}
