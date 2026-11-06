import { describe, expect, it } from 'vitest';
import { askForQuote, quoteAnswer, type Fetcher } from './agentClient.js';

const reply = (status: number, body: string): Fetcher => async () => ({ status, ok: status >= 200 && status < 300, text: body });

describe('quote answer validation', () => {
  it('accepts a digit string price', () => expect(quoteAnswer.safeParse({ priceTinybar: '150000000', etaHours: 2 }).success).toBe(true));
  it.each([{ priceTinybar: 150 }, { priceTinybar: '1.5' }, { priceTinybar: '-5' }, { priceTinybar: '' }, {}, { priceTinybar: '5', etaHours: 0 }, { priceTinybar: '5', etaHours: 1.5 }])(
    'rejects %j', (v) => expect(quoteAnswer.safeParse(v).success).toBe(false));
});

describe('askForQuote', () => {
  it('returns a valid answer', async () => {
    expect(await askForQuote('http://a.example', 'do x', reply(200, '{"priceTinybar":"42","etaHours":3}'))).toEqual({ priceTinybar: '42', etaHours: 3 });
  });
  it('sends only the requirements body to /quote', async () => {
    let seen: { url: string; body: string } | undefined;
    await askForQuote('http://a.example/', 'do x', async (url, init) => { seen = { url, body: init.body }; return { status: 200, ok: true, text: '{"priceTinybar":"1"}' }; });
    expect(seen).toEqual({ url: 'http://a.example/quote', body: '{"requirements":"do x"}' });
  });
  it('returns null for non-2xx, bad JSON, bad shape and network errors', async () => {
    expect(await askForQuote('http://a.example', 'x', reply(500, '{}'))).toBeNull();
    expect(await askForQuote('http://a.example', 'x', reply(200, 'not json'))).toBeNull();
    expect(await askForQuote('http://a.example', 'x', reply(200, '{"priceTinybar":12}'))).toBeNull();
    expect(await askForQuote('http://a.example', 'x', async () => { throw new Error('ECONNREFUSED'); })).toBeNull();
  });
});
