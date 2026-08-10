// @ts-check
/**
 * IPsec VPN service — IKEv2/PSK site-to-site tunnels via strongSwan
 * (charon + swanctl). Same host-level rationale as wireguardService.js:
 * the backend container runs with NET_ADMIN + network_mode: host, so the
 * XFRM policies/SAs charon creates are real host IPsec state, and
 * /etc/swanctl is bind-mounted so config survives a container recreate
 * (see docker-compose.yml). charon itself is started once by entrypoint.sh
 * (no systemd in this container to supervise it); this module only ever
 * talks to it through `swanctl` over its vici socket.
 *
 * Unlike WireGuard's client->N-peers model, classic IPsec site-to-site is
 * one connection == one peer, so there's no separate peer table/UI here —
 * multiple remote sites just mean multiple tunnels.
 */
import { spawn } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import { logger } from '../utils/logger.js';

const SWANCTL_DIR = '/etc/swanctl';
const CONF_D_DIR = `${SWANCTL_DIR}/conf.d`;

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args);
    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (d) => { stdout += d.toString(); });
    proc.stderr.on('data', (d) => { stderr += d.toString(); });

    proc.on('error', (err) => reject(err));
    proc.on('close', (code) => {
      if (code === 0) {
        resolve(stdout);
      } else {
        reject(new Error(`${cmd} ${args.join(' ')} exited ${code}: ${stderr.trim() || stdout.trim()}`));
      }
    });
  });
}

class IpsecService {
  generatePresharedKey() {
    // Hex, not base64: goes straight into a quoted swanctl secrets{} block
    // with zero escaping to worry about.
    return crypto.randomBytes(32).toString('hex');
  }

  async nextConnName(existingNames = []) {
    const used = new Set(existingNames);
    for (let i = 0; i < 64; i += 1) {
      const candidate = `ipsec${i}`;
      if (!used.has(candidate)) return candidate;
    }
    throw new Error('No free ipsec<N> connection name (64 in use)');
  }

  async ensureBaseConfig() {
    await fs.promises.mkdir(CONF_D_DIR, { recursive: true, mode: 0o700 });
    const swanctlConf = `${SWANCTL_DIR}/swanctl.conf`;
    if (!fs.existsSync(swanctlConf)) {
      await fs.promises.writeFile(swanctlConf, 'include conf.d/*.conf\n');
    }
  }

  // Child's start_action is what actually decides client-vs-server behavior:
  // 'start' auto-initiates (and re-initiates on charon reload, e.g. after a
  // container restart), 'none' means pure responder — wait for the peer.
  // A disabled tunnel always renders with 'none' regardless of mode, so a
  // plain `swanctl --load-all` after a restart never revives it.
  renderConfig(tunnel) {
    const startAction = tunnel.is_enabled && tunnel.mode === 'client' ? 'start' : 'none';
    const remoteAddrs = tunnel.remote_addr || '%any';

    const lines = [
      'connections {',
      `  ${tunnel.conn_name} {`,
      '    version = 2',
      '    local_addrs = %any',
      `    remote_addrs = ${remoteAddrs}`,
      '    local {',
      '      auth = psk',
      ...(tunnel.local_id ? [`      id = ${tunnel.local_id}`] : []),
      '    }',
      '    remote {',
      '      auth = psk',
      ...(tunnel.remote_id ? [`      id = ${tunnel.remote_id}`] : []),
      '    }',
      `    proposals = ${tunnel.ike_proposal}`,
      '    dpd_delay = 30s',
      '    children {',
      `      ${tunnel.conn_name} {`,
      `        local_ts = ${tunnel.local_subnet}`,
      `        remote_ts = ${tunnel.remote_subnet}`,
      `        esp_proposals = ${tunnel.esp_proposal}`,
      `        start_action = ${startAction}`,
      '        dpd_action = restart',
      '        close_action = none',
      '      }',
      '    }',
      '  }',
      '}',
      'secrets {',
      `  ike-${tunnel.conn_name} {`,
      ...(tunnel.remote_id ? [`    id = ${tunnel.remote_id}`] : tunnel.remote_addr ? [`    id = ${tunnel.remote_addr}`] : []),
      `    secret = "${tunnel.psk}"`,
      '  }',
      '}'
    ];

    return `${lines.join('\n')}\n`;
  }

  configPath(connName) {
    return `${CONF_D_DIR}/${connName}.conf`;
  }

  async writeConfig(tunnel) {
    await this.ensureBaseConfig();
    const content = this.renderConfig(tunnel);
    const path = this.configPath(tunnel.conn_name);
    await fs.promises.writeFile(path, content, { mode: 0o600 });
    return path;
  }

  async loadAll() {
    await run('swanctl', ['--load-all']);
  }

  async isUp(connName) {
    try {
      const raw = await run('swanctl', ['--list-sas', '--ike', connName]);
      return /ESTABLISHED/.test(raw);
    } catch {
      return false;
    }
  }

  async up(connName) {
    await this.loadAll();
    await run('swanctl', ['--initiate', '--child', connName]);
    logger.info(`[IPsec] ${connName} initiated`);
  }

  async down(connName) {
    if (!(await this.isUp(connName))) return;
    await run('swanctl', ['--terminate', '--ike', connName]).catch((err) => {
      logger.warn(`[IPsec] terminate ${connName} failed (may already be down): ${err.message}`);
    });
    logger.info(`[IPsec] ${connName} terminated`);
  }

  // Config changed — drop any existing SA and, for an enabled client
  // tunnel, bring it straight back up. Same down+up tradeoff as
  // wireguardService.reload(): simplest correct thing for a config edit,
  // not a hot path.
  async reload(tunnel) {
    await this.down(tunnel.conn_name);
    await this.loadAll();
    if (tunnel.is_enabled && tunnel.mode === 'client') {
      await run('swanctl', ['--initiate', '--child', tunnel.conn_name]);
    }
    logger.info(`[IPsec] ${tunnel.conn_name} reloaded`);
  }

  async deleteConfig(connName) {
    await this.down(connName).catch(() => {});
    await fs.promises.unlink(this.configPath(connName)).catch(() => {});
    await this.loadAll().catch(() => {});
  }

  // Best-effort text parse of `swanctl --list-sas` — strongSwan has no
  // stable machine-readable format for this over the CLI (vici itself is
  // structured, but scripting against it directly isn't worth it for a
  // status readout). Callers get the up/down flag plus the raw text so
  // nothing is lost if the regex below misses a field.
  async status(connName) {
    let raw = '';
    try {
      raw = await run('swanctl', ['--list-sas', '--ike', connName]);
    } catch {
      return { up: false, raw: '' };
    }
    const up = /ESTABLISHED/.test(raw);
    const bytesIn = raw.match(/bytes_i \((\d+)/);
    const bytesOut = raw.match(/bytes_o \((\d+)/);
    return {
      up,
      raw: raw.trim(),
      rxBytes: bytesIn ? Number(bytesIn[1]) : 0,
      txBytes: bytesOut ? Number(bytesOut[1]) : 0
    };
  }
}

export const ipsecService = new IpsecService();
