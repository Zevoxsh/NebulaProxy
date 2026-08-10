# Admin Panel

Admin console centralizes platform management.

## Main Modules
- Global dashboard (system health, recent activity)
- User management (activation, quotas, roles)
- Domain and domain group management
- Team and redirect management
- Monitoring and logs
- System configuration
- Docker services control
- Notifications (SMTP, webhooks)
- Database backups
- Updates and audit trail

## Related Admin Endpoints
Examples:
- `/api/admin/stats`
- `/api/admin/users`
- `/api/admin/domains`
- `/api/admin/teams`
- `/api/admin/monitoring/metrics`
- `/api/admin/services/containers`
- `/api/admin/updates/status`
- `/api/admin/audit-logs`

## Operating Guidance
- Keep admin accounts limited.
- Review logs and audit trail regularly.
- Schedule updates outside peak traffic windows.
