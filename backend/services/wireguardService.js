// @ts-check
/**
 * WireGuard VPN service — key generation, wg-quick config rendering,
 * interface up/down, and live peer status. Runs `wg`/`wg-quick` directly
 * on the host: the backend container already runs with network_mode: host
 * (see docker-compose.yml) plus NET_ADMIN + /dev/net/tun, so an interface
 * brought up from inside the container really is a host interface — no
 * extra plumbing needed to make it reachable from the rest of the LAN.
 */
import { spawn } from 'child_process';
import fs from 'fs';
import { logger } from '../utils/logger.js';

const WG_CONF_DIR = '/etc/wireguard';

function run(cmd, args, { input } = {}) {
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

    if (input !== undefined) {
      proc.stdin.write(input);
      proc.stdin.end();
    }
  });
}

class WireguardService {
  async generateKeypair() {
    const privateKey = (await run('wg', ['genkey'])).trim();
    const publicKey = (await run('wg', ['pubkey'], { input: privateKey })).trim();
    return { privateKey, publicKey };
  }

  async generatePresharedKey() {
    return (await run('wg', ['genpsk'])).trim();
  }

  async nextInterfaceName(existingNames = []) {
    const used = new Set(existingNames);
    for (let i = 0; i < 64; i += 1) {
      const candidate = `wg${i}`;
      if (!used.has(candidate)) return candidate;
    }
    throw new Error('No free wg<N> interface name (64 in use)');
  }

  renderConfig(tunnel, peers) {
    const lines = ['[Interface]'];
    lines.push(`PrivateKey = ${tunnel.private_key}`);
    lines.push(`Address = ${tunnel.address}`);
    if (tunnel.listen_port) lines.push(`ListenPort = ${tunnel.listen_port}`);
    if (tunnel.mtu) lines.push(`MTU = ${tunnel.mtu}`);
    if (tunnel.dns) lines.push(`DNS = ${tunnel.dns}`);

    for (const peer of peers) {
      if (!peer.is_enabled) continue;
      lines.push('');
      lines.push('[Peer]');
      lines.push(`# ${peer.name}`);
      lines.push(`PublicKey = ${peer.public_key}`);
      if (peer.preshared_key) lines.push(`PresharedKey = ${peer.preshared_key}`);
      lines.push(`AllowedIPs = ${peer.allowed_ips}`);
      if (peer.endpoint_host && peer.endpoint_port) {
        lines.push(`Endpoint = ${peer.endpoint_host}:${peer.endpoint_port}`);
      }
      if (peer.persistent_keepalive) lines.push(`PersistentKeepalive = ${peer.persistent_keepalive}`);
    }

    return `${lines.join('\n')}\n`;
  }

  configPath(interfaceName) {
    return `${WG_CONF_DIR}/${interfaceName}.conf`;
  }

  async writeConfig(tunnel, peers) {
    await fs.promises.mkdir(WG_CONF_DIR, { recursive: true, mode: 0o700 });
    const content = this.renderConfig(tunnel, peers);
    const path = this.configPath(tunnel.interface_name);
    await fs.promises.writeFile(path, content, { mode: 0o600 });
    return path;
  }

  async isUp(interfaceName) {
    try {
      await run('wg', ['show', interfaceName]);
      return true;
    } catch {
      return false;
    }
  }

  async up(interfaceName) {
    if (await this.isUp(interfaceName)) {
      logger.info(`[Wireguard] ${interfaceName} already up, reloading peers instead`);
      return this.reload(interfaceName);
    }
    await run('wg-quick', ['up', interfaceName]);
    logger.info(`[Wireguard] ${interfaceName} up`);
  }

  async down(interfaceName) {
    if (!(await this.isUp(interfaceName))) return;
    await run('wg-quick', ['down', interfaceName]);
    logger.info(`[Wireguard] ${interfaceName} down`);
  }

  // Re-applies config after a peer add/edit/remove. Simplest correct
  // approach (down + up) instead of `wg syncconf`, which needs the
  // wg-quick-only directives (Address/DNS/MTU) stripped out first via
  // shell process substitution — not worth fighting through `spawn` for
  // what's a sub-second blip on a config change, not a hot path.
  async reload(interfaceName) {
    if (await this.isUp(interfaceName)) {
      await run('wg-quick', ['down', interfaceName]);
    }
    await run('wg-quick', ['up', interfaceName]);
    logger.info(`[Wireguard] ${interfaceName} reloaded`);
  }

  async deleteConfig(interfaceName) {
    await this.down(interfaceName).catch(() => {});
    await fs.promises.unlink(this.configPath(interfaceName)).catch(() => {});
  }

  // `wg show <iface> dump` — tab-separated, first line is the interface
  // itself, one line per peer after that.
  async status(interfaceName) {
    if (!(await this.isUp(interfaceName))) {
      return { up: false, peers: {} };
    }
    const raw = await run('wg', ['show', interfaceName, 'dump']);
    const rows = raw.trim().split('\n').filter(Boolean);
    const peers = {};
    for (const row of rows.slice(1)) {
      const [publicKey, , , allowedIps, latestHandshake, rxBytes, txBytes] = row.split('\t');
      peers[publicKey] = {
        allowedIps,
        latestHandshakeAt: Number(latestHandshake) > 0 ? new Date(Number(latestHandshake) * 1000).toISOString() : null,
        rxBytes: Number(rxBytes) || 0,
        txBytes: Number(txBytes) || 0
      };
    }
    return { up: true, peers };
  }
}

export const wireguardService = new WireguardService();
