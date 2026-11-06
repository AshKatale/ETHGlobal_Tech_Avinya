import OpenAI from 'openai';
import { config } from './config.js';

let client: OpenAI | null = null;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** One NVIDIA chat completion (a single prompt). Retries transient failures; throws rather than invent output. */
export async function ask(system: string, user: string): Promise<string> {
  if (!config.nvidiaKey) throw new Error('NVIDIA_API_KEY is not set');
  client ??= new OpenAI({ baseURL: config.nvidiaBaseUrl, apiKey: config.nvidiaKey, timeout: 150_000 });
  let last = 'unknown';
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await client.chat.completions.create({
        model: config.nvidiaModel,
        messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
        temperature: 0.2, top_p: 0.95, max_tokens: 6000,
        ...({ chat_template_kwargs: { enable_thinking: false } } as object),
      });
      const text = res.choices[0]?.message?.content?.trim();
      if (text) return text;
      last = 'empty answer';
    } catch (e) { last = (e as Error).message; }
    await sleep(1500 * (attempt + 1));
  }
  throw new Error(`model unavailable: ${last}`);
}
