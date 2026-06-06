// @ts-check
// Auto-extracted from database.js — do not edit the methods here; edit database.js source.
// Prototype methods are mixed into DatabaseService in database.js via prototype iteration.

export class CustomHeaderRepository {
// ===== CUSTOM HEADERS METHODS =====

async createCustomHeader(domainId, headerName, headerValue) {
  const result = await this.execute(`
    INSERT INTO custom_headers (domain_id, header_name, header_value)
    VALUES (?, ?, ?)
    RETURNING id
  `, [domainId, headerName, headerValue]);
  return this.getCustomHeaderById(result.rows[0].id);
}

getCustomHeaderById(id) {
  return this.queryOne('SELECT * FROM custom_headers WHERE id = ?', [id]);
}

getCustomHeadersByDomainId(domainId) {
  return this.queryAll(`
    SELECT * FROM custom_headers
    WHERE domain_id = ?
    ORDER BY created_at DESC
  `, [domainId]);
}

getAllCustomHeaders() {
  return this.queryAll(`
    SELECT
      h.*,
      d.hostname
    FROM custom_headers h
    JOIN domains d ON h.domain_id = d.id
    ORDER BY d.hostname, h.created_at DESC
  `, []);
}

async deleteCustomHeader(id) {
  return this.execute('DELETE FROM custom_headers WHERE id = ?', [id]);
}

async toggleCustomHeaderActive(id) {
  await this.execute(`
    UPDATE custom_headers
    SET is_active = NOT is_active
    WHERE id = ?
  `, [id]);
  return this.getCustomHeaderById(id);
}
}
