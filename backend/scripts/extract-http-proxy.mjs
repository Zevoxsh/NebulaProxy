#!/usr/bin/env node
/**
 * Splits httpProxy.js into focused sub-modules.
 * Same mixin pattern as database.js → repositories.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC  = path.join(__dirname, '..', 'services', 'proxy', 'httpProxy.js');
const DEST = path.join(__dirname, '..', 'services', 'proxy', 'http');

fs.mkdirSync(DEST, { recursive: true });

const lines = fs.readFileSync(SRC, 'utf8').split('\n');

// ── Section boundaries (1-based, inclusive) ──────────────────────────────────
// Keep in httpProxy.js: lines 1-206  (server startup: _startHttpProxy + shared servers)
// Extract rest:
const SECTIONS = [
  { file: 'sniHandler.js',       className: 'SniHandler',       start: 207,  end: 370  },
  { file: 'acmeHandler.js',      className: 'AcmeHandler',      start: 371,  end: 421  },
  { file: 'requestProxy.js',     className: 'RequestProxy',     start: 422,  end: 1563 },
  { file: 'webSocketHandler.js', className: 'WebSocketHandler', start: 1564, end: 1613 },
  { file: 'domainLookup.js',     className: 'DomainLookup',     start: 1614, end: 1676 },
];

// Context helpers used in each section
const CONTEXT = {
  lts:        /\blts\(\)/,
  getDdos:    /\bgetDdos\(\)/,
  escapeHtml: /\bescapeHtml\(/,
};

for (const s of SECTIONS) {
  const extracted = lines.slice(s.start - 1, s.end);
  // Unindent 2-space class body
  const body = extracted.map(l => l.startsWith('  ') ? l.slice(2) : l).join('\n');

  const needed = Object.entries(CONTEXT).filter(([, re]) => re.test(body)).map(([k]) => k);
  const ctxImport = needed.length
    ? `import { ${needed.join(', ')} } from '../proxyContext.js';\n`
    : '';

  const content = [
    '// Auto-extracted from httpProxy.js — do not edit directly.',
    '// Mixed into HttpProxy.prototype in httpProxy.js.',
    '',
    ctxImport,
    `export class ${s.className} {`,
    body,
    '}',
    '',
  ].join('\n');

  fs.writeFileSync(path.join(DEST, s.file), content, 'utf8');
  console.log(`  ✓  http/${s.file.padEnd(24)} ${extracted.length} lines → ${s.className}`);
}

// ── Rebuild httpProxy.js ──────────────────────────────────────────────────────
// Keep lines 1-206 (imports + HttpProxy class server startup methods)
const header  = lines.slice(0, 206).join('\n');
// closing brace of the class is somewhere after line 1677 — the original file ends with }
const classEnd = lines.slice(1677).findIndex(l => l.trim() === '}');
const tail     = lines.slice(1677, 1677 + classEnd + 1).join('\n'); // any remaining content before class close

const moduleImports = SECTIONS.map(s =>
  `import { ${s.className} } from './http/${s.file}';`
).join('\n');

const mixinCode = [
  `const _httpModules = [${SECTIONS.map(s => s.className).join(', ')}];`,
  'for (const Mod of _httpModules) {',
  "  Object.getOwnPropertyNames(Mod.prototype)",
  "    .filter(n => n !== 'constructor')",
  "    .forEach(n => { HttpProxy.prototype[n] = Mod.prototype[n]; });",
  '}',
].join('\n');

// The original file ends with `}` (class close) at some point after line 1677
// We'll find the last `}` line
const lastBrace = lines.lastIndexOf('}');
const exportLine = lines.slice(lastBrace + 1).join('\n').trim();

const newContent = [
  header,
  '}',        // close HttpProxy class
  '',
  moduleImports,
  '',
  mixinCode,
  '',
].join('\n');

fs.writeFileSync(SRC, newContent, 'utf8');
console.log('\n  ✓  httpProxy.js rewritten as thin orchestrator');

// Syntax check
const { execSync } = await import('child_process');
let allOk = true;
for (const f of [SRC, ...SECTIONS.map(s => path.join(DEST, s.file))]) {
  try { execSync(`node --check "${f}"`, { stdio: 'pipe' }); }
  catch (e) { console.error(`  ✗  ${path.basename(f)}: ${e.stderr.toString().split('\n')[0]}`); allOk = false; }
}
if (allOk) console.log('\nAll syntax checks passed ✓');
