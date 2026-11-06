import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { NextConfig } from 'next';

const config: NextConfig = {
  reactStrictMode: true,
  // The repo root has its own lockfile; tell Next this folder is the project root.
  turbopack: { root: path.dirname(fileURLToPath(import.meta.url)) },
  // Do not generate an AGENTS.md file inside the app.
  agentRules: false,
};

export default config;
