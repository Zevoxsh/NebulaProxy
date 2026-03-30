import { useState, useEffect } from 'react';
import { BarChart3, TrendingUp, Activity, AlertCircle, Users, Globe, Shield, Link2 } from 'lucide-react';
import { adminAPI } from '../../api/client';
import {
  AdminStatCard,
  AdminCard,
  AdminCardHeader,
  AdminCardTitle,
  AdminCardContent,
  AdminAlert,
  AdminAlertDescription
} from '@/components/admin';
import { Skeleton } from '@/components/ui/skeleton';

export default function AdminStats() {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchStats();
  }, []);

  const fetchStats = async () => {
    try {
      setLoading(true);
      setError('');
      const response = await adminAPI.getStats();
      setStats(response.data.stats);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to load statistics');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-6" data-admin-theme>
        <div className="mb-6">
          <Skeleton className="h-8 w-64 bg-admin-border mb-2" />
          <Skeleton className="h-4 w-96 bg-admin-border" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {[...Array(4)].map((_, i) => (
            <Skeleton key={i} className="h-32 bg-admin-border" />
          ))}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {[...Array(4)].map((_, i) => (
            <Skeleton key={i} className="h-64 bg-admin-border" />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div data-admin-theme>
        <AdminAlert variant="danger">
          <AlertCircle className="h-4 w-4" />
          <AdminAlertDescription>{error}</AdminAlertDescription>
        </AdminAlert>
      </div>
    );
  }

  return (
    <div data-admin-theme className="space-y-6">
      {/* Page Header */}
      <div className="mb-6">
        <h1 className="text-3xl font-semibold text-admin-text mb-2">Analytics & Statistics</h1>
        <p className="text-admin-text-muted">Detailed system usage and performance metrics</p>
      </div>

      {/* Overview Stats */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <AdminStatCard
          title="Total Users"
          value={stats?.totalUsers || 0}
          icon={Users}
        />
        <AdminStatCard
          title="Total Domains"
          value={stats?.totalDomains || 0}
          icon={Globe}
        />
        <AdminStatCard
          title="Total Teams"
          value={stats?.totalTeams || 0}
          icon={Shield}
        />
        <AdminStatCard
          title="Total Redirections"
          value={stats?.totalRedirections || 0}
          icon={Link2}
        />
      </div>

      {/* Detailed Stats */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* User Statistics */}
        <AdminCard>
          <AdminCardHeader>
            <AdminCardTitle>User Statistics</AdminCardTitle>
          </AdminCardHeader>
          <AdminCardContent className="pt-6">
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <span className="text-admin-text-muted">Total Users</span>
                <span className="text-admin-text font-semibold">{stats?.totalUsers || 0}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-admin-text-muted">Administrators</span>
                <span className="text-admin-text font-semibold">{stats?.adminCount || 0}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-admin-text-muted">Regular Users</span>
                <span className="text-admin-text font-semibold">
                  {(stats?.totalUsers || 0) - (stats?.adminCount || 0)}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-admin-text-muted">Avg Domains/User</span>
                <span className="text-admin-text font-semibold">
                  {stats?.avgDomainsPerUser?.toFixed(2) || '0.00'}
                </span>
              </div>
            </div>
          </AdminCardContent>
        </AdminCard>

        {/* Domain Statistics */}
        <AdminCard>
          <AdminCardHeader>
            <AdminCardTitle>Domain Statistics</AdminCardTitle>
          </AdminCardHeader>
          <AdminCardContent className="pt-6">
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <span className="text-admin-text-muted">Total Domains</span>
                <span className="text-admin-text font-semibold">{stats?.totalDomains || 0}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-admin-text-muted">Active Domains</span>
                <span className="text-admin-text font-semibold">{stats?.activeDomains || 0}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-admin-text-muted">SSL Enabled</span>
                <span className="text-admin-text font-semibold">{stats?.sslEnabledDomains || 0}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-admin-text-muted">HTTP Proxies</span>
                <span className="text-admin-text font-semibold">{stats?.httpProxies || 0}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-admin-text-muted">TCP Proxies</span>
                <span className="text-admin-text font-semibold">{stats?.tcpProxies || 0}</span>
              </div>
            </div>
          </AdminCardContent>
        </AdminCard>

        {/* Team Statistics */}
        <AdminCard>
          <AdminCardHeader>
            <AdminCardTitle>Team Statistics</AdminCardTitle>
          </AdminCardHeader>
          <AdminCardContent className="pt-6">
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <span className="text-admin-text-muted">Total Teams</span>
                <span className="text-admin-text font-semibold">{stats?.totalTeams || 0}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-admin-text-muted">Team Members</span>
                <span className="text-admin-text font-semibold">{stats?.teamMembersCount || 0}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-admin-text-muted">Avg Members/Team</span>
                <span className="text-admin-text font-semibold">
                  {stats?.avgMembersPerTeam?.toFixed(2) || '0.00'}
                </span>
              </div>
            </div>
          </AdminCardContent>
        </AdminCard>

        {/* Redirection Statistics */}
        <AdminCard>
          <AdminCardHeader>
            <AdminCardTitle>Redirection Statistics</AdminCardTitle>
          </AdminCardHeader>
          <AdminCardContent className="pt-6">
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <span className="text-admin-text-muted">Total Redirections</span>
                <span className="text-admin-text font-semibold">{stats?.totalRedirections || 0}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-admin-text-muted">Active Redirections</span>
                <span className="text-admin-text font-semibold">{stats?.activeRedirections || 0}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-admin-text-muted">Total Clicks</span>
                <span className="text-admin-text font-semibold">
                  {stats?.totalRedirectionClicks?.toLocaleString() || 0}
                </span>
              </div>
            </div>
          </AdminCardContent>
        </AdminCard>
      </div>
    </div>
  );
}
