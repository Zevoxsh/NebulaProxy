#!/usr/bin/env node
/**
 * Splits ProxyManager into per-protocol modules.
 * Module-level helpers (lts, getDdos, escapeHtml) move to proxyContext.js.
 * All modules are mixed into ProxyManager.prototype via prototype iteration.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname  = path.dirname(fileURLToPath(import.meta.url));
const PM_FILE    = path.join(__dirname, '..', 'services', 'proxyManager.js');
const MODS_DIR   = path.join(__dirname, '..', 'services', 'proxy');

fs.mkdirSync(MODS_DIR, { recursive: true });

const src   = fs.readFileSync(PM_FILE, 'utf8');
const lines = src.split('\n');

// ── Step 1: Write proxyContext.js ─────────────────────────────────────────
const contextSrc = `// Shared module-level helpers for ProxyManager modules.
// Lazy singletons are module-scoped so they remain singletons across all imports.

let _lts = null;
export const lts = () => {
  if (!_lts) {
    import('./liveTrafficService.js')
      .then(m => { _lts = m.liveTrafficService; })
      .catch(() => {});
  }
  return _lts;
};

let _ddos = null;
export const getDdos = () => {
  if (!_ddos) {
    import('./ddosProtectionService.js')
      .then(m => { _ddos = m.ddosProtectionService; })
      .catch(() => {});
  }
  return _ddos;
};

export const escapeHtml = (value) => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/\\"/g, '&quot;')
  .replace(/'/g, '&#39;');
`;
fs.writeFileSync(path.join(__dirname, '..', 'services', 'proxyContext.js'), contextSrc);
console.log('  ✓  proxyContext.js');

// ── Step 2: Define sections ───────────────────────────────────────────────
const SECTIONS = [
  { file: 'tcpProxy.js',       className: 'TcpProxy',       start: 377,  end: 640  },
  { file: 'udpProxy.js',       className: 'UdpProxy',        start: 641,  end: 860  },
  { file: 'minecraftProxy.js', className: 'MinecraftProxy',  start: 861,  end: 1313 },
  { file: 'httpProxy.js',      className: 'HttpProxy',       start: 1314, end: 2984 },
  { file: 'proxyHelpers.js',   className: 'ProxyHelpers',    start: 2985, end: 3285 },
];

// ── Step 3: Determine which sections need which context imports ───────────
const CONTEXT_PATTERNS = {
  lts:        /\blts\(\)/,
  getDdos:    /\bgetDdos\(\)/,
  escapeHtml: /\bescapeHtml\(/,
};

for (const section of SECTIONS) {
  const sectionLines = lines.slice(section.start - 1, section.end);
  const unindented   = sectionLines.map(l => l.startsWith('  ') ? l.slice(2) : l);
  while (unindented.length && unindented[unindented.length - 1].trim() === '') unindented.pop();
  const body = unindented.join('\n');

  // Detect which context helpers are needed
  const needed = Object.entries(CONTEXT_PATTERNS)
    .filter(([, re]) => re.test(body))
    .map(([name]) => name);

  const contextImport = needed.length
    ? `import { ${needed.join(', ')} } from '../proxyContext.js';\n`
    : '';

  const content = [
    '// Auto-extracted from proxyManager.js — do not edit directly.',
    '// Mixed into ProxyManager.prototype in proxyManager.js.',
    '',
    contextImport,
    `export class ${section.className} {`,
    body,
    '}',
    '',
  ].join('\n');

  fs.writeFileSync(path.join(MODS_DIR, section.file), content, 'utf8');
  const helpers = needed.length ? ` [${needed.join(',')}]` : '';
  console.log(`  ✓  proxy/${section.file.padEnd(22)} ${sectionLines.length} lines → ${section.className}${helpers}`);
}

// ── Step 4: Rebuild proxyManager.js ──────────────────────────────────────
// Infrastructure = lines 1-376 (imports + top-level + class constructor + init)
// BUT: remove the lts/getDdos/escapeHtml block (lines ~31-57) and the
//      module-level var declarations since they move to proxyContext.js

const infra = lines.slice(0, 376).join('\n')
  // Remove module-level lts/getDdos/escapeHtml definitions (they move to proxyContext.js)
  .replace(/\/\/ Lazy singleton for live traffic[\s\S]*?^};$/m, '')
  .replace(/\/\/ Lazy singleton for DDoS[\s\S]*?^};$/m, '')
  .replace(/^const escapeHtml = [\s\S]*?^};$/m, '')
  // Remove leftover blank lines at the end of the cleaned block
  .replace(/(\n\s*){3,}/g, '\n\n');

const closingLines = lines.slice(3285, lines.length).join('\n');

const moduleImports = SECTIONS.map(s =>
  `import { ${s.className} } from './proxy/${s.file}';`
).join('\n');

const contextImport = `import { lts, getDdos, escapeHtml } from './proxyContext.js';`;

const mixinCode = [
  'const _proxyModules = [',
  SECTIONS.map(s => `  ${s.className}`).join(',\n'),
  '];',
  'for (const Mod of _proxyModules) {',
  "  Object.getOwnPropertyNames(Mod.prototype)",
  "    .filter(n => n !== 'constructor')",
  "    .forEach(n => { ProxyManager.prototype[n] = Mod.prototype[n]; });",
  '}',
].join('\n');

const newPM = [
  infra,
  '}',
  '',
  moduleImports,
  contextImport,
  '',
  mixinCode,
  '',
  closingLines,
].join('\n');

fs.writeFileSync(PM_FILE, newPM, 'utf8');
console.log('\n  ✓  proxyManager.js rewritten as thin orchestrator');

// ── Step 5: syntax check ─────────────────────────────────────────────────
const { execSync } = await import('child_process');
let ok = true;
for (const f of [PM_FILE, ...SECTIONS.map(s => path.join(MODS_DIR, s.file))]) {
  try {
    execSync(`node --check "${f}"`, { stdio: 'pipe' });
  } catch (e) {
    console.error(`  ✗  SYNTAX ERROR in ${path.basename(f)}: ${e.stderr.toString().split('\n')[0]}`);
    ok = false;
  }
}
if (ok) console.log('\nAll syntax checks passed ✓');
else console.log('\nSome files have syntax errors — check above');
