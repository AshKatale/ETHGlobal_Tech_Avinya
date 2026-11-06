// Reads NVIDIA_* from backend/.env. Never prints key values.
import { createRequire } from 'node:module';
const require = createRequire(new URL('../backend/package.json', import.meta.url));
require('dotenv').config({ path: new URL('../backend/.env', import.meta.url).pathname });
const OpenAI = require('openai').default ?? require('openai');
const c = new OpenAI({ apiKey: process.env.NVIDIA_API_KEY, baseURL: process.env.NVIDIA_BASE_URL });
const model = process.env.NVIDIA_MODEL;
async function run(label, extra, pad = 0) {
  const filler = pad ? 'x '.repeat(pad / 2) : '';
  const t = Date.now();
  try {
    const r = await c.chat.completions.create({
      model, temperature: 0.2, max_tokens: 200,
      messages: [{ role: 'system', content: 'Respond with a single JSON object only.' },
        { role: 'user', content: `Return {"ok":true,"n":3}. ${filler}` }],
      ...extra,
    });
    const m = r.choices[0]?.message;
    console.log(label, 'ms=', Date.now() - t, 'content=', JSON.stringify((m?.content ?? '').slice(0, 120)),
      'reasoning?', !!(m?.reasoning_content || m?.reasoning), 'usage=', JSON.stringify(r.usage));
  } catch (e) { console.log(label, 'ERR', e.status, String(e.message).slice(0, 200), 'ms=', Date.now() - t); }
}
const which = process.argv[2] ?? 'basic';
if (which === 'basic') {
  await run('plain', {});
  await run('kwargs_off', { chat_template_kwargs: { enable_thinking: false } });
  await run('json_mode', { response_format: { type: 'json_object' } });
}
if (which === 'big') await run('100KB_kwargs_off', { chat_template_kwargs: { enable_thinking: false } }, 100000);
