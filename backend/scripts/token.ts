// Prints a login token for Postman. Postman cannot sign wallet messages, so this does the nonce/sign/verify dance.
// Usage:  npm run token                      (new random wallet)
//         PRIVATE_KEY=0x... npm run token    (a specific wallet, e.g. your MetaMask test account)
// Then paste the token into the Postman collection variable `token`.
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';

const API = process.env.API_URL ?? 'http://localhost:4000';
const key = (process.env.PRIVATE_KEY ?? generatePrivateKey()) as `0x${string}`;
const account = privateKeyToAccount(key.startsWith('0x') ? key : (`0x${key}` as `0x${string}`));

const post = async (path: string, body: unknown) => {
  const res = await fetch(API + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const json = await res.json();
  if (!res.ok) throw new Error(`${path} -> ${res.status} ${JSON.stringify(json)}`);
  return json;
};

const { nonce, message } = await post('/auth/nonce', { address: account.address });
const signature = await account.signMessage({ message });
const { token, expiresAt } = await post('/auth/verify', { address: account.address, nonce, signature });

console.log(`address: ${account.address}`);
console.log(`expires: ${expiresAt}`);
console.log(`token:   ${token}`);
