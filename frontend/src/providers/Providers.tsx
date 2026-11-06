'use client';
import { useState, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WagmiProvider } from 'wagmi';
import { wagmiConfig } from '@/lib/wagmi';
import { ToastProvider } from './Toasts';
import { SessionProvider } from './Session';
import ConnectModal from '@/components/ConnectModal';

export default function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } } }));
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={client}>
        <ToastProvider>
          <SessionProvider>
            {children}
            <ConnectModal />
          </SessionProvider>
        </ToastProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
