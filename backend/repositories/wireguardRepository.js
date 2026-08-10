// @ts-check
// Mixed into DatabaseService in database.js via prototype iteration.

export class WireguardRepository {
// ===== WIREGUARD TUNNEL MANAGEMENT =====

async createWireguardTunnel({ name, mode, interfaceName, privateKey, publicKey, address, listenPort, mtu, dns, createdBy }) {
  return this.queryOne(`
    INSERT INTO wireguard_tunnels (name, mode, interface_name, private_key, public_key, address, listen_port, mtu, dns, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    RETURNING *
  `, [name, mode, interfaceName, privateKey, publicKey, address, listenPort ?? null, mtu ?? null, dns ?? null, createdBy ?? null]);
}

async getAllWireguardTunnels() {
  return this.queryAll(`
    SELECT t.*, COUNT(p.id)::int AS peer_count
    FROM wireguard_tunnels t
    LEFT JOIN wireguard_peers p ON p.tunnel_id = t.id
    GROUP BY t.id
    ORDER BY t.id DESC
  `, []);
}

async getWireguardTunnelById(id) {
  return this.queryOne('SELECT * FROM wireguard_tunnels WHERE id = ?', [id]);
}

async getWireguardTunnelByInterfaceName(interfaceName) {
  return this.queryOne('SELECT * FROM wireguard_tunnels WHERE interface_name = ?', [interfaceName]);
}

async updateWireguardTunnel(id, { name, address, listenPort, mtu, dns }) {
  await this.execute(`
    UPDATE wireguard_tunnels
    SET name = COALESCE(?, name),
        address = COALESCE(?, address),
        listen_port = COALESCE(?, listen_port),
        mtu = COALESCE(?, mtu),
        dns = COALESCE(?, dns),
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `, [name ?? null, address ?? null, listenPort ?? null, mtu ?? null, dns ?? null, id]);
  return this.getWireguardTunnelById(id);
}

async setWireguardTunnelEnabled(id, isEnabled) {
  await this.execute(`
    UPDATE wireguard_tunnels SET is_enabled = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
  `, [isEnabled, id]);
  return this.getWireguardTunnelById(id);
}

async rotateWireguardTunnelKeys(id, { privateKey, publicKey }) {
  await this.execute(`
    UPDATE wireguard_tunnels SET private_key = ?, public_key = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
  `, [privateKey, publicKey, id]);
  return this.getWireguardTunnelById(id);
}

async deleteWireguardTunnel(id) {
  return this.execute('DELETE FROM wireguard_tunnels WHERE id = ?', [id]);
}

// ===== WIREGUARD PEER MANAGEMENT =====

async createWireguardPeer({ tunnelId, name, publicKey, presharedKey, allowedIps, endpointHost, endpointPort, persistentKeepalive }) {
  return this.queryOne(`
    INSERT INTO wireguard_peers (tunnel_id, name, public_key, preshared_key, allowed_ips, endpoint_host, endpoint_port, persistent_keepalive)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    RETURNING *
  `, [
    tunnelId, name, publicKey, presharedKey ?? null, allowedIps,
    endpointHost ?? null, endpointPort ?? null, persistentKeepalive ?? null
  ]);
}

async getWireguardPeersByTunnelId(tunnelId) {
  return this.queryAll('SELECT * FROM wireguard_peers WHERE tunnel_id = ? ORDER BY id ASC', [tunnelId]);
}

async getWireguardPeerById(id) {
  return this.queryOne('SELECT * FROM wireguard_peers WHERE id = ?', [id]);
}

async updateWireguardPeer(id, { name, allowedIps, endpointHost, endpointPort, persistentKeepalive, isEnabled }) {
  await this.execute(`
    UPDATE wireguard_peers
    SET name = COALESCE(?, name),
        allowed_ips = COALESCE(?, allowed_ips),
        endpoint_host = COALESCE(?, endpoint_host),
        endpoint_port = COALESCE(?, endpoint_port),
        persistent_keepalive = COALESCE(?, persistent_keepalive),
        is_enabled = COALESCE(?, is_enabled),
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `, [
    name ?? null, allowedIps ?? null, endpointHost ?? null, endpointPort ?? null,
    persistentKeepalive ?? null, isEnabled !== undefined && isEnabled !== null ? isEnabled : null, id
  ]);
  return this.getWireguardPeerById(id);
}

async deleteWireguardPeer(id) {
  return this.execute('DELETE FROM wireguard_peers WHERE id = ?', [id]);
}
}
