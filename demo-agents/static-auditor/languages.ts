// Language detection and comment stripping for the Static Auditor.
// Comments are removed before the code reaches the model: they are the easiest place to hide instructions
// aimed at the reviewer, and they are not needed to find vulnerabilities.

export type CommentStyle = 'c' | 'hash' | 'sql' | 'html' | 'none';

type Lang = { id: string; style: CommentStyle };

const LANGS: Record<string, Lang> = {
  solidity: { id: 'solidity', style: 'c' },
  vyper: { id: 'vyper', style: 'hash' },
  javascript: { id: 'javascript', style: 'c' },
  typescript: { id: 'typescript', style: 'c' },
  python: { id: 'python', style: 'hash' },
  go: { id: 'go', style: 'c' },
  rust: { id: 'rust', style: 'c' },
  java: { id: 'java', style: 'c' },
  kotlin: { id: 'kotlin', style: 'c' },
  swift: { id: 'swift', style: 'c' },
  csharp: { id: 'csharp', style: 'c' },
  c: { id: 'c', style: 'c' },
  cpp: { id: 'cpp', style: 'c' },
  php: { id: 'php', style: 'c' },
  ruby: { id: 'ruby', style: 'hash' },
  shell: { id: 'shell', style: 'hash' },
  yaml: { id: 'yaml', style: 'hash' },
  toml: { id: 'toml', style: 'hash' },
  dockerfile: { id: 'dockerfile', style: 'hash' },
  sql: { id: 'sql', style: 'sql' },
  html: { id: 'html', style: 'html' },
  json: { id: 'json', style: 'none' },
  unknown: { id: 'unknown', style: 'none' },
};

const ALIASES: Record<string, string> = {
  sol: 'solidity', vy: 'vyper', js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
  ts: 'typescript', tsx: 'typescript', py: 'python', golang: 'go', rs: 'rust', kt: 'kotlin',
  cs: 'csharp', 'c#': 'csharp', h: 'c', cc: 'cpp', cxx: 'cpp', hpp: 'cpp', 'c++': 'cpp', rb: 'ruby',
  sh: 'shell', bash: 'shell', zsh: 'shell', yml: 'yaml', htm: 'html', node: 'javascript',
};

function normalize(name: string): string | null {
  const k = name.trim().toLowerCase().replace(/^\./, '');
  const id = ALIASES[k] ?? k;
  return LANGS[id] ? id : null;
}

/** Language from a hint ("python", "js"), a filename extension, or the code itself. Falls back to "unknown". */
export function detectLanguage(opts: { hint?: string; filename?: string; code: string }): string {
  if (opts.hint) { const h = normalize(opts.hint); if (h) return h; }
  if (opts.filename) {
    const base = opts.filename.split(/[\\/]/).pop() ?? '';
    if (/^dockerfile/i.test(base)) return 'dockerfile';
    const ext = base.includes('.') ? base.split('.').pop()! : '';
    const e = ext ? normalize(ext) : null;
    if (e) return e;
  }
  const c = opts.code;
  if (/pragma\s+solidity|^\s*(contract|library|interface)\s+\w+[^;{]*\{/m.test(c)) return 'solidity';
  if (/<\?php/.test(c)) return 'php';
  if (/^\s*package\s+\w+\s*$/m.test(c) && /\bfunc\s+\w*\(/.test(c)) return 'go';
  if (/\bfn\s+\w+\s*[(<]|\blet\s+mut\b|\buse\s+std::/.test(c)) return 'rust';
  if (/^\s*#include\s*[<"]/m.test(c)) return /\b(class|namespace|std::|template\s*<)/.test(c) ? 'cpp' : 'c';
  if (/\bSystem\.out\.print|\bpublic\s+(static\s+)?(class|void)\b/.test(c)) return 'java';
  if (/^\s*(def\s+\w+\(|from\s+[\w.]+\s+import\s|import\s+[\w.]+\s*$)/m.test(c) && !/[;{]\s*$/m.test(c.split('\n').slice(0, 5).join('\n'))) return 'python';
  if (/\b(const|let|var)\s+\w+\s*=|=>|require\(|module\.exports|\bimport\s+.*\sfrom\s+['"]/.test(c)) {
    return /:\s*(string|number|boolean)\b|\binterface\s+\w+\s*\{/.test(c) ? 'typescript' : 'javascript';
  }
  if (/^#!.*\b(ba|z)?sh\b/.test(c)) return 'shell';
  if (/\b(SELECT|INSERT|UPDATE|DELETE)\b[\s\S]*\b(FROM|INTO|SET)\b/i.test(c)) return 'sql';
  return 'unknown';
}

const NL = String.fromCharCode(10);
const BS = String.fromCharCode(92);

/** Copy a quoted literal starting at i (code[i] is the quote). Returns the new index. Honours backslash escapes. */
function copyString(code: string, i: number, out: string[], multiline: boolean): number {
  const q = code[i];
  out.push(q);
  i++;
  while (i < code.length && code[i] !== q && (multiline || code[i] !== NL)) {
    if (code[i] === BS) out.push(code[i++]);
    if (i < code.length) out.push(code[i++]);
  }
  if (i < code.length && code[i] === q) out.push(code[i++]);
  return i;
}

/** Remove comments using the given comment syntax. String literals are kept intact. Line breaks are preserved. */
export function stripComments(code: string, style: CommentStyle): string {
  if (style === 'none') return code;
  const out: string[] = [];
  let i = 0;
  while (i < code.length) {
    const c = code[i], n = code[i + 1];

    if (style === 'c') {
      if (c === '"' || c === "'") { i = copyString(code, i, out, false); continue; }
      if (c === '`') { i = copyString(code, i, out, true); continue; } // JS/Go template or raw string
      if (c === '/' && n === '/') { while (i < code.length && code[i] !== NL) i++; continue; }
      if (c === '/' && n === '*') {
        i += 2;
        while (i < code.length && !(code[i] === '*' && code[i + 1] === '/')) { if (code[i] === NL) out.push(NL); i++; }
        i += 2;
        continue;
      }
    } else if (style === 'hash') {
      const tri = code.startsWith('"""', i) ? '"""' : code.startsWith("'''", i) ? "'''" : null;
      if (tri) { // Python-style triple-quoted string: keep as is (it can be code or data)
        const end = code.indexOf(tri, i + 3);
        const stop = end === -1 ? code.length : end + 3;
        out.push(code.slice(i, stop));
        i = stop;
        continue;
      }
      if (c === '"' || c === "'") { i = copyString(code, i, out, false); continue; }
      if (c === '#') { while (i < code.length && code[i] !== NL) i++; continue; }
    } else if (style === 'sql') {
      if (c === "'") { i = copyString(code, i, out, true); continue; }
      if (c === '-' && n === '-') { while (i < code.length && code[i] !== NL) i++; continue; }
      if (c === '/' && n === '*') {
        i += 2;
        while (i < code.length && !(code[i] === '*' && code[i + 1] === '/')) { if (code[i] === NL) out.push(NL); i++; }
        i += 2;
        continue;
      }
    } else if (style === 'html') {
      if (code.startsWith('<!--', i)) {
        const end = code.indexOf('-->', i + 4);
        const stop = end === -1 ? code.length : end + 3;
        for (let k = i; k < stop; k++) if (code[k] === NL) out.push(NL);
        i = stop;
        continue;
      }
    }
    out.push(c);
    i++;
  }
  return out.join('');
}

export function commentStyleFor(language: string): CommentStyle {
  return (LANGS[language] ?? LANGS.unknown).style;
}
