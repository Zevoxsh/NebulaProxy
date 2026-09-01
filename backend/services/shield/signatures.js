// @ts-check
// Nebula Shield — bot intelligence (pure, dependency-free, unit-testable).
//
// Classifies a request's User-Agent, scores how "browser-like" its headers
// are, and scores a browser fingerprint collected client-side. No I/O here —
// the engine layers rate limiting, DNS good-bot verification and GeoIP on top.

// Aggressive AI/LLM scrapers and generic crawlers. Matched case-insensitively
// as substrings. These are denied outright (strict/balanced) or hard-challenged.
const AI_SCRAPERS = [
  'gptbot', 'chatgpt-user', 'oai-searchbot', 'claudebot', 'claude-web', 'anthropic-ai',
  'ccbot', 'bytespider', 'amazonbot', 'google-extended', 'perplexitybot', 'youbot',
  'diffbot', 'imagesiftbot', 'omgilibot', 'omgili', 'dataforseobot', 'timpibot',
  'cohere-ai', 'meta-externalagent', 'meta-externalfetcher', 'facebookbot',
  'magpie-crawler', 'semrushbot', 'ahrefsbot', 'mj12bot', 'dotbot', 'petalbot',
  'applebot-extended', 'bytedance', 'gpt-crawler', 'webzio', 'awario',
];

// Automation tooling / non-browser HTTP clients. Never legitimate browsers.
const AUTOMATION = [
  'headlesschrome', 'phantomjs', 'selenium', 'playwright', 'puppeteer', 'electron',
  'python-requests', 'python-urllib', 'aiohttp', 'httpx', 'scrapy', 'go-http-client',
  'java/', 'okhttp', 'apache-httpclient', 'curl/', 'wget/', 'libwww-perl', 'guzzlehttp',
  'node-fetch', 'axios/', 'got (', 'restsharp', 'winhttp', 'zgrab', 'masscan',
  'nikto', 'sqlmap', 'nmap', 'httrack', 'wpscan',
];

// Legitimate crawlers/agents we let through — but only after DNS verification
// for the ones that publish a verifiable method (see engine.verifyGoodBot).
// `dns` = must pass reverse+forward DNS; `open` = link-preview agents that
// don't publish verifiable ranges (allowed as low-risk, still rate-limited).
const GOOD_BOTS = [
  { name: 'googlebot',   test: 'googlebot',            verify: 'dns', suffixes: ['.googlebot.com', '.google.com'] },
  { name: 'google-misc', test: 'google-inspectiontool', verify: 'dns', suffixes: ['.googlebot.com', '.google.com'] },
  { name: 'storebot',    test: 'storebot-google',      verify: 'dns', suffixes: ['.googlebot.com', '.google.com'] },
  { name: 'bingbot',     test: 'bingbot',              verify: 'dns', suffixes: ['.search.msn.com'] },
  { name: 'duckduckbot', test: 'duckduckbot',          verify: 'dns', suffixes: ['.duckduckgo.com'] },
  { name: 'yandexbot',   test: 'yandexbot',            verify: 'dns', suffixes: ['.yandex.com', '.yandex.net', '.yandex.ru'] },
  { name: 'baiduspider', test: 'baiduspider',          verify: 'dns', suffixes: ['.baidu.com', '.baidu.jp'] },
  { name: 'applebot',    test: 'applebot',             verify: 'dns', suffixes: ['.applebot.apple.com'] },
  { name: 'facebook',    test: 'facebookexternalhit',  verify: 'open' },
  { name: 'twitter',     test: 'twitterbot',           verify: 'open' },
  { name: 'linkedin',    test: 'linkedinbot',          verify: 'open' },
  { name: 'slack',       test: 'slackbot',             verify: 'open' },
  { name: 'discord',     test: 'discordbot',           verify: 'open' },
  { name: 'telegram',    test: 'telegrambot',          verify: 'open' },
  { name: 'whatsapp',    test: 'whatsapp',             verify: 'open' },
  { name: 'uptimerobot', test: 'uptimerobot',          verify: 'open' },
  { name: 'pingdom',     test: 'pingdom',              verify: 'open' },
];

/**
 * Classify a User-Agent string.
 * @returns {{ class: 'ai-scraper'|'automation'|'good-bot'|'browser'|'empty', bot?: object }}
 */
export function classifyUserAgent(ua) {
  const s = String(ua || '').toLowerCase().trim();
  if (!s) return { class: 'empty' };

  for (const b of GOOD_BOTS) {
    if (s.includes(b.test)) return { class: 'good-bot', bot: b };
  }
  for (const marker of AI_SCRAPERS) {
    if (s.includes(marker)) return { class: 'ai-scraper' };
  }
  for (const marker of AUTOMATION) {
    if (s.includes(marker)) return { class: 'automation' };
  }
  // A real browser UA always contains "mozilla/5.0". Anything else claiming to
  // be a browser but missing it is suspicious tooling.
  if (s.includes('mozilla/')) return { class: 'browser' };
  return { class: 'automation' };
}

/**
 * Score how complete/browser-like the request headers are. Real browsers send
 * Accept, Accept-Language and Accept-Encoding on navigations; scrapers routinely
 * omit them. Higher = more suspicious (0..3).
 */
export function headerSuspicion(headers) {
  let score = 0;
  const accept = String(headers['accept'] || '');
  if (!accept) score += 1;
  else if (!accept.includes('text/html') && !accept.includes('*/*')) score += 1;
  if (!headers['accept-language']) score += 1;
  if (!headers['accept-encoding']) score += 1;
  return score;
}

/**
 * Score a client-collected fingerprint. Returns { penalty, hardBot }.
 * `hardBot` = a near-certain automation tell (navigator.webdriver, or a
 * headless/inconsistent environment). `penalty` feeds adaptive difficulty.
 */
export function scoreFingerprint(fp) {
  if (!fp || typeof fp !== 'object') return { penalty: 2, hardBot: false };
  let penalty = 0;
  let hardBot = false;

  if (fp.webdriver === true) hardBot = true;
  // Real browsers expose at least one language.
  if (Array.isArray(fp.languages) && fp.languages.length === 0) penalty += 2;
  if (fp.languages === undefined) penalty += 1;
  // Headless Chrome historically reports 0 hardwareConcurrency / no deviceMemory.
  if (typeof fp.hw === 'number' && fp.hw === 0) penalty += 2;
  // A degenerate screen (0×0) or absurd values.
  if (fp.screen && (fp.screen.w === 0 || fp.screen.h === 0)) penalty += 2;
  // No timezone resolved.
  if (!fp.tz) penalty += 1;
  // Canvas fingerprint failed to render (common in headless without GPU).
  if (fp.canvas === 'blank' || fp.canvas === 'error') penalty += 1;
  // UA/platform contradiction (e.g. UA says Windows, platform says Linux).
  if (fp.uaPlatformMismatch === true) penalty += 1;
  // Automation frameworks leak these globals into the page.
  if (fp.automationGlobals === true) hardBot = true;

  if (penalty >= 4) hardBot = true;
  return { penalty, hardBot };
}

export const _internal = { AI_SCRAPERS, AUTOMATION, GOOD_BOTS };
