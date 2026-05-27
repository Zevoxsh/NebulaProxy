import net from 'net';
import { pool } from '../config/database.js';

const ZABBIX_HEADER = Buffer.from('ZBXD\x01', 'binary');

function buildPacket(data) {
  const json = JSON.stringify(data);
  const dataBuffer = Buffer.from(json, 'utf8');
  const header = Buffer.alloc(13);
  ZABBIX_HEADER.copy(header, 0);
  header.writeBigInt64LE(BigInt(dataBuffer.length), 5);
  return Buffer.concat([header, dataBuffer]);
}

async function sendPacket(host, port, items, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    let responseData = Buffer.alloc(0);

    const payload = {
      request: 'sender data',
      data: items.map((item) => ({
        host: item.host,
        key: item.key,
        value: String(item.value),
        clock: item.clock || Math.floor(Date.now() / 1000)
      }))
    };

    const packet = buildPacket(payload);

    socket.setTimeout(timeoutMs);

    socket.connect(port, host, () => {
      socket.write(packet);
    });

    socket.on('data', (chunk) => {
      responseData = Buffer.concat([responseData, chunk]);
    });

    socket.on('end', () => {
      try {
        if (responseData.length < 13) {
          reject(new Error('Invalid response from Zabbix server'));
          return;
        }
        const json = responseData.slice(13).toString('utf8');
        resolve(JSON.parse(json));
      } catch (err) {
        reject(new Error(`Failed to parse Zabbix response: ${err.message}`));
      }
    });

    socket.on('timeout', () => {
      socket.destroy();
      reject(new Error('Connection to Zabbix server timed out'));
    });

    socket.on('error', (err) => {
      reject(new Error(`Zabbix connection error: ${err.message}`));
    });
  });
}

class ZabbixService {
  constructor(logger) {
    this.logger = logger;
    this.config = null;
  }

  async loadConfig() {
    try {
      const result = await pool.query(
        'SELECT value FROM system_config WHERE key = $1',
        ['notification_config']
      );
      if (result.rows.length > 0) {
        const full = JSON.parse(result.rows[0].value);
        this.config = full.zabbix || null;
      }
    } catch (err) {
      this.logger?.error({ err }, 'ZabbixService: failed to load config');
    }
  }

  async isEnabled() {
    await this.loadConfig();
    return Boolean(this.config?.enabled && this.config?.server_host);
  }

  async send(items) {
    if (!await this.isEnabled()) return;

    const { server_host, server_port = 10051, host_name = 'NebulaProxy' } = this.config;

    const enriched = items.map((item) => ({
      ...item,
      host: item.host || host_name
    }));

    try {
      const response = await sendPacket(server_host, Number(server_port), enriched);
      this.logger?.info({ response }, 'ZabbixService: metrics sent');
      return response;
    } catch (err) {
      this.logger?.error({ err }, 'ZabbixService: failed to send metrics');
      throw err;
    }
  }

  async testConnection(serverHost, serverPort, hostName = 'NebulaProxy') {
    const items = [{
      host: hostName,
      key: 'nebula.test',
      value: '1',
      clock: Math.floor(Date.now() / 1000)
    }];
    return sendPacket(serverHost, Number(serverPort || 10051), items, 8000);
  }

  async sendDomainStatus(hostname, status, responseTime = 0) {
    await this.loadConfig();
    if (!this.config?.send_domain_alerts) return;
    await this.send([
      { key: `nebula.domain.status[${hostname}]`, value: status === 'up' ? 1 : 0 },
      { key: `nebula.domain.response_time[${hostname}]`, value: responseTime }
    ]);
  }

  async sendSslExpiry(hostname, daysUntilExpiry) {
    await this.loadConfig();
    if (!this.config?.send_ssl_alerts) return;
    await this.send([
      { key: `nebula.ssl.expires_in[${hostname}]`, value: daysUntilExpiry }
    ]);
  }

  async sendResourceAlert(type, value) {
    await this.loadConfig();
    if (!this.config?.send_resource_alerts) return;
    const key = `nebula.system.${type.toLowerCase()}`;
    await this.send([{ key, value }]);
  }

  async sendProxyLifecycle(state) {
    await this.loadConfig();
    if (!this.config?.send_lifecycle_events) return;
    const isUp = ['started', 'startup', 'online'].includes(state.toLowerCase());
    await this.send([
      { key: 'nebula.proxy.status', value: isUp ? 1 : 0 }
    ]);
  }
}

export const zabbixService = new ZabbixService(null);

export function initZabbixService(logger) {
  zabbixService.logger = logger;
}

export default ZabbixService;
