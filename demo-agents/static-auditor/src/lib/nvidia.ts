import { z } from 'zod';
import { config } from './config.js';

export class NvidiaError extends Error {}

/** JSON.parse, but first escape raw newlines/tabs inside strings (models often emit multi-line code unescaped). */
function parseLenient(src: string): unknown {
  try { return JSON.parse(src); } catch { /* repair below */ }
  // Repair: escape raw control chars in strings, and treat a quote as closing only when the next
  // non-space char is , } ] or : (so unescaped quotes inside code such as ("") get escaped).
  let out = '', inStr = false, esc = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (!inStr) { if (c === '"') inStr = true; out += c; continue; }
    if (esc) { esc = false; out += c; }
    else if (c === '\\') { esc = true; out += c; }
    else if (c === '"') {
      const next = src.slice(i + 1).match(/\S/)?.[0];
      if (next === undefined || ',}]:'.includes(next)) { inStr = false; out += c; } else out += '\\"';
    }
    else if (c === '\n') out += '\\n';
    else if (c === '\r') out += '\\r';
    else if (c === '\t') out += '\\t';
    else out += c;
  }
  return JSON.parse(out);
}

/** Pull the first balanced JSON object out of a model reply (tolerates code fences and prose). */
export function extractJson(text: string): unknown {
  const start = text.indexOf('{');
  if (start < 0) throw new NvidiaError('Model reply contained no JSON object');
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return parseLenient(text.slice(start, i + 1));
  }
  throw new NvidiaError('Model reply had unbalanced JSON');
}

async function chat(system: string, user: string): Promise<string> {
  if (!config.nvidia.apiKey) throw new NvidiaError('NVIDIA_API_KEY is not set; refusing to fake a result');
  const res = await fetch(`${config.nvidia.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${config.nvidia.apiKey}` },
    body: JSON.stringify({
      model: config.nvidia.model,
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      temperature: 0.2,
      max_tokens: 4096,
      stream: false,
      chat_template_kwargs: { enable_thinking: false }, // thinking off (extra body field)
    }),
    signal: AbortSignal.timeout(100_000),
  });
  const text = await res.text();
  if (!res.ok) throw new NvidiaError(`NVIDIA API ${res.status}: ${text.slice(0, 300)}`);
  const content = (JSON.parse(text) as { choices?: { message?: { content?: string } }[] }).choices?.[0]?.message?.content;
  if (!content) throw new NvidiaError('NVIDIA API returned no content');
  return content;
}

/** Ask for JSON only, validate with Zod, retry once on invalid output. Throws NvidiaError; never fabricates. */
export async function askJson<S extends z.ZodTypeAny>(schema: S, system: string, user: string): Promise<z.infer<S>> {
  const sys = `${system}\n\nReply with a single JSON object and nothing else. No markdown fences, no commentary.`;
  let lastErr: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const raw = await chat(sys, attempt === 0 ? user : `${user}\n\nYour previous reply was not valid. Return ONLY the JSON object.`);
      return schema.parse(extractJson(raw));
    } catch (e) {
      lastErr = e;
      if (e instanceof NvidiaError && /NVIDIA_API_KEY|NVIDIA API 40[13]/.test(e.message)) break; // not retryable
    }
  }
  throw new NvidiaError(`NVIDIA call failed: ${(lastErr as Error).message}`);
}
