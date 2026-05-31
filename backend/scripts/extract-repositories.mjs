#!/usr/bin/env node
/**
 * Splits the monolithic DatabaseService class into per-entity repository files.
 * Each repository is a class whose prototype methods are mixed into DatabaseService.prototype.
 * This preserves 100% API compatibility — all callers use `database.method()` unchanged.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_FILE   = path.join(__dirname, '..', 'services', 'database.js');
const REPO_DIR  = path.join(__dirname, '..', 'repositories');

fs.mkdirSync(REPO_DIR, { recursive: true });

const src   = fs.readFileSync(DB_FILE, 'utf8');
const lines = src.split('\n');

// ── Section boundaries (1-based line numbers, inclusive) ─────────────────────
// start = first line of the section (the // ===== header line)
// end   = last line of the section content (exclusive end = next section start - 1)
// Notation: stop NOTIFICATION at 3857 so that close() (3858-3862) stays in the class body.
// ── Section boundaries (from ORIGINAL unmodified database.js) ────────────────
// CDN SETTINGS (2142-2203) is intentionally skipped — table dropped in migration 050.
const SECTIONS = [
  { file: 'userRepository.js',                 className: 'UserRepository',                start: 235,  end: 336  },
  { file: 'domainRepository.js',               className: 'DomainRepository',              start: 337,  end: 572  },
  { file: 'tunnelRepository.js',               className: 'TunnelRepository',              start: 573,  end: 964  },
  { file: 'sslRepository.js',                  className: 'SslRepository',                 start: 965,  end: 1300 },
  { file: 'teamRepository.js',                 className: 'TeamRepository',                start: 1301, end: 1845 },
  { file: 'auditLogRepository.js',             className: 'AuditLogRepository',            start: 1846, end: 1879 },
  { file: 'statsRepository.js',                className: 'StatsRepository',               start: 1880, end: 1920 },
  { file: 'proxyLogRepository.js',             className: 'ProxyLogRepository',            start: 1921, end: 1979 },
  { file: 'healthRepository.js',               className: 'HealthRepository',              start: 1980, end: 2042 },
  { file: 'customHeaderRepository.js',         className: 'CustomHeaderRepository',        start: 2043, end: 2089 },
  { file: 'cacheSettingsRepository.js',        className: 'CacheSettingsRepository',       start: 2090, end: 2141 },
  // CDN SETTINGS 2142-2203 deliberately omitted (table dropped)
  { file: 'notificationSettingsRepository.js', className: 'NotificationSettingsRepository', start: 2204, end: 2258 },
  { file: 'domainHealthRepository.js',         className: 'DomainHealthRepository',        start: 2259, end: 2367 },
  { file: 'requestLogRepository.js',           className: 'RequestLogRepository',          start: 2368, end: 2587 },
  { file: 'redirectionRepository.js',          className: 'RedirectionRepository',         start: 2588, end: 2736 },
  { file: 'domainGroupRepository.js',          className: 'DomainGroupRepository',         start: 2737, end: 3139 },
  { file: 'backendRepository.js',              className: 'BackendRepository',             start: 3140, end: 3330 },
  { file: 'apiKeyRepository.js',               className: 'ApiKeyRepository',              start: 3331, end: 3598 },
  { file: 'queueRepository.js',                className: 'QueueRepository',               start: 3599, end: 3750 },
  { file: 'notificationRepository.js',         className: 'NotificationRepository',        start: 3751, end: 3856 },
];

// ── Extract & write each repository ──────────────────────────────────────────
for (const section of SECTIONS) {
  const sectionLines = lines.slice(section.start - 1, section.end);

  // Unindent: strip 2-space class body indentation
  const unindented = sectionLines.map(l => l.startsWith('  ') ? l.slice(2) : l);

  // Trim trailing blank lines
  while (unindented.length && unindented[unindented.length - 1].trim() === '') unindented.pop();

  // Replace bare console.* with logger.* (services have no fastify instance)
  const body = unindented.join('\n')
    .replace(/console\.warn\(/g,  'logger.warn(')
    .replace(/console\.error\(/g, 'logger.error(')
    .replace(/console\.debug\(/g, 'logger.debug(')
    .replace(/console\.log\(/g,   'logger.info(');

  const needsLogger = body.includes('logger.');

  const content = [
    '// Auto-extracted from database.js — do not edit the methods here; edit database.js source.',
    '// Prototype methods are mixed into DatabaseService in database.js via prototype iteration.',
    '',
    ...(needsLogger ? ["import { logger } from '../utils/logger.js';\n"] : []),
    `export class ${section.className} {`,
    body,
    '}',
    '',
  ].join('\n');

  fs.writeFileSync(path.join(REPO_DIR, section.file), content, 'utf8');
  console.log(`  ✓  ${section.file.padEnd(40)} ${sectionLines.length} lines → ${section.className}`);
}

// ── Rebuild database.js as thin orchestrator ─────────────────────────────────
// Infrastructure: lines 1-233 (imports + class header + init/migrations/queryOne/queryAll/execute)
// close() method: lines 3858-3862 — stays in the main class

const originalImports = lines.slice(0, 14).join('\n');  // lines 1-14 (original imports)
const topLevelCode    = lines.slice(14, 23).join('\n');  // lines 15-23 (constants + class start)
const classInfra      = lines.slice(23, 233).join('\n'); // lines 24-233 (constructor + infra methods)
const closeMethod     = lines.slice(3856, 3864).join('\n'); // lines 3857-3864 (close() + class closing brace)

const repoImports = SECTIONS.map(s =>
  `import { ${s.className} } from '../repositories/${s.file}';`
).join('\n');

const mixinCode = [
  'const _repositories = [',
  SECTIONS.map(s => `  ${s.className}`).join(',\n'),
  '];',
  'for (const Repo of _repositories) {',
  "  Object.getOwnPropertyNames(Repo.prototype)",
  "    .filter(n => n !== 'constructor')",
  "    .forEach(n => { DatabaseService.prototype[n] = Repo.prototype[n]; });",
  '}',
].join('\n');

// Apply logger replacement to the infrastructure section
const infraPatched = [classInfra, closeMethod].join('\n')
  .replace(/console\.warn\(/g,  'logger.warn(')
  .replace(/console\.error\(/g, 'logger.error(')
  .replace(/console\.debug\(/g, 'logger.debug(')
  .replace(/console\.log\(/g,   'logger.info(');

const newDatabase = [
  originalImports,
  `import { logger } from '../utils/logger.js';`,
  repoImports,
  '',
  topLevelCode,
  infraPatched,
  '',
  mixinCode,
  '',
  'export const database = new DatabaseService();',
  '',
].join('\n');

fs.writeFileSync(DB_FILE, newDatabase, 'utf8');

console.log('\n  ✓  database.js rewritten as thin orchestrator');
console.log(`\nDone — ${SECTIONS.length} repository files in backend/repositories/`);
