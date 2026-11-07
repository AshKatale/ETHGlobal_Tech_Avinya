import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** Written by the backend seed script. Holds secrets: gitignored. */
export type Registered = { agentId: string; apiKey: string; accountId: string; payoutKey: string };
const FILE = fileURLToPath(new URL('../agents.json', import.meta.url));

export const loadState = (): Record<string, Registered> => (existsSync(FILE) ? JSON.parse(readFileSync(FILE, 'utf8')) : {});
