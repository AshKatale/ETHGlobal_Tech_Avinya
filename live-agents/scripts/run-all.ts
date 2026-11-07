// Starts the five agents, each as its own server process.
import { spawn } from 'node:child_process';
import { ROSTER } from '../src/roster.js';

const children = ROSTER.map((a) => {
  const c = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts', a.slug], { stdio: ['ignore', 'pipe', 'pipe'] });
  const tag = `[${a.slug}] `;
  const pipe = (s: NodeJS.ReadableStream, out: NodeJS.WriteStream) => s.on('data', (d: Buffer) => out.write(d.toString().split('\n').filter((l) => l && !l.startsWith('{"level":30')).map((l) => tag + l).join('\n') + '\n'));
  pipe(c.stdout!, process.stdout); pipe(c.stderr!, process.stderr);
  c.on('exit', (code) => console.log(`${tag}exited (${code})`));
  return c;
});
const stop = () => { children.forEach((c) => c.kill()); process.exit(0); };
process.on('SIGINT', stop); process.on('SIGTERM', stop);
