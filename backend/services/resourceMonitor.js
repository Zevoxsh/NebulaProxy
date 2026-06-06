// @ts-check
/**
 * Resource Monitor — periodic CPU/memory/disk checks with alert auto-resolution.
 *
 * Alert lifecycle:
 *   NORMAL → threshold breached → ALERTING (send alert)
 *   ALERTING → value drops below (threshold - hysteresis) → RESOLVED (send resolution)
 *
 * Hysteresis prevents flapping: if threshold is 80%, resolution fires at 75%.
 * State is kept in-process (Map). On restart, alerts re-fire if still above threshold.
 */

import { monitoringService } from './monitoringService.js';
import { container } from './container.js';
import { pool } from '../config/database.js';
import { logger } from '../utils/logger.js';

const HYSTERESIS = 5;       // % below threshold before resolving
const CHECK_INTERVAL_MS = 60_000;

class ResourceMonitor {
  #states = new Map();   // key → 'ok' | 'alerting'
  #timer  = null;

  async start() {
    if (this.#timer) return;
    this.#timer = setInterval(() => this.#check().catch(err => logger.error(err)), CHECK_INTERVAL_MS);
    // Run once immediately so first alert isn't delayed a full minute
    this.#check().catch(err => logger.error(err));
  }

  stop() {
    if (this.#timer) { clearInterval(this.#timer); this.#timer = null; }
  }

  async #loadThresholds() {
    try {
      const { rows } = await pool.query(
        "SELECT value FROM system_config WHERE key = 'notification_config' LIMIT 1"
      );
      if (!rows.length) return null;
      const cfg = JSON.parse(rows[0].value);
      return cfg.alerts ?? null;
    } catch { return null; }
  }

  async #check() {
    const thresholds = await this.#loadThresholds();
    if (!thresholds) return;

    let metrics;
    try {
      metrics = await monitoringService.getSystemMetrics();
    } catch { return; }

    const checks = [
      { key: 'cpu',    value: metrics.cpu?.usage,    threshold: thresholds.high_cpu_threshold    ?? 80 },
      { key: 'memory', value: metrics.memory?.usedPercent, threshold: thresholds.high_memory_threshold ?? 85 },
      { key: 'disk',   value: metrics.disk?.usedPercent,   threshold: thresholds.disk_space_threshold  ?? 90 }
    ];

    for (const { key, value, threshold } of checks) {
      if (value == null) continue;
      const state = this.#states.get(key) ?? 'ok';

      if (state === 'ok' && value >= threshold) {
        this.#states.set(key, 'alerting');
        await this.#sendAlert(key, value, threshold);

      } else if (state === 'alerting' && value < threshold - HYSTERESIS) {
        this.#states.set(key, 'ok');
        await this.#sendResolution(key, value, threshold);
      }
    }
  }

  async #sendAlert(type, value, threshold) {
    const ns = container.has('notifications') ? container.get('notifications') : null;
    if (!ns) return;
    await ns.sendResourceAlert(type, Math.round(value), threshold).catch(err => logger.error(err));
  }

  async #sendResolution(type, value, threshold) {
    const ns = container.has('notifications') ? container.get('notifications') : null;
    if (!ns) return;

    const label = { cpu: 'CPU', memory: 'Memory', disk: 'Disk' }[type] ?? type.toUpperCase();

    await ns.send({
      title:    `${label} Usage Resolved`,
      message:  `${label} usage dropped to ${Math.round(value)}% (threshold was ${threshold}%)`,
      severity: 'success',
      event:    'resource_resolved',
      metadata: { type, value: Math.round(value), threshold }
    }).catch(err => logger.error(err));
  }
}

export const resourceMonitor = new ResourceMonitor();
