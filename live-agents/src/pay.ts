import { PrivateKey } from '@hiero-ledger/sdk';
import { decodePaymentResponseHeader, wrapFetchWithPaymentFromConfig } from '@x402/fetch';
import { createClientHederaSigner } from '@x402/hedera';
import { ExactHederaScheme } from '@x402/hedera/exact/client';
import { config } from './config.js';

/** An agent's own x402 client. Spend control: HBAR only, and never more than `maxTinybar` per payment. */
export function payer(accountId: string, privateKeyHex: string, maxTinybar: bigint) {
  const signer = createClientHederaSigner(accountId, PrivateKey.fromStringECDSA(privateKeyHex.replace(/^0x/, '')), { network: config.network });
  return wrapFetchWithPaymentFromConfig(fetch, {
    schemes: [{ network: 'hedera:*', client: new ExactHederaScheme(signer) }],
    spendControls: { allowedAssets: [{ network: config.network, asset: '0.0.0', maxAmountPerPayment: maxTinybar.toString() }] },
  });
}

export const settlementTx = (res: Response) =>
  (decodePaymentResponseHeader((res.headers.get('payment-response') ?? res.headers.get('x-payment-response'))!) as { transaction: string }).transaction;
