import { bySlug, ROSTER } from './roster.js';
import { runAgent } from './agent.js';

const slug = process.argv[2];
const def = slug ? bySlug(slug) : undefined;
if (!def) { console.error(`Usage: tsx src/index.ts <${ROSTER.map((a) => a.slug).join('|')}>`); process.exit(1); }
await runAgent(def);
