import { useCallback, useEffect, useMemo, useState } from 'react';
import { Download, Upload, RefreshCw, Trash2, Database, HardDrive, ShieldAlert, Cloud, CloudOff, Eye, EyeOff } from 'lucide-react';
import { adminAPI } from '../../api/client';

// ─── S3 Config Panel ─────────────────────────────────────────────────────────
function S3ConfigPanel() {
  const [config, setConfig] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [s3Backups, setS3Backups] = useState([]);
  const [s3Loading, setS3Loading] = useState(false);
  const [showSecret, setShowSecret] = useState(false);
  const [status, setStatus] = useState({ type: '', msg: '' });
  const [busyUpload, setBusyUpload] = useState('');

  const showMsg = (type, msg) => {
    setStatus({ type, msg });
    setTimeout(() => setStatus({ type: '', msg: '' }), 5000);
  };

  useEffect(() => {
    adminAPI.getS3BackupConfig()
      .then(r => setConfig(r.data.config))
      .catch(() => showMsg('error', 'Failed to load S3 config'))
      .finally(() => setLoading(false));
  }, []);

  const loadS3Backups = useCallback(async () => {
    setS3Loading(true);
    try {
      const r = await adminAPI.listS3Backups();
      setS3Backups(r.data.backups || []);
    } catch {
      showMsg('error', 'Failed to list S3 backups');
    } finally {
      setS3Loading(false);
    }
  }, []);

  useEffect(() => {
    if (config?.enabled) loadS3Backups();
  }, [config?.enabled, loadS3Backups]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const r = await adminAPI.saveS3BackupConfig(config);
      setConfig(r.data.config);
      showMsg('success', 'S3 configuration saved');
    } catch (err) {
      showMsg('error', err.response?.data?.message || 'Failed to save S3 config');
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    try {
      const r = await adminAPI.testS3BackupConnection();
      showMsg('success', `Connection OK — bucket "${r.data.bucket}" reachable`);
    } catch (err) {
      showMsg('error', err.response?.data?.error || err.response?.data?.message || 'Connection failed');
    } finally {
      setTesting(false);
    }
  };

  const handleDeleteS3 = async (key) => {
    if (!confirm(`Delete this backup from S3?\n${key}`)) return;
    try {
      await adminAPI.deleteS3Backup(key);
      showMsg('success', 'S3 backup deleted');
      loadS3Backups();
    } catch (err) {
      showMsg('error', err.response?.data?.message || 'Failed to delete S3 backup');
    }
  };

  const set = (field, value) => setConfig(c => ({ ...c, [field]: value }));

  if (loading) return <div className="text-sm text-admin-text-muted py-4">Loading S3 config...</div>;
  if (!config) return null;

  return (
    <div className="rounded-xl border border-admin-border bg-admin-card overflow-hidden">
      <div className="px-4 py-3 border-b border-admin-border flex items-center gap-2">
        {config.enabled
          ? <Cloud className="w-4 h-4 text-emerald-400" />
          : <CloudOff className="w-4 h-4 text-admin-text-muted" />}
        <span className="font-medium text-admin-text">S3 Cloud Backup</span>
        <label className="ml-auto flex items-center gap-2 cursor-pointer select-none text-sm text-admin-text-muted">
          <span>Enabled</span>
          <input
            type="checkbox"
            checked={config.enabled}
            onChange={e => set('enabled', e.target.checked)}
            className="w-4 h-4 accent-emerald-500"
          />
        </label>
      </div>

      <div className="p-4 space-y-4">
        {status.msg && (
          <div className={`rounded-lg border px-4 py-3 text-sm ${
            status.type === 'error'
              ? 'border-red-500/40 bg-red-500/10 text-red-200'
              : 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200'
          }`}>{status.msg}</div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs text-admin-text-muted mb-1">Endpoint URL</label>
            <input
              className="w-full rounded-lg border border-admin-border bg-admin-bg px-3 py-2 text-sm text-admin-text focus:outline-none focus:border-purple-500/60"
              placeholder="https://s3.example.com"
              value={config.endpoint || ''}
              onChange={e => set('endpoint', e.target.value)}
            />
          </div>
          <div>
            <label className="block text-xs text-admin-text-muted mb-1">Region</label>
            <input
              className="w-full rounded-lg border border-admin-border bg-admin-bg px-3 py-2 text-sm text-admin-text focus:outline-none focus:border-purple-500/60"
              placeholder="us-east-1"
              value={config.region || ''}
              onChange={e => set('region', e.target.value)}
            />
          </div>
          <div>
            <label className="block text-xs text-admin-text-muted mb-1">Access Key</label>
            <input
              className="w-full rounded-lg border border-admin-border bg-admin-bg px-3 py-2 text-sm text-admin-text focus:outline-none focus:border-purple-500/60 font-mono"
              placeholder="Access key ID"
              value={config.access_key || ''}
              onChange={e => set('access_key', e.target.value)}
            />
          </div>
          <div>
            <label className="block text-xs text-admin-text-muted mb-1">Secret Key</label>
            <div className="relative">
              <input
                className="w-full rounded-lg border border-admin-border bg-admin-bg px-3 py-2 pr-10 text-sm text-admin-text focus:outline-none focus:border-purple-500/60 font-mono"
                type={showSecret ? 'text' : 'password'}
                placeholder="Secret access key"
                value={config.secret_key || ''}
                onChange={e => set('secret_key', e.target.value)}
              />
              <button
                type="button"
                className="absolute right-2 top-1/2 -translate-y-1/2 text-admin-text-muted hover:text-admin-text"
                onClick={() => setShowSecret(s => !s)}
              >
                {showSecret ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>
          <div>
            <label className="block text-xs text-admin-text-muted mb-1">Bucket</label>
            <input
              className="w-full rounded-lg border border-admin-border bg-admin-bg px-3 py-2 text-sm text-admin-text focus:outline-none focus:border-purple-500/60 font-mono"
              placeholder="nebula"
              value={config.bucket || ''}
              onChange={e => set('bucket', e.target.value)}
            />
          </div>
          <div>
            <label className="block text-xs text-admin-text-muted mb-1">Prefix (folder)</label>
            <input
              className="w-full rounded-lg border border-admin-border bg-admin-bg px-3 py-2 text-sm text-admin-text focus:outline-none focus:border-purple-500/60 font-mono"
              placeholder="backups/"
              value={config.prefix || ''}
              onChange={e => set('prefix', e.target.value)}
            />
          </div>
          <div>
            <label className="block text-xs text-admin-text-muted mb-1">Retention (keep last N backups)</label>
            <input
              type="number"
              min={1} max={100}
              className="w-full rounded-lg border border-admin-border bg-admin-bg px-3 py-2 text-sm text-admin-text focus:outline-none focus:border-purple-500/60"
              value={config.retention_count || 7}
              onChange={e => set('retention_count', parseInt(e.target.value) || 7)}
            />
          </div>
          <div className="flex items-center gap-3 pt-1">
            <input
              type="checkbox"
              id="force_path_style"
              checked={config.force_path_style !== false}
              onChange={e => set('force_path_style', e.target.checked)}
              className="w-4 h-4 accent-purple-500"
            />
            <label htmlFor="force_path_style" className="text-sm text-admin-text-muted cursor-pointer">
              Force path-style URLs <span className="text-xs">(requis pour MinIO et la plupart des providers S3-compatibles)</span>
            </label>
          </div>
        </div>

        <div className="flex flex-wrap gap-3 pt-1">
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="btn-primary text-sm px-4 py-2"
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
          <button
            type="button"
            onClick={handleTest}
            disabled={testing}
            className="btn-secondary text-sm px-4 py-2"
          >
            {testing ? 'Testing...' : 'Test Connection'}
          </button>
          {config.enabled && (
            <button
              type="button"
              onClick={loadS3Backups}
              disabled={s3Loading}
              className="btn-secondary inline-flex items-center gap-1.5 text-sm px-4 py-2"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${s3Loading ? 'animate-spin' : ''}`} />
              Refresh S3 list
            </button>
          )}
        </div>

        {config.enabled && (
          <div className="pt-2">
            <div className="text-xs text-admin-text-muted uppercase tracking-wide mb-2">S3 Backups</div>
            {s3Loading ? (
              <div className="text-sm text-admin-text-muted">Loading...</div>
            ) : s3Backups.length === 0 ? (
              <div className="text-sm text-admin-text-muted">No backups in S3 yet.</div>
            ) : (
              <div className="rounded-lg border border-admin-border overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs uppercase tracking-wide text-admin-text-muted border-b border-admin-border">
                      <th className="px-3 py-2 text-left">File</th>
                      <th className="px-3 py-2 text-left">Size</th>
                      <th className="px-3 py-2 text-left">Date</th>
                      <th className="px-3 py-2"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {s3Backups.map(b => (
                      <tr key={b.key} className="border-b border-admin-border/60 last:border-0">
                        <td className="px-3 py-2 text-admin-text font-mono text-xs">{b.filename}</td>
                        <td className="px-3 py-2 text-admin-text-muted">{b.sizeFormatted}</td>
                        <td className="px-3 py-2 text-admin-text-muted">{formatDate(b.created_at)}</td>
                        <td className="px-3 py-2">
                          <button
                            type="button"
                            onClick={() => handleDeleteS3(b.key)}
                            className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs text-red-300 hover:bg-red-500/10 transition-colors"
                          >
                            <Trash2 className="w-3 h-3" />
                            Delete
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString();
}

export default function AdminBackups() {
  const [stats, setStats] = useState(null);
  const [backups, setBackups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyAction, setBusyAction] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [jobStatus, setJobStatus] = useState(null);

  const sortedBackups = useMemo(
    () => [...backups].sort((a, b) => new Date(b.created_at) - new Date(a.created_at)),
    [backups]
  );

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const [statsRes, backupsRes] = await Promise.all([
        adminAPI.getDatabaseStats(),
        adminAPI.listDatabaseBackups()
      ]);
      setStats(statsRes.data?.stats || null);
      setBackups(backupsRes.data?.backups || []);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to load database backup data.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleCreateBackup = async () => {
    try {
      setBusyAction('create');
      setError('');
      setSuccess('');
      const response = await adminAPI.createDatabaseBackup();
      const job = response.data?.job;

      if (!job?.id) {
        setSuccess('Backup request accepted. Refreshing list...');
        await loadData();
        return;
      }

      setJobStatus(job);
      setSuccess('Backup started in background...');

      const startedAt = Date.now();
      const timeoutMs = 10 * 60 * 1000;

      while (Date.now() - startedAt < timeoutMs) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
        const jobRes = await adminAPI.getDatabaseBackupJob(job.id);
        const currentJob = jobRes.data?.job;
        if (!currentJob) continue;

        setJobStatus(currentJob);

        if (currentJob.status === 'completed') {
          setSuccess('Backup completed successfully.');
          await loadData();
          return;
        }

        if (currentJob.status === 'failed') {
          throw new Error(currentJob.error || 'Backup failed');
        }
      }

      setSuccess('Backup is still running in background. Refresh in a few moments.');
    } catch (err) {
      setError(err.response?.data?.message || err.message || 'Failed to create backup.');
    } finally {
      setBusyAction('');
    }
  };

  const handleDownload = async (filename) => {
    try {
      setBusyAction(`download:${filename}`);
      setError('');
      setSuccess('');
      const response = await adminAPI.downloadDatabaseBackup(filename);
      // response.data is already a Blob when responseType is 'blob' — no need to rewrap
      const url = window.URL.createObjectURL(response.data);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      // Delay revocation to ensure the browser has initiated the download
      setTimeout(() => window.URL.revokeObjectURL(url), 10000);
      setSuccess(`Backup ${filename} downloaded.`);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to download backup.');
    } finally {
      setBusyAction('');
    }
  };

  const handleRestore = async (filename) => {
    const ok = window.confirm(
      `Restore backup ${filename}?\n\nThis will overwrite current database data.`
    );
    if (!ok) return;

    try {
      setBusyAction(`restore:${filename}`);
      setError('');
      setSuccess('');
      await adminAPI.restoreDatabaseBackup(filename);
      setSuccess(`Backup ${filename} restored successfully.`);
      await loadData();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to restore backup.');
    } finally {
      setBusyAction('');
    }
  };

  const handleDelete = async (filename) => {
    const ok = window.confirm(`Delete backup ${filename}?`);
    if (!ok) return;

    try {
      setBusyAction(`delete:${filename}`);
      setError('');
      setSuccess('');
      await adminAPI.deleteDatabaseBackup(filename);
      setSuccess(`Backup ${filename} deleted.`);
      await loadData();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to delete backup.');
    } finally {
      setBusyAction('');
    }
  };

  const handleUploadToS3 = async (filename) => {
    try {
      setBusyAction(`s3upload:${filename}`);
      setError('');
      setSuccess('');

      const res = await adminAPI.uploadBackupToS3(filename);
      const { jobId } = res.data;

      setSuccess(`Uploading ${filename} to S3...`);

      const started = Date.now();
      const timeout = 30 * 60 * 1000; // 30 min max
      while (Date.now() - started < timeout) {
        await new Promise(r => setTimeout(r, 3000));
        const pollRes = await adminAPI.getS3UploadJob(jobId);
        const job = pollRes.data?.job;
        if (!job) continue;
        if (job.status === 'completed') {
          setSuccess(`Backup ${filename} uploaded to S3 successfully.`);
          return;
        }
        if (job.status === 'failed') {
          throw new Error(job.error || 'S3 upload failed');
        }
      }
      setSuccess('S3 upload is still running in the background.');
    } catch (err) {
      setError(err.response?.data?.error || err.response?.data?.message || err.message || 'Failed to upload to S3. Check your S3 configuration.');
    } finally {
      setBusyAction('');
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-admin-text">Database Backups</h1>
        <p className="text-admin-text-muted mt-1">Export and restore your database from the admin web panel.</p>
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {error}
        </div>
      )}

      {success && (
        <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
          {success}
        </div>
      )}

      {jobStatus && (
        <div className="rounded-lg border border-blue-500/40 bg-blue-500/10 px-4 py-3 text-sm text-blue-200">
          Backup job: {jobStatus.status}
          {jobStatus.started_at ? ` • started ${formatDate(jobStatus.started_at)}` : ''}
          {jobStatus.finished_at ? ` • finished ${formatDate(jobStatus.finished_at)}` : ''}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="rounded-xl border border-admin-border bg-admin-card p-4">
          <div className="text-admin-text-muted text-xs uppercase tracking-wide">Database Size</div>
          <div className="mt-2 text-xl text-admin-text font-semibold">{stats?.size || '—'}</div>
        </div>
        <div className="rounded-xl border border-admin-border bg-admin-card p-4">
          <div className="text-admin-text-muted text-xs uppercase tracking-wide">Tables</div>
          <div className="mt-2 text-xl text-admin-text font-semibold">{stats?.tableCount ?? '—'}</div>
        </div>
        <div className="rounded-xl border border-admin-border bg-admin-card p-4">
          <div className="text-admin-text-muted text-xs uppercase tracking-wide">Rows</div>
          <div className="mt-2 text-xl text-admin-text font-semibold">{stats?.totalRows ?? '—'}</div>
        </div>
      </div>

      <div className="rounded-xl border border-admin-border bg-admin-card p-4 flex flex-wrap gap-3">
        <button
          type="button"
          onClick={handleCreateBackup}
          disabled={busyAction !== ''}
          className="btn-primary inline-flex items-center gap-2"
        >
          <Database className="w-4 h-4" />
          {busyAction === 'create' ? 'Creating...' : 'Create Backup'}
        </button>

        <button
          type="button"
          onClick={loadData}
          disabled={busyAction !== '' || loading}
          className="btn-secondary inline-flex items-center gap-2"
        >
          <RefreshCw className="w-4 h-4" />
          Refresh
        </button>
      </div>

      <div className="rounded-xl border border-admin-border bg-admin-card overflow-hidden">
        <div className="px-4 py-3 border-b border-admin-border flex items-center gap-2 text-admin-text">
          <HardDrive className="w-4 h-4" />
          <span className="font-medium">Available Backups</span>
        </div>

        {loading ? (
          <div className="px-4 py-8 text-sm text-admin-text-muted">Loading backups...</div>
        ) : sortedBackups.length === 0 ? (
          <div className="px-4 py-8 text-sm text-admin-text-muted">No backups found. Create one first.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px]">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-admin-text-muted border-b border-admin-border">
                  <th className="px-4 py-3">Filename</th>
                  <th className="px-4 py-3">Size</th>
                  <th className="px-4 py-3">Created</th>
                  <th className="px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {sortedBackups.map((backup) => {
                  const isDownloading  = busyAction === `download:${backup.filename}`;
                  const isRestoring    = busyAction === `restore:${backup.filename}`;
                  const isDeleting     = busyAction === `delete:${backup.filename}`;
                  const isS3Uploading  = busyAction === `s3upload:${backup.filename}`;

                  return (
                    <tr key={backup.filename} className="border-b border-admin-border/60 last:border-0">
                      <td className="px-4 py-3 text-sm text-admin-text">
                        <div className="flex items-center gap-2">
                          {backup.uploaded_to_s3 && (
                            <Cloud className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" title="In S3" />
                          )}
                          {backup.filename}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-sm text-admin-text-muted">{backup.sizeFormatted || backup.size || '—'}</td>
                      <td className="px-4 py-3 text-sm text-admin-text-muted">{formatDate(backup.created_at)}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2 flex-wrap">
                          <button
                            type="button"
                            onClick={() => handleDownload(backup.filename)}
                            disabled={busyAction !== ''}
                            className="btn-secondary inline-flex items-center gap-1 px-2.5 py-1.5 text-xs"
                          >
                            <Download className="w-3.5 h-3.5" />
                            {isDownloading ? 'Downloading...' : 'Export'}
                          </button>
                          <button
                            type="button"
                            onClick={() => handleRestore(backup.filename)}
                            disabled={busyAction !== ''}
                            className="btn-secondary inline-flex items-center gap-1 px-2.5 py-1.5 text-xs"
                          >
                            <Upload className="w-3.5 h-3.5" />
                            {isRestoring ? 'Restoring...' : 'Reimport'}
                          </button>
                          <button
                            type="button"
                            onClick={() => handleUploadToS3(backup.filename)}
                            disabled={busyAction !== ''}
                            className="btn-secondary inline-flex items-center gap-1 px-2.5 py-1.5 text-xs text-emerald-300"
                            title="Upload to S3"
                          >
                            <Cloud className="w-3.5 h-3.5" />
                            {isS3Uploading ? 'Uploading...' : 'S3'}
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDelete(backup.filename)}
                            disabled={busyAction !== ''}
                            className="btn-secondary inline-flex items-center gap-1 px-2.5 py-1.5 text-xs text-red-300"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            {isDeleting ? 'Deleting...' : 'Delete'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <S3ConfigPanel />

      <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-100 flex items-start gap-2">
        <ShieldAlert className="w-4 h-4 mt-0.5" />
        <p>
          Reimport will overwrite current data. Always create a fresh backup first.
        </p>
      </div>
    </div>
  );
}
