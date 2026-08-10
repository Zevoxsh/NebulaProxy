// @ts-check
// Mixed into DatabaseService in database.js via prototype iteration.

export class IpsecRepository {
// ===== IPSEC TUNNEL MANAGEMENT =====

async createIpsecTunnel({
  name, mode, connName, localId, remoteId, remoteAddr, localSubnet, remoteSubnet,
  ikeProposal, espProposal, psk, createdBy
}) {
  return this.queryOne(`
    INSERT INTO ipsec_tunnels
      (name, mode, conn_name, local_id, remote_id, remote_addr, local_subnet, remote_subnet, ike_proposal, esp_proposal, psk, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    RETURNING *
  `, [
    name, mode, connName, localId ?? null, remoteId ?? null, remoteAddr ?? null,
    localSubnet, remoteSubnet, ikeProposal, espProposal, psk, createdBy ?? null
  ]);
}

async getAllIpsecTunnels() {
  return this.queryAll('SELECT * FROM ipsec_tunnels ORDER BY id DESC', []);
}

async getIpsecTunnelById(id) {
  return this.queryOne('SELECT * FROM ipsec_tunnels WHERE id = ?', [id]);
}

async getIpsecTunnelByConnName(connName) {
  return this.queryOne('SELECT * FROM ipsec_tunnels WHERE conn_name = ?', [connName]);
}

async updateIpsecTunnel(id, {
  name, remoteId, remoteAddr, localSubnet, remoteSubnet, ikeProposal, espProposal
}) {
  await this.execute(`
    UPDATE ipsec_tunnels
    SET name = COALESCE(?, name),
        remote_id = COALESCE(?, remote_id),
        remote_addr = COALESCE(?, remote_addr),
        local_subnet = COALESCE(?, local_subnet),
        remote_subnet = COALESCE(?, remote_subnet),
        ike_proposal = COALESCE(?, ike_proposal),
        esp_proposal = COALESCE(?, esp_proposal),
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `, [
    name ?? null, remoteId ?? null, remoteAddr ?? null, localSubnet ?? null,
    remoteSubnet ?? null, ikeProposal ?? null, espProposal ?? null, id
  ]);
  return this.getIpsecTunnelById(id);
}

async setIpsecTunnelEnabled(id, isEnabled) {
  await this.execute(`
    UPDATE ipsec_tunnels SET is_enabled = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
  `, [isEnabled, id]);
  return this.getIpsecTunnelById(id);
}

async rotateIpsecTunnelPsk(id, psk) {
  await this.execute(`
    UPDATE ipsec_tunnels SET psk = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
  `, [psk, id]);
  return this.getIpsecTunnelById(id);
}

async deleteIpsecTunnel(id) {
  return this.execute('DELETE FROM ipsec_tunnels WHERE id = ?', [id]);
}
}
