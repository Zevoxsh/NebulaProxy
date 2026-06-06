// @ts-check
// Auto-extracted from database.js — do not edit the methods here; edit database.js source.
// Prototype methods are mixed into DatabaseService in database.js via prototype iteration.

export class StatsRepository {
// ===== STATS METHODS =====

async getStats() {
  const totalUsers = Number((await this.queryOne('SELECT COUNT(*) as count FROM users', []))?.count || 0);
  const adminCount = Number((await this.queryOne('SELECT COUNT(*) as count FROM users WHERE role = \'admin\'', []))?.count || 0);
  const totalDomains = Number((await this.queryOne('SELECT COUNT(*) as count FROM domains', []))?.count || 0);
  const activeDomains = Number((await this.queryOne('SELECT COUNT(*) as count FROM domains WHERE is_active = TRUE', []))?.count || 0);
  const sslEnabledDomains = Number((await this.queryOne('SELECT COUNT(*) as count FROM domains WHERE ssl_enabled = TRUE', []))?.count || 0);
  const activeSSLDomains = Number((await this.queryOne('SELECT COUNT(*) as count FROM domains WHERE ssl_status = \'active\'', []))?.count || 0);
  const httpProxies = Number((await this.queryOne('SELECT COUNT(*) as count FROM domains WHERE proxy_type = \'http\'', []))?.count || 0);
  const tcpProxies = Number((await this.queryOne('SELECT COUNT(*) as count FROM domains WHERE proxy_type = \'tcp\'', []))?.count || 0);
  const udpProxies = Number((await this.queryOne('SELECT COUNT(*) as count FROM domains WHERE proxy_type = \'udp\'', []))?.count || 0);
  const totalTeams = Number((await this.queryOne('SELECT COUNT(*) as count FROM teams', []))?.count || 0);
  const teamMembersCount = Number((await this.queryOne('SELECT COUNT(*) as count FROM team_members', []))?.count || 0);
  const totalRedirections = Number((await this.queryOne('SELECT COUNT(*) as count FROM redirections', []))?.count || 0);
  const activeRedirections = Number((await this.queryOne('SELECT COUNT(*) as count FROM redirections WHERE is_active = TRUE', []))?.count || 0);
  const totalRedirectionClicks = Number((await this.queryOne('SELECT COALESCE(SUM(click_count), 0) as count FROM redirections', []))?.count || 0);

  const avgDomainsPerUser = totalUsers > 0 ? totalDomains / totalUsers : 0;
  const avgMembersPerTeam = totalTeams > 0 ? teamMembersCount / totalTeams : 0;

  return {
    totalUsers,
    adminCount,
    totalDomains,
    activeDomains,
    sslEnabledDomains,
    activeSSLDomains,
    httpProxies,
    tcpProxies,
    udpProxies,
    totalTeams,
    teamMembersCount,
    avgMembersPerTeam,
    totalRedirections,
    activeRedirections,
    totalRedirectionClicks,
    avgDomainsPerUser
  };
}
}
