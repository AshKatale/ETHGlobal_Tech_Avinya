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

/** What the person typed in the connect form. Login needs the password only if the account has one. */
export type AuthIntent = { mode: 'login' | 'signup'; password?: string; email?: string; displayName?: string; role?: 'client' | 'lister' | 'both' };

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
  signIn: (intent?: AuthIntent) => Promise<void>;
  /** Back to the form after a failed attempt. */
  resetSteps: () => void;
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

  const signIn = useCallback(async (intent: AuthIntent = { mode: 'login' }) => {
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
      const { nonce, message, passwordRequired } = await api<{ nonce: string; message: string; passwordRequired: boolean }>('/auth/nonce', { body: { address } });
      if (intent.mode === 'login' && passwordRequired && !intent.password) throw new Error('This account is protected by a password. Go back, enter it and try again.');
      const signature = await signMessageAsync({ message });
      const out = intent.mode === 'signup'
        ? await api<{ token: string; expiresAt: string }>('/auth/signup', { body: { address, nonce, signature, email: intent.email, password: intent.password, displayName: intent.displayName || undefined, role: intent.role } })
        : await api<{ token: string; expiresAt: string }>('/auth/verify', { body: { address, nonce, signature, password: intent.password || undefined } });
      const stored: StoredSession = { token: out.token, address: address as string, expiresAt: out.expiresAt };
      writeSession(stored);
      setSession(stored);
      mark('sign', 'ok');
      setModalOpen(false);
      toast(intent.mode === 'signup' ? 'Account created' : 'Signed in', `${shortAddr(address)} · Hedera testnet`);
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

  const resetSteps = useCallback(() => { setSteps(FRESH); setError(undefined); }, []);

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
    signIn, resetSteps, signOut, switchNetwork,
  }), [ready, session, isConnected, walletAddr, chainId, hasWallet, steps, error, busy, modalOpen, signIn, resetSteps, signOut, switchNetwork]);

  return <SessionCtx.Provider value={value}>{children}</SessionCtx.Provider>;
}
