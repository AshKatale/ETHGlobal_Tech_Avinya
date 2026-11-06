import { HASHSCAN } from './config';

/** EVM tx hash (0x...) or a Hedera transaction id (0.0.x@secs.nanos) -> a HashScan transaction URL. */
export function txUrl(id: string): string {
  if (id.startsWith('0x')) return `${HASHSCAN}/transaction/${id}`;
  // HashScan writes the id as 0.0.x-secs-nanos
  return `${HASHSCAN}/transaction/${id.replace('@', '-').replace(/\.(\d+)\.(\d+)$/, '-$1-$2')}`;
}
export const contractUrl = (addr: string) => `${HASHSCAN}/contract/${addr}`;
export const accountUrl = (id: string) => `${HASHSCAN}/account/${id}`;
export const shortTx = (id: string) => (id.length > 22 ? `${id.slice(0, 10)}…${id.slice(-6)}` : id);
