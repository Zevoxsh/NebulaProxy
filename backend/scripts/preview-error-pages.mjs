/**
 * Generates all error page HTML files into /tmp/nebula-error-pages/
 * Run with:  node backend/scripts/preview-error-pages.mjs
 * Then open the .html files in your browser.
 */

import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

// Stub config so renderers.js doesn't crash without a real config
const fakeConfig = {
  proxy: {
    badGatewayPage: {},
    checkToken: 'test',
  }
};
const configModule = { config: fakeConfig };

// Patch the import before loading renderers
import { createRequire } from 'module';
import { fileURLToPath, pathToFileURL } from 'url';
import { register } from 'module';

// Just import renderers directly — config is only read at call time for badGatewayPage
// so a minimal stub is enough.
import {
  renderNotFoundPage,
  renderBadGatewayPage,
  renderServiceUnavailablePage,
  renderMaintenancePage,
  renderBlockedPage,
  renderBandwidthExceededPage,
  renderRateLimitPage,
  renderPayloadTooLargePage,
} from '../services/proxy/renderers.js';

const OUT = '/tmp/nebula-error-pages';
mkdirSync(OUT, { recursive: true });

const pages = [
  ['404-domain-not-found.html',    renderNotFoundPage('example.com')],
  ['502-bad-gateway-refused.html', renderBadGatewayPage('example.com', { errorCode: 'ECONNREFUSED' })],
  ['502-bad-gateway-timeout.html', renderBadGatewayPage('example.com', { errorCode: 'ETIMEDOUT' })],
  ['503-service-unavailable.html', renderServiceUnavailablePage('example.com')],
  ['503-maintenance.html',         renderMaintenancePage({
    hostname: 'example.com',
    maintenance_message: 'We are upgrading the database. Back in ~30 minutes.',
    maintenance_end_time: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
  })],
  ['403-blocked-geoip.html',       renderBlockedPage('Access from RU is not permitted.', 403)],
  ['401-unauthorized.html',        renderBlockedPage('Authentication required to access this resource.', 401)],
  ['429-bandwidth.html',           renderBandwidthExceededPage({ hostname: 'example.com' })],
  ['429-rate-limit.html',          renderRateLimitPage('example.com')],
  ['413-payload-too-large.html',   renderPayloadTooLargePage('example.com', 100 * 1024 * 1024)],
];

for (const [filename, html] of pages) {
  const path = join(OUT, filename);
  writeFileSync(path, html, 'utf8');
  console.log(`✓  ${path}`);
}

console.log(`\nDone! Open the files above in your browser.`);
console.log(`\nOr serve them locally:\n  npx serve ${OUT}`);
