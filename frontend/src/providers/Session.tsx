'use client';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useAccount, useConnect, useDisconnect, useSignMessage, useSwitchChain } from 'wagmi';
import { api, readSession, writeSession, type StoredSession } from '@/lib/api';
import { CHAIN_ID } from '@/lib/config';
import { errMessage, shortAddr } from '@/lib/format';
import { useToast } from './Toasts';

export type StepKey = 'connect' | 'network' | 'sign';
export type StepState = 'wait' | 'run' | 'ok' | 'bad';
const FRESH: Record<StepKey, StepState> = { connect: 'wait', network: 'wait', sign: 'wait' };

type Ctx = {
  ready: boolean;
  signedIn: boolean;
  address?: `0x${string}`;
  /** The wallet is connected and is the same account that signed in. Required before sending a transaction. */
  walletReady: boolean;
  wrongNetwork: boolean;
  hasWallet: boolean;
  steps: Record<StepKey, StepState>;
  error?: string;
  busy: boolean;
  modalOpen: boolean;
  openConnect: () => void;
  closeConnect: () => void;
  signIn: () => Promise<void>;
  signOut: () => void;
  switchNetwork: () => Promise<void>;
};

const SessionCtx = createContext<Ctx | null>(null);
export const useSession = () => {
  const c = useContext(SessionCtx);
  if (!c) throw new Error('useSession must be used inside SessionProvider');
  return c;
};

export function SessionProvider({ children }: { children: ReactNode }) {
  const { address: walletAddr, isConnected, chainId } = useAccount();
  const { connectors, connectAsync } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChainAsync } = useSwitchChain();
  const { signMessageAsync } = useSignMessage();
  const { toast } = useToast();

  const [session, setSession] = useState<StoredSession | null>(null);
  const [ready, setReady] = useState(false);
  const [hasWallet, setHasWallet] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [steps, setSteps] = useState(FRESH);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setSession(readSession());
    setHasWallet(!!(window as unknown as { ethereum?: unknown }).ethereum);
    setReady(true);
  }, []);

  // The API said the session is no longer valid.
  useEffect(() => {
    const onExpired = () => { setSession(null); toast('Session expired', 'Connect your wallet again to continue', 'info'); };
    window.addEventListener('gv:session-expired', onExpired);
    return () => window.removeEventListener('gv:session-expired', onExpired);
  }, [toast]);

  // The user switched accounts in the wallet: the old session no longer belongs to the connected account.
  useEffect(() => {
    if (session && isConnected && walletAddr && walletAddr.toLowerCase() !== session.address.toLowerCase()) {
      writeSession(null);
      setSession(null);
      toast('Wallet account changed', `Sign in again with ${shortAddr(walletAddr)}`, 'info');
    }
  }, [session, isConnected, walletAddr, toast]);

  const mark = (k: StepKey, v: StepState) => setSteps((s) => ({ ...s, [k]: v }));

  const signIn = useCallback(async () => {
    setBusy(true);
    setError(undefined);
    setSteps({ ...FRESH, connect: 'run' });
    let current: StepKey = 'connect';
    try {
      if (!(window as unknown as { ethereum?: unknown }).ethereum) throw new Error('No browser wallet found. Install MetaMask, then try again.');

      // 1. connect the wallet
      let address = walletAddr;
      let chain = chainId;
      if (!isConnected || !address) {
        const r = await connectAsync({ connector: connectors[0] });
        address = r.accounts[0];
        chain = r.chainId;
      }
      mark('connect', 'ok');

      // 2. be on Hedera testnet (the wallet adds the network if it does not know it)
      current = 'network';
      mark('network', 'run');
      if (chain !== CHAIN_ID) await switchChainAsync({ chainId: CHAIN_ID });
      mark('network', 'ok');

      // 3. prove ownership of the account: sign a one-time message, no transaction
      current = 'sign';
      mark('sign', 'run');
      const { nonce, message } = await api<{ nonce: string; message: string }>('/auth/nonce', { body: { address } });
      const signature = await signMessageAsync({ message });
      const out = await api<{ token: string; expiresAt: string }>('/auth/verify', { body: { address, nonce, signature } });
      const stored: StoredSession = { token: out.token, address: address as string, expiresAt: out.expiresAt };
      writeSession(stored);
      setSession(stored);
      mark('sign', 'ok');
      setModalOpen(false);
      toast('Wallet connected', `${shortAddr(address)} · Hedera testnet`);
    } catch (e) {
      mark(current, 'bad');
      setError(errMessage(e));
    } finally {
      setBusy(false);
    }
  }, [walletAddr, isConnected, chainId, connectors, connectAsync, switchChainAsync, signMessageAsync, toast]);

  const signOut = useCallback(() => {
    writeSession(null);
    setSession(null);
    disconnect();
    toast('Wallet disconnected', '', 'info');
  }, [disconnect, toast]);

  const switchNetwork = useCallback(async () => {
    try { await switchChainAsync({ chainId: CHAIN_ID }); } catch (e) { toast('Could not switch network', errMessage(e), 'bad'); }
  }, [switchChainAsync, toast]);

  const value = useMemo<Ctx>(() => ({
    ready,
    signedIn: !!session,
    address: session?.address as `0x${string}` | undefined,
    walletReady: !!session && isConnected && !!walletAddr && walletAddr.toLowerCase() === session.address.toLowerCase(),
    wrongNetwork: isConnected && chainId !== CHAIN_ID,
    hasWallet, steps, error, busy, modalOpen,
    openConnect: () => { setError(undefined); setSteps(FRESH); setModalOpen(true); },
    closeConnect: () => setModalOpen(false),
    signIn, signOut, switchNetwork,
  }), [ready, session, isConnected, walletAddr, chainId, hasWallet, steps, error, busy, modalOpen, signIn, signOut, switchNetwork]);

  return <SessionCtx.Provider value={value}>{children}</SessionCtx.Provider>;
}
