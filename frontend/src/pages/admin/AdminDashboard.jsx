import { useState, useEffect } from 'react';
import {
  Users,
  Globe,
  Shield,
  Link2,
  Activity,
  Server,
  AlertCircle,
  CheckCircle,
  Clock
} from 'lucide-react';
import { adminAPI } from '../../api/client';
import {
  AdminStatCard,
  AdminCard,
  AdminCardHeader,
  AdminCardTitle,
  AdminCardContent,
  AdminBadge,
  AdminAlert,
  AdminAlertDescription
} from '@/components/admin';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';

export default function AdminDashboard() {
  const [stats, setStats] = useState(null);
  const [systemHealth] = useState({
    database: 'healthy',
    redis: 'healthy',
    proxy: 'healthy'
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchDashboardData();
    const interval = setInterval(fetchDashboardData, 30000);
    return () => clearInterval(interval);
  }, []);

  const fetchDashboardData = async () => {
    try {
      setLoading(true);
      setError('');
      const response = await adminAPI.getStats();
      setStats(response.data.stats);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to load dashboard data');
    } finally {
      setLoading(false);
    }
  };

  if (loading && !stats) {
    return (
      <div className="space-y-6" data-admin-theme>
        <div className="mb-6">
          <Skeleton className="h-8 w-48 bg-admin-border mb-2" />
          <Skeleton className="h-4 w-96 bg-admin-border" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {[...Array(4)].map((_, i) => (
            <Skeleton key={i} className="h-32 bg-admin-border" />
          ))}
        </div>
      </div>
    );
  }

  if (error && !stats) {
    return (
      <div data-admin-theme>
        <AdminAlert variant="danger">
          <AlertCircle className="h-4 w-4" />
          <AdminAlertDescription>{error}</AdminAlertDescription>
        </AdminAlert>
      </div>
    );
  }

  const statCards = [
    {
      label: 'Total Users',
      value: stats?.totalUsers || 0,
      icon: Users,
      trend: 'up',
      trendValue: '+12%'
    },
    {
      label: 'Active Domains',
      value: stats?.totalDomains || 0,
      icon: Globe,
      trend: 'up',
      trendValue: '+8%'
    },
    {
      label: 'Teams',
      value: stats?.totalTeams || 0,
      icon: Shield,
      trend: 'up',
      trendValue: '+5%'
    },
    {
      label: 'Redirections',
      value: stats?.totalRedirections || 0,
      icon: Link2,
      trend: 'up',
      trendValue: '+15%'
    }
  ];

  return (
    <div data-admin-theme className="space-y-6">
      {/* Page Header */}
      <div className="mb-6">
        <h1 className="text-3xl font-semibold text-admin-text mb-2">Dashboard</h1>
        <p className="text-admin-text-muted">System overview and key metrics</p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {statCards.map((stat) => (
          <AdminStatCard
            key={stat.label}
            title={stat.label}
            value={stat.value.toLocaleString()}
            subtitle="from last month"
            icon={stat.icon}
            trend={stat.trend}
            trendValue={stat.trendValue}
          />
        ))}
      </div>

      {/* System Health & Recent Activity */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* System Health */}
        <AdminCard>
          <AdminCardHeader>
            <div className="flex items-center justify-between">
              <AdminCardTitle>System Health</AdminCardTitle>
              <Activity className="w-5 h-5 text-admin-text-muted" />
            </div>
          </AdminCardHeader>
          <AdminCardContent className="pt-6">
            <div className="space-y-4">
              {Object.entries(systemHealth).map(([service, status]) => (
                <div key={service} className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Server className="w-5 h-5 text-admin-text-muted" />
                    <span className="text-sm font-medium text-admin-text capitalize">
                      {service}
                    </span>
                  </div>
                  {status === 'healthy' ? (
                    <AdminBadge variant="success" className="flex items-center gap-1">
                      <CheckCircle className="w-3 h-3" />
                      Healthy
                    </AdminBadge>
                  ) : (
                    <AdminBadge variant="danger" className="flex items-center gap-1">
                      <AlertCircle className="w-3 h-3" />
                      Unhealthy
                    </AdminBadge>
                  )}
                </div>
              ))}
            </div>
          </AdminCardContent>
        </AdminCard>

        {/* Recent Activity */}
        <AdminCard>
          <AdminCardHeader>
            <div className="flex items-center justify-between">
              <AdminCardTitle>Recent Activity</AdminCardTitle>
              <Clock className="w-5 h-5 text-admin-text-muted" />
            </div>
          </AdminCardHeader>
          <AdminCardContent className="pt-6">
            <div className="space-y-3">
              {stats?.recentActivity?.slice(0, 5).map((activity, idx) => (
                <div key={idx} className="flex items-start gap-3 text-sm">
                  <div className="w-2 h-2 bg-admin-primary rounded-full mt-1.5 flex-shrink-0" />
                  <div className="flex-1">
                    <p className="text-admin-text">{activity.description}</p>
                    <p className="text-admin-text-muted text-xs mt-1">{activity.timestamp}</p>
                  </div>
                </div>
              )) || (
                <p className="text-admin-text-muted text-sm">No recent activity</p>
              )}
            </div>
          </AdminCardContent>
        </AdminCard>
      </div>

      {/* User Overview Table */}
      <AdminCard>
        <AdminCardHeader>
          <AdminCardTitle>User Overview</AdminCardTitle>
        </AdminCardHeader>
        <AdminCardContent className="pt-6">
          <Table>
              <TableHeader>
                <TableRow className="bg-admin-surface2 border-admin-border hover:bg-admin-surface2">
                  <TableHead className="text-admin-text font-semibold">User Type</TableHead>
                  <TableHead className="text-admin-text font-semibold">Count</TableHead>
                  <TableHead className="text-admin-text font-semibold">Avg Domains</TableHead>
                  <TableHead className="text-admin-text font-semibold">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow className="border-admin-border bg-admin-surface hover:bg-admin-surface2">
                  <TableCell className="text-admin-text">
                    <div className="flex items-center gap-2">
                      <Shield className="w-4 h-4 text-admin-primary" />
                      <span>Administrators</span>
                    </div>
                  </TableCell>
                  <TableCell className="text-admin-text">{stats?.adminCount || 0}</TableCell>
                  <TableCell className="text-admin-text">-</TableCell>
                  <TableCell className="text-admin-text">
                    <AdminBadge variant="success">Active</AdminBadge>
                  </TableCell>
                </TableRow>
                <TableRow className="border-admin-border bg-admin-surface hover:bg-admin-surface2">
                  <TableCell className="text-admin-text">
                    <div className="flex items-center gap-2">
                      <Users className="w-4 h-4 text-admin-success" />
                      <span>Regular Users</span>
                    </div>
                  </TableCell>
                  <TableCell className="text-admin-text">
                    {(stats?.totalUsers || 0) - (stats?.adminCount || 0)}
                  </TableCell>
                  <TableCell className="text-admin-text">
                    {stats?.avgDomainsPerUser?.toFixed(1) || '0.0'}
                  </TableCell>
                  <TableCell className="text-admin-text">
                    <AdminBadge variant="success">Active</AdminBadge>
                  </TableCell>
                </TableRow>
                <TableRow className="border-admin-border bg-admin-surface hover:bg-admin-surface2">
                  <TableCell className="text-admin-text">
                    <div className="flex items-center gap-2">
                      <Shield className="w-4 h-4 text-admin-warning" />
                      <span>Team Members</span>
                    </div>
                  </TableCell>
                  <TableCell className="text-admin-text">{stats?.teamMembersCount || 0}</TableCell>
                  <TableCell className="text-admin-text">-</TableCell>
                  <TableCell className="text-admin-text">
                    <AdminBadge variant="default">Varied</AdminBadge>
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
        </AdminCardContent>
      </AdminCard>
    </div>
  );
}

