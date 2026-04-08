import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Cloud,
  CloudOff,
  Database,
  Download,
  Eye,
  EyeOff,
  HardDrive,
  Layers3,
  Loader2,
  RefreshCw,
  Server,
  ShieldAlert,
  Trash2,
  Upload
} from 'lucide-react';
import { adminAPI } from '../../api/client';
import {
  AdminAlert,
  AdminAlertDescription,
  AdminButton,
  AdminCard,
  AdminCardContent,
  AdminCardHeader,
  AdminCardTitle
} from '@/components/admin';

const LOCAL_BACKUP_LIMIT = 3;
const CLOUD_BACKUP_LIMIT = 5;

const FREQUENCIES = [
  { value: 'hourly', label: 'Toutes les heures' },
  { value: 'daily', label: 'Journalier' },
  { value: 'weekly', label: 'Hebdomadaire' },
  { value: 'monthly', label: 'Mensuel' }
];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatDate(value) {
  if (!value) return '-';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
}

function formatSize(value) {
  if (value === null || value === undefined || value === '') return '-';
  if (typeof value === 'string') return value;
  const bytes = Number(value);
  if (!Number.isFinite(bytes)) return String(value);
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = bytes;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size.toFixed(size >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function StatCard({ label, value, hint, icon, accent = 'text-admin-text' }) {
  return (
    <div className="rounded-2xl border border-admin-border bg-admin-bg p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[11px] uppercase tracking-[0.18em] text-admin-text-muted">{label}</div>
          <div className={`mt-2 text-2xl font-semibold ${accent}`}>{value}</div>
        </div>
        <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-admin-border bg-admin-surface text-admin-text">
          {icon}
        </div>
      </div>
      {hint && <div className="mt-3 text-xs text-admin-text-muted">{hint}</div>}
    </div>
  );
}

function BackupSchedulePanel({ scope, title, schedule, onSave, saving }) {
  const current = schedule?.[scope] || {
    enabled: false,
    frequency: 'daily',
    time: '02:00'
  };

  const [form, setForm] = useState(current);

  useEffect(() => {
    setForm(current);
  }, [current.enabled, current.frequency, current.time]);

  const update = (field, value) => {
    setForm((old) => ({ ...old, [field]: value }));
  };

  return (
    <AdminCard>
      <AdminCardHeader>
        <div className="flex items-center justify-between gap-3">
          <div>
            <AdminCardTitle>{title}</AdminCardTitle>
            <p className="mt-1 text-sm text-admin-text-muted">Planifie en horaire, journalier, hebdo, ou mensuel.</p>
          </div>
          <label className="inline-flex items-center gap-3 rounded-2xl border border-admin-border bg-admin-surface px-4 py-3 text-sm text-admin-text-muted">
            <span>{form.enabled ? 'Activé' : 'Désactivé'}</span>
            <input
              type="checkbox"
              checked={Boolean(form.enabled)}
              onChange={(event) => update('enabled', event.target.checked)}
              className="h-4 w-4 accent-white"
            />
          </label>
        </div>
      </AdminCardHeader>
      <AdminCardContent className="pt-0 space-y-4">
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs uppercase tracking-[0.15em] text-admin-text-muted">Fréquence</label>
            <select
              value={form.frequency}
              onChange={(event) => update('frequency', event.target.value)}
              className="w-full rounded-2xl border border-admin-border bg-admin-bg px-4 py-3 text-sm text-admin-text focus:border-admin-primary focus:outline-none"
            >
              {FREQUENCIES.map((frequency) => (
                <option key={frequency.value} value={frequency.value}>{frequency.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs uppercase tracking-[0.15em] text-admin-text-muted">Heure (HH:MM)</label>
            <input
              type="time"
              value={form.time || '02:00'}
              onChange={(event) => update('time', event.target.value)}
              className="w-full rounded-2xl border border-admin-border bg-admin-bg px-4 py-3 text-sm text-admin-text focus:border-admin-primary focus:outline-none"
            />
          </div>
        </div>

        <div className="flex justify-end">
          <AdminButton onClick={() => onSave(scope, form)} disabled={saving}>
            {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <CheckCircle2 className="w-4 h-4 mr-2" strokeWidth={1.8} />}
            {saving ? 'Sauvegarde...' : 'Enregistrer la planification'}
          </AdminButton>
        </div>
      </AdminCardContent>
    </AdminCard>
  );
}

function S3ConfigPanel({ onSaved }) {
  const [config, setConfig] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [showSecret, setShowSecret] = useState(false);
  const [status, setStatus] = useState({ type: '', msg: '' });

  const showMsg = useCallback((type, msg) => {
    setStatus({ type, msg });
    window.clearTimeout(showMsg._timer);
    showMsg._timer = window.setTimeout(() => setStatus({ type: '', msg: '' }), 5000);
  }, []);

  useEffect(() => {
    adminAPI.getS3BackupConfig()
      .then((response) => setConfig(response.data.config))
      .catch(() => showMsg('error', 'Impossible de charger la configuration S3'))
      .finally(() => setLoading(false));
  }, [showMsg]);

  const updateField = (field, value) => {
    setConfig((current) => ({ ...current, [field]: value }));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const response = await adminAPI.saveS3BackupConfig(config);
      setConfig(response.data.config);
      showMsg('success', 'Configuration S3 sauvegardee.');
      onSaved?.();
    } catch (error) {
      showMsg('error', error.response?.data?.message || 'Erreur lors de la sauvegarde S3');
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    try {
      const response = await adminAPI.testS3BackupConnection();
      showMsg('success', `Connexion OK vers le bucket "${response.data.bucket}"`);
    } catch (error) {
      showMsg('error', error.response?.data?.error || error.response?.data?.message || 'Connexion S3 impossible');
    } finally {
      setTesting(false);
    }
  };

  if (loading) {
    return (
      <div className="rounded-2xl border border-admin-border bg-admin-bg p-6 text-sm text-admin-text-muted">
        Chargement de la configuration cloud...
      </div>
    );
  }

  if (!config) {
    return null;
  }

  return (
    <AdminCard>
      <AdminCardHeader>
        <div className="flex items-center justify-between w-full gap-4">
          <div className="flex items-center gap-3">
            <Cloud className="w-5 h-5 text-admin-primary" />
            <div>
              <AdminCardTitle>Configuration S3 / MinIO</AdminCardTitle>
              <p className="text-xs text-admin-text-muted mt-0.5">Rention cloud forcee cote serveur: {CLOUD_BACKUP_LIMIT} backups max.</p>
            </div>
          </div>

          <label className="inline-flex items-center gap-3 rounded-2xl border border-admin-border bg-admin-surface px-4 py-3 text-sm text-admin-text-muted">
            <span>{config.enabled ? 'Activé' : 'Désactivé'}</span>
            <input
              type="checkbox"
              checked={Boolean(config.enabled)}
              onChange={(event) => updateField('enabled', event.target.checked)}
              className="h-4 w-4 accent-white"
            />
          </label>
        </div>
      </AdminCardHeader>
      <AdminCardContent className="pt-0 space-y-4">
        {status.msg && (
          <div className={`rounded-2xl border px-4 py-3 text-sm ${status.type === 'error' ? 'border-red-500/30 bg-red-500/10 text-red-200' : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200'}`}>
            {status.msg}
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs uppercase tracking-[0.15em] text-admin-text-muted">Endpoint</label>
            <input
              className="w-full rounded-2xl border border-admin-border bg-admin-bg px-4 py-3 text-sm text-admin-text placeholder:text-admin-text-muted focus:border-admin-primary focus:outline-none"
              placeholder="https://s3.example.com"
              value={config.endpoint || ''}
              onChange={(event) => updateField('endpoint', event.target.value)}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs uppercase tracking-[0.15em] text-admin-text-muted">Region</label>
            <input
              className="w-full rounded-2xl border border-admin-border bg-admin-bg px-4 py-3 text-sm text-admin-text placeholder:text-admin-text-muted focus:border-admin-primary focus:outline-none"
              placeholder="us-east-1"
              value={config.region || ''}
              onChange={(event) => updateField('region', event.target.value)}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs uppercase tracking-[0.15em] text-admin-text-muted">Access Key</label>
            <input
              className="w-full rounded-2xl border border-admin-border bg-admin-bg px-4 py-3 font-mono text-sm text-admin-text placeholder:text-admin-text-muted focus:border-admin-primary focus:outline-none"
              placeholder="Access key ID"
              value={config.access_key || ''}
              onChange={(event) => updateField('access_key', event.target.value)}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs uppercase tracking-[0.15em] text-admin-text-muted">Secret Key</label>
            <div className="relative">
              <input
                className="w-full rounded-2xl border border-admin-border bg-admin-bg px-4 py-3 pr-12 font-mono text-sm text-admin-text placeholder:text-admin-text-muted focus:border-admin-primary focus:outline-none"
                type={showSecret ? 'text' : 'password'}
                placeholder="Secret access key"
                value={config.secret_key || ''}
                onChange={(event) => updateField('secret_key', event.target.value)}
              />
              <button
                type="button"
                onClick={() => setShowSecret((current) => !current)}
                className="absolute right-3 top-1/2 -translate-y-1/2 rounded-lg p-1 text-admin-text-muted transition-colors hover:text-admin-text"
              >
                {showSecret ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs uppercase tracking-[0.15em] text-admin-text-muted">Bucket</label>
            <input
              className="w-full rounded-2xl border border-admin-border bg-admin-bg px-4 py-3 font-mono text-sm text-admin-text placeholder:text-admin-text-muted focus:border-admin-primary focus:outline-none"
              placeholder="nebula"
              value={config.bucket || ''}
              onChange={(event) => updateField('bucket', event.target.value)}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs uppercase tracking-[0.15em] text-admin-text-muted">Prefix</label>
            <input
              className="w-full rounded-2xl border border-admin-border bg-admin-bg px-4 py-3 font-mono text-sm text-admin-text placeholder:text-admin-text-muted focus:border-admin-primary focus:outline-none"
              placeholder="backups/"
              value={config.prefix || ''}
              onChange={(event) => updateField('prefix', event.target.value)}
            />
          </div>
        </div>

        <div className="flex flex-wrap gap-3">
          <AdminButton onClick={handleSave} disabled={saving}>
            {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <CheckCircle2 className="w-4 h-4 mr-2" strokeWidth={1.8} />}
            {saving ? 'Sauvegarde...' : 'Enregistrer la config'}
          </AdminButton>
          <AdminButton variant="secondary" onClick={handleTest} disabled={testing}>
            {testing ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Cloud className="w-4 h-4 mr-2" strokeWidth={1.8} />}
            {testing ? 'Test...' : 'Tester la connexion'}
          </AdminButton>
        </div>
      </AdminCardContent>
    </AdminCard>
  );
}

function CloudBackupsPanel({ refreshToken }) {
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [backups, setBackups] = useState([]);
  const [error, setError] = useState('');

  const loadCloudBackups = useCallback(async () => {
    try {
      setRefreshing(true);
      setError('');
      const configResponse = await adminAPI.getS3BackupConfig();
      const isEnabled = Boolean(configResponse.data?.config?.enabled);
      setEnabled(isEnabled);

      if (!isEnabled) {
        setBackups([]);
        return;
      }

      const backupsResponse = await adminAPI.listS3Backups();
      setBackups(backupsResponse.data?.backups || []);
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Impossible de charger les backups cloud.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadCloudBackups();
  }, [loadCloudBackups, refreshToken]);

  const handleDeleteS3 = async (key) => {
    if (!window.confirm(`Supprimer ce backup S3 ?\n\n${key}`)) {
      return;
    }

    try {
      await adminAPI.deleteS3Backup(key);
      await loadCloudBackups();
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Impossible de supprimer le backup cloud.');
    }
  };

  if (loading) {
    return (
      <div className="rounded-2xl border border-admin-border bg-admin-bg p-6 text-sm text-admin-text-muted">
        Chargement des backups cloud...
      </div>
    );
  }

  return (
    <AdminCard>
      <AdminCardHeader>
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Cloud className="w-5 h-5 text-admin-primary" />
            <div>
              <AdminCardTitle>Backups cloud S3 / MinIO</AdminCardTitle>
              <p className="mt-1 text-sm text-admin-text-muted">Vue des backups stockes dans le bucket cloud.</p>
            </div>
          </div>
          <div className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs ${enabled ? 'bg-emerald-500/10 text-emerald-200' : 'bg-white/[0.04] text-admin-text-muted'}`}>
            {enabled ? <Cloud className="h-3.5 w-3.5" /> : <CloudOff className="h-3.5 w-3.5" />}
            {enabled ? 'Actif' : 'Inactif'}
          </div>
        </div>
      </AdminCardHeader>
      <AdminCardContent className="pt-0 space-y-4">
        <div className="flex flex-wrap gap-3">
          <AdminButton variant="secondary" onClick={loadCloudBackups} disabled={refreshing}>
            {refreshing ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-2" strokeWidth={1.8} />}
            {refreshing ? 'Chargement...' : 'Rafraichir'}
          </AdminButton>
        </div>

        {error && (
          <AdminAlert variant="danger">
            <AdminAlertDescription>{error}</AdminAlertDescription>
          </AdminAlert>
        )}

        {!enabled ? (
          <div className="rounded-2xl border border-admin-border bg-white/[0.03] px-4 py-5 text-sm text-admin-text-muted">
            Le cloud est desactive. Active-le dans la configuration S3.
          </div>
        ) : backups.length === 0 ? (
          <div className="rounded-2xl border border-admin-border bg-white/[0.03] px-4 py-5 text-sm text-admin-text-muted">
            Aucun backup cloud trouve.
          </div>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-admin-border">
            <table className="w-full text-sm">
              <thead className="bg-white/[0.03] text-xs uppercase tracking-[0.15em] text-admin-text-muted">
                <tr>
                  <th className="px-4 py-3 text-left">Fichier</th>
                  <th className="px-4 py-3 text-left">Taille</th>
                  <th className="px-4 py-3 text-left">Date</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {backups.map((backup) => (
                  <tr key={backup.key} className="border-t border-admin-border bg-admin-bg">
                    <td className="px-4 py-3 font-mono text-xs text-admin-text">{backup.filename}</td>
                    <td className="px-4 py-3 text-admin-text-muted">{backup.sizeFormatted || formatSize(backup.size)}</td>
                    <td className="px-4 py-3 text-admin-text-muted">{formatDate(backup.created_at)}</td>
                    <td className="px-4 py-3 text-right">
                      <AdminButton variant="secondary" onClick={() => handleDeleteS3(backup.key)}>
                        <Trash2 className="h-3.5 w-3.5" />
                        Supprimer
                      </AdminButton>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </AdminCardContent>
    </AdminCard>
  );
}

export default function AdminBackups() {
  const [stats, setStats] = useState(null);
  const [backups, setBackups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyAction, setBusyAction] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [jobStatus, setJobStatus] = useState(null);
  const [activeTab, setActiveTab] = useState('local');
  const [schedule, setSchedule] = useState(null);
  const [savingSchedule, setSavingSchedule] = useState(false);
  const [cloudRefreshToken, setCloudRefreshToken] = useState(0);

  const sortedBackups = useMemo(
    () => [...backups].sort((a, b) => new Date(b.created_at) - new Date(a.created_at)),
    [backups]
  );

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const [statsResponse, backupsResponse, scheduleResponse] = await Promise.all([
        adminAPI.getDatabaseStats(),
        adminAPI.listDatabaseBackups(),
        adminAPI.getBackupSchedule()
      ]);
      setStats(statsResponse.data?.stats || null);
      setBackups(backupsResponse.data?.backups || []);
      setSchedule(scheduleResponse.data?.schedule || null);
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Impossible de charger les backups.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const waitBackupJob = useCallback(async (jobId) => {
    const startedAt = Date.now();
    const timeoutMs = 10 * 60 * 1000;

    while (Date.now() - startedAt < timeoutMs) {
      await sleep(2000);
      const jobResponse = await adminAPI.getDatabaseBackupJob(jobId);
      const currentJob = jobResponse.data?.job;
      if (!currentJob) continue;

      setJobStatus(currentJob);

      if (currentJob.status === 'completed') {
        return currentJob;
      }

      if (currentJob.status === 'failed') {
        throw new Error(currentJob.error || 'Le backup a echoue.');
      }
    }

    throw new Error('Timeout du job de backup local.');
  }, []);

  const waitS3Job = useCallback(async (jobId) => {
    const startedAt = Date.now();
    const timeoutMs = 30 * 60 * 1000;

    while (Date.now() - startedAt < timeoutMs) {
      await sleep(3000);
      const jobResponse = await adminAPI.getS3UploadJob(jobId);
      const job = jobResponse.data?.job;
      if (!job) continue;

      if (job.status === 'completed') return;
      if (job.status === 'failed') {
        throw new Error(job.error || 'Echec de l envoi vers S3.');
      }
    }

    throw new Error('Timeout du job S3.');
  }, []);

  const handleCreateLocalBackup = async () => {
    try {
      setBusyAction('create-local');
      setError('');
      setSuccess('');
      const response = await adminAPI.createDatabaseBackup();
      const job = response.data?.job;

      if (!job?.id) {
        setSuccess('La demande de backup local a ete acceptee.');
        await loadData();
        return;
      }

      setJobStatus(job);
      setSuccess('Backup local en cours...');

      await waitBackupJob(job.id);
      setSuccess('Backup local termine avec succes.');
      await loadData();
    } catch (requestError) {
      setError(requestError.response?.data?.message || requestError.message || 'Impossible de creer le backup local.');
    } finally {
      setBusyAction('');
    }
  };

  const handleCreateS3Backup = async () => {
    try {
      setBusyAction('create-s3');
      setError('');
      setSuccess('');

      const createResponse = await adminAPI.createDatabaseBackup();
      const localJob = createResponse.data?.job;
      let filename = null;

      if (localJob?.id) {
        setJobStatus(localJob);
        setSuccess('Creation du backup local avant envoi S3...');
        const finishedJob = await waitBackupJob(localJob.id);
        filename = finishedJob?.backup?.filename || null;
      }

      if (!filename) {
        const listResponse = await adminAPI.listDatabaseBackups();
        const latest = (listResponse.data?.backups || [])
          .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0];
        filename = latest?.filename || null;
      }

      if (!filename) {
        throw new Error('Aucun backup local disponible pour l envoi S3.');
      }

      setSuccess(`Envoi de ${filename} vers S3...`);
      const uploadResponse = await adminAPI.uploadBackupToS3(filename);
      const { jobId } = uploadResponse.data || {};
      if (!jobId) {
        throw new Error('Job S3 introuvable.');
      }

      await waitS3Job(jobId);
      setSuccess(`Backup S3 termine avec succes: ${filename}`);
      setCloudRefreshToken((current) => current + 1);
      await loadData();
    } catch (requestError) {
      setError(requestError.response?.data?.error || requestError.response?.data?.message || requestError.message || 'Impossible de creer le backup S3.');
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
      const url = window.URL.createObjectURL(response.data);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => window.URL.revokeObjectURL(url), 10000);
      setSuccess(`Backup ${filename} telecharge.`);
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Impossible de telecharger le backup.');
    } finally {
      setBusyAction('');
    }
  };

  const handleRestore = async (filename) => {
    if (!window.confirm(`Restaurer le backup ${filename} ?\n\nCette action ecrase la base actuelle.`)) {
      return;
    }

    try {
      setBusyAction(`restore:${filename}`);
      setError('');
      setSuccess('');
      await adminAPI.restoreDatabaseBackup(filename);
      setSuccess(`Backup ${filename} restaure.`);
      await loadData();
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Impossible de restaurer le backup.');
    } finally {
      setBusyAction('');
    }
  };

  const handleDelete = async (filename) => {
    if (!window.confirm(`Supprimer le backup ${filename} ?`)) {
      return;
    }

    try {
      setBusyAction(`delete:${filename}`);
      setError('');
      setSuccess('');
      await adminAPI.deleteDatabaseBackup(filename);
      setSuccess(`Backup ${filename} supprime.`);
      await loadData();
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Impossible de supprimer le backup.');
    } finally {
      setBusyAction('');
    }
  };

  const handleUploadToS3 = async (filename) => {
    try {
      setBusyAction(`s3upload:${filename}`);
      setError('');
      setSuccess('');

      const response = await adminAPI.uploadBackupToS3(filename);
      const { jobId } = response.data;
      setSuccess(`Envoi de ${filename} vers S3...`);

      await waitS3Job(jobId);

      setSuccess(`Backup ${filename} envoye vers S3 avec succes.`);
      setCloudRefreshToken((current) => current + 1);
    } catch (requestError) {
      setError(requestError.response?.data?.error || requestError.response?.data?.message || requestError.message || 'Impossible d envoyer vers S3.');
    } finally {
      setBusyAction('');
    }
  };

  const saveScheduleScope = async (scope, scopeSchedule) => {
    if (!schedule) return;

    try {
      setSavingSchedule(true);
      setError('');
      const payload = {
        ...schedule,
        [scope]: scopeSchedule
      };
      const response = await adminAPI.updateBackupSchedule(payload);
      setSchedule(response.data?.schedule || payload);
      setSuccess(`Planification ${scope === 'local' ? 'locale' : 'S3'} sauvegardee.`);
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Impossible de sauvegarder la planification.');
    } finally {
      setSavingSchedule(false);
    }
  };

  const databaseSize = stats?.size || '-';
  const databaseTables = stats?.tableCount ?? '-';
  const databaseRows = stats?.totalRows ?? '-';
  const backupCount = sortedBackups.length;

  return (
    <div data-admin-theme className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="max-w-3xl">
          <div className="inline-flex items-center gap-2 rounded-full border border-admin-border bg-admin-surface px-3 py-1 text-[11px] uppercase tracking-[0.2em] text-admin-text-muted">
            <ShieldAlert className="h-3.5 w-3.5" />
            Admin Backups
          </div>
          <h1 className="mt-4 text-3xl font-semibold tracking-tight text-admin-text lg:text-4xl">
            Backup local et backup S3 bien separes.
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-admin-text-muted lg:text-base">
            Un onglet pour le local, un onglet pour le cloud S3. Chaque type a son propre bouton de creation et sa propre planification.
          </p>
        </div>

        <div className="flex flex-wrap gap-3">
          {activeTab === 'local' ? (
            <AdminButton onClick={handleCreateLocalBackup} disabled={busyAction !== ''}>
              {busyAction === 'create-local' ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Database className="w-4 h-4 mr-2" strokeWidth={1.8} />}
              {busyAction === 'create-local' ? 'Creation...' : 'Creer backup local'}
            </AdminButton>
          ) : (
            <AdminButton onClick={handleCreateS3Backup} disabled={busyAction !== ''}>
              {busyAction === 'create-s3' ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Cloud className="w-4 h-4 mr-2" strokeWidth={1.8} />}
              {busyAction === 'create-s3' ? 'Creation...' : 'Creer backup S3'}
            </AdminButton>
          )}

          <AdminButton variant="secondary" onClick={loadData} disabled={busyAction !== '' || loading}>
            {loading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-2" strokeWidth={1.8} />}
            {loading ? 'Chargement...' : 'Rafraichir'}
          </AdminButton>
        </div>
      </div>

      {error && (
        <AdminAlert variant="danger">
          <AdminAlertDescription>{error}</AdminAlertDescription>
        </AdminAlert>
      )}

      {success && (
        <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">
          {success}
        </div>
      )}

      {jobStatus && (
        <div className="rounded-2xl border border-sky-500/30 bg-sky-500/10 px-4 py-3 text-sm text-sky-100">
          Job backup: {jobStatus.status}
          {jobStatus.started_at ? ` • demarre ${formatDate(jobStatus.started_at)}` : ''}
          {jobStatus.finished_at ? ` • termine ${formatDate(jobStatus.finished_at)}` : ''}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Taille base" value={databaseSize} hint="Taille totale de la base PostgreSQL" icon={<Database className="w-4 h-4" strokeWidth={1.8} />} />
        <StatCard label="Tables" value={databaseTables} hint="Nombre de tables publiques" icon={<Layers3 className="w-4 h-4" strokeWidth={1.8} />} />
        <StatCard label="Lignes" value={databaseRows} hint="Lignes estimees totalisees" icon={<Server className="w-4 h-4" strokeWidth={1.8} />} />
        <StatCard label="Backups locaux" value={backupCount} hint={`Retention locale automatique: ${LOCAL_BACKUP_LIMIT}`} icon={<HardDrive className="w-4 h-4" strokeWidth={1.8} />} accent="text-emerald-300" />
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setActiveTab('local')}
          className={`rounded-xl border px-4 py-2 text-sm transition-colors ${activeTab === 'local' ? 'border-admin-primary bg-admin-surface text-admin-text' : 'border-admin-border bg-admin-bg text-admin-text-muted hover:text-admin-text'}`}
        >
          Backup local
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('s3')}
          className={`rounded-xl border px-4 py-2 text-sm transition-colors ${activeTab === 's3' ? 'border-admin-primary bg-admin-surface text-admin-text' : 'border-admin-border bg-admin-bg text-admin-text-muted hover:text-admin-text'}`}
        >
          Backup S3
        </button>
      </div>

      {activeTab === 'local' && (
        <section className="space-y-6">
          <BackupSchedulePanel
            scope="local"
            title="Planification backup local"
            schedule={schedule}
            onSave={saveScheduleScope}
            saving={savingSchedule}
          />

          <AdminCard>
            <AdminCardHeader>
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-admin-border bg-admin-surface text-admin-text">
                  <HardDrive className="h-5 w-5" strokeWidth={1.7} />
                </div>
                <div>
                  <AdminCardTitle>Backups locaux</AdminCardTitle>
                  <p className="mt-1 text-sm text-admin-text-muted">Liste des backups locaux avec export, restauration, envoi S3 et suppression.</p>
                </div>
              </div>
            </AdminCardHeader>
            <AdminCardContent className="pt-0 space-y-4">
              <div className="rounded-2xl border border-admin-border bg-white/[0.03] px-4 py-3 text-sm text-admin-text-muted">
                Le serveur conserve automatiquement les {LOCAL_BACKUP_LIMIT} derniers backups locaux.
              </div>

              <div className="overflow-hidden rounded-2xl border border-admin-border">
                {loading ? (
                  <div className="px-4 py-10 text-sm text-admin-text-muted">Chargement des backups locaux...</div>
                ) : sortedBackups.length === 0 ? (
                  <div className="px-4 py-10 text-sm text-admin-text-muted">Aucun backup local trouve pour le moment.</div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[860px] text-sm">
                      <thead className="bg-white/[0.03] text-xs uppercase tracking-[0.15em] text-admin-text-muted">
                        <tr>
                          <th className="px-4 py-3 text-left">Fichier</th>
                          <th className="px-4 py-3 text-left">Taille</th>
                          <th className="px-4 py-3 text-left">Cree le</th>
                          <th className="px-4 py-3 text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {sortedBackups.map((backup) => {
                          const isDownloading = busyAction === `download:${backup.filename}`;
                          const isRestoring = busyAction === `restore:${backup.filename}`;
                          const isDeleting = busyAction === `delete:${backup.filename}`;
                          const isS3Uploading = busyAction === `s3upload:${backup.filename}`;

                          return (
                            <tr key={backup.filename} className="border-t border-admin-border bg-admin-bg">
                              <td className="px-4 py-3 text-admin-text">
                                <div className="flex items-center gap-2">
                                  {backup.uploaded_to_s3 && <Cloud className="h-3.5 w-3.5 text-emerald-400" title="Present dans S3" />}
                                  <span className="font-mono text-xs">{backup.filename}</span>
                                </div>
                              </td>
                              <td className="px-4 py-3 text-admin-text-muted">{formatSize(backup.sizeFormatted || backup.size)}</td>
                              <td className="px-4 py-3 text-admin-text-muted">{formatDate(backup.created_at)}</td>
                              <td className="px-4 py-3">
                                <div className="flex flex-wrap justify-end gap-2">
                                  <AdminButton variant="secondary" onClick={() => handleDownload(backup.filename)} disabled={busyAction !== ''}>
                                    <Download className="h-3.5 w-3.5" />
                                    {isDownloading ? 'Telechargement...' : 'Export'}
                                  </AdminButton>
                                  <AdminButton variant="secondary" onClick={() => handleRestore(backup.filename)} disabled={busyAction !== ''}>
                                    <Upload className="h-3.5 w-3.5" />
                                    {isRestoring ? 'Restauration...' : 'Restaurer'}
                                  </AdminButton>
                                  <AdminButton variant="secondary" onClick={() => handleUploadToS3(backup.filename)} disabled={busyAction !== ''}>
                                    <Cloud className="h-3.5 w-3.5" />
                                    {isS3Uploading ? 'Envoi...' : 'Envoyer S3'}
                                  </AdminButton>
                                  <AdminButton variant="secondary" onClick={() => handleDelete(backup.filename)} disabled={busyAction !== ''}>
                                    <Trash2 className="h-3.5 w-3.5" />
                                    {isDeleting ? 'Suppression...' : 'Supprimer'}
                                  </AdminButton>
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
            </AdminCardContent>
          </AdminCard>
        </section>
      )}

      {activeTab === 's3' && (
        <section className="space-y-6">
          <BackupSchedulePanel
            scope="s3"
            title="Planification backup S3"
            schedule={schedule}
            onSave={saveScheduleScope}
            saving={savingSchedule}
          />

          <S3ConfigPanel onSaved={() => setCloudRefreshToken((current) => current + 1)} />

          <CloudBackupsPanel refreshToken={cloudRefreshToken} />

          <AdminCard>
            <AdminCardHeader>
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-admin-border bg-admin-surface text-admin-text">
                  <AlertTriangle className="h-5 w-5" strokeWidth={1.7} />
                </div>
                <div>
                  <AdminCardTitle>Comportement S3</AdminCardTitle>
                  <p className="mt-1 text-sm text-admin-text-muted">Un backup S3 cree toujours un fichier local puis l envoie au cloud.</p>
                </div>
              </div>
            </AdminCardHeader>
            <AdminCardContent className="pt-0">
              <div className="flex items-start gap-3 rounded-2xl border border-admin-border bg-white/[0.03] px-4 py-3 text-sm text-admin-text-muted">
                <CheckCircle2 className="mt-0.5 h-4 w-4 text-emerald-300" />
                <div>Retention cloud automatique: {CLOUD_BACKUP_LIMIT} backups max dans le bucket.</div>
              </div>
            </AdminCardContent>
          </AdminCard>
        </section>
      )}
    </div>
  );
}
