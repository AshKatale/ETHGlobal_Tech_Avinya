import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Indexer, MemData } from '@0gfoundation/0g-storage-ts-sdk';
import { ethers } from 'ethers';
import { env } from '../env.js';

export class StorageError extends Error {}

/** Upload a JSON object to 0G Storage. Returns the Merkle root hash (the only handle to fetch it). */
export async function uploadJson(obj: unknown): Promise<string> {
  if (!env.BACKEND_0G_PRIVATE_KEY) throw new StorageError('BACKEND_0G_PRIVATE_KEY is not set');
  const provider = new ethers.JsonRpcProvider(env.ZEROG_RPC_URL);
  const signer = new ethers.Wallet(env.BACKEND_0G_PRIVATE_KEY, provider);
  const indexer = new Indexer(env.ZEROG_INDEXER_RPC);

  const data = new MemData(new TextEncoder().encode(JSON.stringify(obj)));
  const [, treeErr] = await data.merkleTree(); // must be called before upload
  if (treeErr !== null) throw new StorageError(`merkle tree: ${String(treeErr)}`);

  const [tx, err] = await indexer.upload(data, env.ZEROG_RPC_URL, signer);
  if (err !== null) throw new StorageError(`upload: ${String(err)}`);
  if ('rootHash' in tx) return tx.rootHash;
  return tx.rootHashes[0]; // fragmented (>4GB) uploads never happen for JSON reports
}

/** Download a JSON object by root hash, verifying the Merkle proof. */
export async function downloadJson<T = unknown>(rootHash: string): Promise<T> {
  const indexer = new Indexer(env.ZEROG_INDEXER_RPC);
  const dir = await mkdtemp(join(tmpdir(), 'zg-'));
  const path = join(dir, 'out.json');
  try {
    const err = await indexer.download(rootHash, path, true);
    if (err !== null) throw new StorageError(`download: ${String(err)}`);
    return JSON.parse(await readFile(path, 'utf8')) as T;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
