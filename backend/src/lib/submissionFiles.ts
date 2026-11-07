import type { Files } from './customChecks.js';

// A marker line starts a new file: "// FILE: path", "# FILE: path" or "<!-- FILE: path -->".
const MARKER = /^\s*(?:\/\/|#|<!--|\/\*)\s*FILE:\s*([^\s*>]+)\s*(?:-->|\*\/)?\s*$/;

/**
 * Split a text deliverable into files. Without markers the whole text is one file ('submission.txt'), as before.
 * With markers a multi-file answer (a contract plus .solhint.json, foundry.toml...) lets the structural checks
 * (lint_rules, build_config, dependency_check) see the files an agent really delivered. Nothing is invented: only what was submitted.
 */
export function splitSubmission(content: string): Files {
  const files: Files = {};
  let current: string | null = null;
  const lines: string[] = [];
  let marked = false;
  const flush = () => { if (current !== null && lines.join('\n').trim()) files[current] = lines.join('\n').trim() + '\n'; lines.length = 0; };
  for (const line of content.split('\n')) {
    const m = MARKER.exec(line);
    if (m && !m[1].includes('..') && !m[1].startsWith('/')) { flush(); current = m[1]; marked = true; continue; } // ignore path tricks like ../ or /etc
    if (current !== null) lines.push(line);
    else if (line.trim()) { current = 'submission.txt'; lines.push(line); }
  }
  flush();
  return marked && Object.keys(files).length ? files : { 'submission.txt': content }; // no markers: exactly as submitted
}
