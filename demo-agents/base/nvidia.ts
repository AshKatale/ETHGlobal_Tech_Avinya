import OpenAI from 'openai';
import type { ZodType } from 'zod';
import { config } from './config.js';

export class NvidiaError extends Error {}

let client: OpenAI | null = null;
function getClient() {
  if (!config.nvidiaKey) throw new NvidiaError('NVIDIA_API_KEY is not set');
  client ??= new OpenAI({ baseURL: config.nvidiaBaseUrl, apiKey: config.nvidiaKey });
  return client;
}

/** First balanced JSON object in a model answer (handles ```json fences and chatter). */
export function extractJson(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const candidates = fenced ? [fenced[1], text] : [text];
  let lastErr: unknown = new Error('no JSON object in model output');
  for (const c of candidates) {
    for (let start = c.indexOf('{'); start !== -1; start = c.indexOf('{', start + 1)) {
      let depth = 0, inStr = false, esc = false;
      for (let i = start; i < c.length; i++) {
        const ch = c[i];
        if (inStr) {
          if (esc) esc = false;
          else if (ch === '\\') esc = true;
          else if (ch === '"') inStr = false;
        } else if (ch === '"') inStr = true;
        else if (ch === '{') depth++;
        else if (ch === '}' && --depth === 0) {
          try { return JSON.parse(c.slice(start, i + 1)); } catch (e) { lastErr = e; }
          break;
        }
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('no JSON object in model output');
}

/** Ask the model for JSON, validate with Zod, retry up to 3 times. Never returns invented output. */
export async function askJson<T>(system: string, user: string, schema: ZodType<T>): Promise<T> {
  const c = getClient();
  let lastErr = 'unknown';
  for (let attempt = 0; attempt < 3; attempt++) {
    let content = '';
    try {
      const res = await c.chat.completions.create({
        model: config.nvidiaModel,
        messages: [
          { role: 'system', content: `${system}\n\nRespond with a single JSON object only. No prose outside the JSON.` },
          { role: 'user', content: attempt === 0 ? user : `${user}\n\nYour previous answer was invalid (${lastErr}). Return valid JSON only.` },
        ],
        temperature: 0.2,
        top_p: 0.95,
        max_tokens: 8192,
        seed: 42,
        ...({ chat_template_kwargs: { enable_thinking: false } } as object),
      });
      content = res.choices[0]?.message?.content ?? '';
    } catch (e) {
      throw new NvidiaError(`NVIDIA request failed: ${(e as Error).message}`);
    }
    try {
      return schema.parse(extractJson(content));
    } catch (e) {
      lastErr = (e as Error).message.slice(0, 200);
    }
  }
  throw new NvidiaError(`NVIDIA returned invalid JSON 3 times: ${lastErr}`);
}
