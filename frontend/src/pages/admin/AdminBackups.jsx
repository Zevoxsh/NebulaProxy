import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Download,
  Upload,
  RefreshCw,
  Trash2,
  Database,
  HardDrive,
  ShieldAlert,
  Cloud,
  CloudOff,
  Eye,
  EyeOff,
  Copy,
  Server,
  Clock3,
  Layers3,
  AlertTriangle,
  CheckCircle2,
  Loader2
} from 'lucide-react';
import { adminAPI } from '../../api/client';

const LOCAL_BACKUP_LIMIT = 3;
const CLOUD_BACKUP_LIMIT = 5;

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString();
}

function formatSize(value) {
  if (value === null || value === undefined || value === '') return '—';
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

function sectionTitle(title, description, icon) {
  return (
    <div className="flex items-start gap-3">
      <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/[0.08] bg-white/[0.04] text-white/90">
        {icon}
      </div>
      <div>
        <h2 className="text-base font-semibold text-white">{title}</h2>
        <p className="mt-1 text-sm text-white/55">{description}</p>
      </div>
    </div>
  );
}

function statCard({ label, value, hint, icon, accent = 'text-white' }) {
  return (
    <div className="rounded-2xl border border-white/[0.08] bg-[#161722]/70 p-4 shadow-lg shadow-black/10 backdrop-blur-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[11px] uppercase tracking-[0.18em] text-white/45">{label}</div>
          <div className={`mt-2 text-2xl font-semibold ${accent}`}>{value}</div>
        </div>
        <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/[0.08] bg-white/[0.04] text-white/75">
          {icon}
        </div>
      </div>
      {hint && <div className="mt-3 text-xs text-white/50">{hint}</div>}
    </div>
  );
}

function actionButton({ onClick, disabled, active, icon, label, tone = 'default', type = 'button' }) {
  const toneClass =
    tone === 'danger'
      ? 'border-red-500/20 bg-red-500/10 text-red-200 hover:bg-red-500/15'
      : tone === 'success'
        ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-200 hover:bg-emerald-500/15'
        : 'border-white/[0.08] bg-white/[0.04] text-white/85 hover:bg-white/[0.07]';

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center gap-2 rounded-xl border px-4 py-2 text-sm transition-all duration-200 ${toneClass} ${disabled ? 'cursor-not-allowed opacity-60' : 'hover:-translate-y-0.5'}`}
    >
      {icon}
      <span>{active || label}</span>
    </button>
  );
}

function S3ConfigPanel() {
  const [config, setConfig] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [s3Backups, setS3Backups] = useState([]);
  const [s3Loading, setS3Loading] = useState(false);
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

  const loadS3Backups = useCallback(async () => {
    setS3Loading(true);
    try {
      const response = await adminAPI.listS3Backups();
      setS3Backups(response.data.backups || []);
    } catch {
      showMsg('error', 'Impossible de charger la liste S3');
    } finally {
      setS3Loading(false);
    }
  }, [showMsg]);

  useEffect(() => {
    if (config?.enabled) {
      loadS3Backups();
    }
  }, [config?.enabled, loadS3Backups]);

  const updateField = (field, value) => {
    setConfig((current) => ({ ...current, [field]: value }));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const response = await adminAPI.saveS3BackupConfig(config);
      setConfig(response.data.config);
      showMsg('success', `Configuration S3 sauvegardée. Rétention forcée: ${CLOUD_BACKUP_LIMIT} backups.`);
      if (response.data.cleaned > 0) {
        showMsg('success', `${response.data.cleaned} backup(s) cloud supprimé(s) automatiquement.`);
      }
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

  const handleDeleteS3 = async (key) => {
    if (!window.confirm(`Supprimer ce backup S3 ?\n\n${key}`)) return;
    try {
      await adminAPI.deleteS3Backup(key);
      showMsg('success', 'Backup S3 supprimé');
      loadS3Backups();
    } catch (error) {
      showMsg('error', error.response?.data?.message || 'Impossible de supprimer le backup S3');
    }
  };

  if (loading) {
    return (
      <div className="rounded-3xl border border-white/[0.08] bg-[#12131b]/80 p-6 text-sm text-white/60">
        Chargement de la configuration cloud...
      </div>
    );
  }

  if (!config) {
    return null;
  }

  return (
    <section className="rounded-3xl border border-white/[0.08] bg-[#12131b]/80 shadow-2xl shadow-black/20 backdrop-blur-xl overflow-hidden">
      <div className="border-b border-white/[0.08] bg-gradient-to-r from-[#171824] via-[#151722] to-[#10111a] px-5 py-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="flex items-center gap-2 text-white/50 text-xs uppercase tracking-[0.2em]">
              <Cloud className="w-4 h-4" />
              Cloud Backup
            </div>
            <h3 className="mt-2 text-lg font-semibold text-white">Sauvegarde S3 / MinIO</h3>
            <p className="mt-1 text-sm text-white/55">
              La configuration ci-dessous gère uniquement le cloud. La rétention est forcée côté serveur à {CLOUD_BACKUP_LIMIT} backups.
            </p>
          </div>

          <label className="inline-flex items-center gap-3 rounded-2xl border border-white/[0.08] bg-white/[0.04] px-4 py-3 text-sm text-white/70">
            <span>{config.enabled ? 'Activé' : 'Désactivé'}</span>
            <input
              type="checkbox"
              checked={Boolean(config.enabled)}
              onChange={(event) => updateField('enabled', event.target.checked)}
              className="h-4 w-4 accent-emerald-500"
            />
          </label>
        </div>
      </div>

      <div className="grid gap-5 p-5 xl:grid-cols-[1.1fr_0.9fr]">
        <div className="space-y-5">
          {status.msg && (
            <div className={`rounded-2xl border px-4 py-3 text-sm ${
              status.type === 'error'
                ? 'border-red-500/30 bg-red-500/10 text-red-200'
                : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200'
            }`}>
              {status.msg}
            </div>
          )}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {statCard({
              label: 'Retenue cloud',
              value: `${CLOUD_BACKUP_LIMIT}`,
              hint: 'Toujours 5 backups max dans le bucket',
              icon: <Layers3 className="w-4 h-4" strokeWidth={1.6} />, 
              accent: 'text-emerald-300'
            })}
            {statCard({
              label: 'Backups S3 visibles',
              value: `${s3Backups.length}`,
              hint: 'Liste actuelle des objets cloud',
              icon: <HardDrive className="w-4 h-4" strokeWidth={1.6} />
            })}
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs uppercase tracking-[0.15em] text-white/45">Endpoint</label>
              <input
                className="w-full rounded-2xl border border-white/[0.08] bg-[#0f1018] px-4 py-3 text-sm text-white placeholder:text-white/25 focus:border-emerald-500/40 focus:outline-none"
                placeholder="https://s3.example.com"
                value={config.endpoint || ''}
                onChange={(event) => updateField('endpoint', event.target.value)}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs uppercase tracking-[0.15em] text-white/45">Région</label>
              <input
                className="w-full rounded-2xl border border-white/[0.08] bg-[#0f1018] px-4 py-3 text-sm text-white placeholder:text-white/25 focus:border-emerald-500/40 focus:outline-none"
                placeholder="us-east-1"
                value={config.region || ''}
                onChange={(event) => updateField('region', event.target.value)}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs uppercase tracking-[0.15em] text-white/45">Access Key</label>
              <input
                className="w-full rounded-2xl border border-white/[0.08] bg-[#0f1018] px-4 py-3 font-mono text-sm text-white placeholder:text-white/25 focus:border-emerald-500/40 focus:outline-none"
                placeholder="Access key ID"
                value={config.access_key || ''}
                onChange={(event) => updateField('access_key', event.target.value)}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs uppercase tracking-[0.15em] text-white/45">Secret Key</label>
              <div className="relative">
                <input
                  className="w-full rounded-2xl border border-white/[0.08] bg-[#0f1018] px-4 py-3 pr-12 font-mono text-sm text-white placeholder:text-white/25 focus:border-emerald-500/40 focus:outline-none"
                  type={showSecret ? 'text' : 'password'}
                  placeholder="Secret access key"
                  value={config.secret_key || ''}
                  onChange={(event) => updateField('secret_key', event.target.value)}
                />
                <button
                  type="button"
                  onClick={() => setShowSecret((current) => !current)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 rounded-lg p-1 text-white/45 transition-colors hover:text-white"
                >
                  {showSecret ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
            <div>
              <label className="mb-1 block text-xs uppercase tracking-[0.15em] text-white/45">Bucket</label>
              <input
                className="w-full rounded-2xl border border-white/[0.08] bg-[#0f1018] px-4 py-3 font-mono text-sm text-white placeholder:text-white/25 focus:border-emerald-500/40 focus:outline-none"
                placeholder="nebula"
                value={config.bucket || ''}
                onChange={(event) => updateField('bucket', event.target.value)}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs uppercase tracking-[0.15em] text-white/45">Prefix</label>
              <input
                className="w-full rounded-2xl border border-white/[0.08] bg-[#0f1018] px-4 py-3 font-mono text-sm text-white placeholder:text-white/25 focus:border-emerald-500/40 focus:outline-none"
                placeholder="backups/"
                value={config.prefix || ''}
                onChange={(event) => updateField('prefix', event.target.value)}
              />
            </div>
          </div>

          <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/8 p-4 text-sm text-emerald-100/90">
            <div className="flex items-start gap-3">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" />
              <div>
                <div className="font-medium">Rétention cloud verrouillée</div>
                <div className="mt-1 text-emerald-100/70">
                  Le système supprime automatiquement les anciens fichiers et conserve uniquement les {CLOUD_BACKUP_LIMIT} plus récents.
                </div>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap gap-3">
            {actionButton({
              onClick: handleSave,
              disabled: saving,
              active: saving ? 'Sauvegarde...' : null,
              icon: saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" strokeWidth={1.8} />,
              label: 'Enregistrer la config',
              tone: 'success'
            })}
            {actionButton({
              onClick: handleTest,
              disabled: testing,
              active: testing ? 'Test...' : null,
              icon: testing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Cloud className="w-4 h-4" strokeWidth={1.8} />,
              label: 'Tester la connexion'
            })}
            {config.enabled && actionButton({
              onClick: loadS3Backups,
              disabled: s3Loading,
              active: s3Loading ? 'Chargement...' : null,
              icon: s3Loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" strokeWidth={1.8} />,
              label: 'Rafraîchir la liste'
            })}
          </div>
        </div>

        <div className="space-y-5">
          <div className="rounded-2xl border border-white/[0.08] bg-[#0f1018] p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-xs uppercase tracking-[0.18em] text-white/45">Backups cloud</div>
                <div className="mt-1 text-sm text-white/75">Objets stockés dans S3 / MinIO</div>
              </div>
              <div className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs ${config.enabled ? 'bg-emerald-500/10 text-emerald-200' : 'bg-white/[0.04] text-white/45'}`}>
                {config.enabled ? <Cloud className="h-3.5 w-3.5" /> : <CloudOff className="h-3.5 w-3.5" />}
                {config.enabled ? 'Actif' : 'Inactif'}
              </div>
            </div>

            <div className="mt-4 space-y-3">
              {!config.enabled ? (
                <div className="rounded-2xl border border-white/[0.08] bg-white/[0.03] px-4 py-5 text-sm text-white/55">
                  Active la configuration pour afficher les fichiers présents dans le bucket.
                </div>
              ) : s3Loading ? (
                <div className="rounded-2xl border border-white/[0.08] bg-white/[0.03] px-4 py-5 text-sm text-white/55">
                  Chargement des backups cloud...
                </div>
              ) : s3Backups.length === 0 ? (
                <div className="rounded-2xl border border-white/[0.08] bg-white/[0.03] px-4 py-5 text-sm text-white/55">
                  Aucun backup n’a encore été envoyé dans le cloud.
                </div>
              ) : (
                <div className="overflow-hidden rounded-2xl border border-white/[0.08]">
                  <table className="w-full text-sm">
                    <thead className="bg-white/[0.03] text-xs uppercase tracking-[0.15em] text-white/45">
                      <tr>
                        <th className="px-4 py-3 text-left">Fichier</th>
                        <th className="px-4 py-3 text-left">Taille</th>
                        <th className="px-4 py-3 text-left">Date</th>
                        <th className="px-4 py-3 text-right"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {s3Backups.map((backup) => (
                        <tr key={backup.key} className="border-t border-white/[0.06] bg-[#11131c]">
                          <td className="px-4 py-3 font-mono text-xs text-white/85">{backup.filename}</td>
                          <td className="px-4 py-3 text-white/60">{backup.sizeFormatted}</td>
                          <td className="px-4 py-3 text-white/60">{formatDate(backup.created_at)}</td>
                          <td className="px-4 py-3 text-right">
                            <button
                              type="button"
                              onClick={() => handleDeleteS3(backup.key)}
                              className="inline-flex items-center gap-2 rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-1.5 text-xs text-red-200 transition-colors hover:bg-red-500/15"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                              Supprimer
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>

          <div className="rounded-2xl border border-white/[0.08] bg-[#0f1018] p-4">
            <div className="text-xs uppercase tracking-[0.18em] text-white/45">Résumé automatique</div>
            <div className="mt-3 space-y-3 text-sm text-white/65">
              <div className="flex items-center gap-3 rounded-xl border border-white/[0.06] bg-white/[0.03] px-4 py-3">
                <Clock3 className="h-4 w-4 text-white/55" />
                <span>Local: conservation automatique des {LOCAL_BACKUP_LIMIT} derniers backups.</span>
              </div>
              <div className="flex items-center gap-3 rounded-xl border border-white/[0.06] bg-white/[0.03] px-4 py-3">
                <Server className="h-4 w-4 text-white/55" />
                <span>Cloud: conservation automatique des {CLOUD_BACKUP_LIMIT} derniers backups.</span>
              </div>
              <div className="flex items-center gap-3 rounded-xl border border-white/[0.06] bg-white/[0.03] px-4 py-3">
                <AlertTriangle className="h-4 w-4 text-amber-300" />
                <span>Les suppressions sont automatiques dès qu’un nouveau backup dépasse la limite.</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
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

  const sortedBackups = useMemo(
    () => [...backups].sort((a, b) => new Date(b.created_at) - new Date(a.created_at)),
    [backups]
  );

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const [statsResponse, backupsResponse] = await Promise.all([
        adminAPI.getDatabaseStats(),
        adminAPI.listDatabaseBackups()
      ]);
      setStats(statsResponse.data?.stats || null);
      setBackups(backupsResponse.data?.backups || []);
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Impossible de charger les backups.');
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
        setSuccess('La demande de backup a été acceptée.');
        await loadData();
        return;
      }

      setJobStatus(job);
      setSuccess('Backup en cours...');

      const startedAt = Date.now();
      const timeoutMs = 10 * 60 * 1000;

      while (Date.now() - startedAt < timeoutMs) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
        const jobResponse = await adminAPI.getDatabaseBackupJob(job.id);
        const currentJob = jobResponse.data?.job;
        if (!currentJob) continue;

        setJobStatus(currentJob);

        if (currentJob.status === 'completed') {
          setSuccess('Backup terminé avec succès.');
          await loadData();
          return;
        }

        if (currentJob.status === 'failed') {
          throw new Error(currentJob.error || 'Le backup a échoué.');
        }
      }

      setSuccess('Le backup continue en arrière-plan. Actualise dans quelques instants.');
    } catch (requestError) {
      setError(requestError.response?.data?.message || requestError.message || 'Impossible de créer le backup.');
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
      setSuccess(`Backup ${filename} téléchargé.`);
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Impossible de télécharger le backup.');
    } finally {
      setBusyAction('');
    }
  };

  const handleRestore = async (filename) => {
    if (!window.confirm(`Restaurer le backup ${filename} ?\n\nCette action écrase la base actuelle.`)) {
      return;
    }

    try {
      setBusyAction(`restore:${filename}`);
      setError('');
      setSuccess('');
      await adminAPI.restoreDatabaseBackup(filename);
      setSuccess(`Backup ${filename} restauré.`);
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
      setSuccess(`Backup ${filename} supprimé.`);
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

      const startedAt = Date.now();
      const timeoutMs = 30 * 60 * 1000;

      while (Date.now() - startedAt < timeoutMs) {
        await new Promise((resolve) => setTimeout(resolve, 3000));
        const jobResponse = await adminAPI.getS3UploadJob(jobId);
        const job = jobResponse.data?.job;
        if (!job) continue;

        if (job.status === 'completed') {
          setSuccess(`Backup ${filename} envoyé vers S3 avec succès.`);
          return;
        }

        if (job.status === 'failed') {
          throw new Error(job.error || 'Échec de l’envoi vers S3.');
        }
      }

      setSuccess('L’envoi vers S3 continue en arrière-plan.');
    } catch (requestError) {
      setError(requestError.response?.data?.error || requestError.response?.data?.message || requestError.message || 'Impossible d’envoyer vers S3.');
    } finally {
      setBusyAction('');
    }
  };

  const databaseSize = stats?.size || '—';
  const databaseTables = stats?.tableCount ?? '—';
  const databaseRows = stats?.totalRows ?? '—';
  const backupCount = sortedBackups.length;

  return (
    <div className="space-y-6">
      <section className="rounded-[28px] border border-white/[0.08] bg-[radial-gradient(circle_at_top,_rgba(149,76,233,0.12),_transparent_36%),linear-gradient(180deg,rgba(16,17,26,0.95),rgba(10,11,16,0.95))] p-6 shadow-2xl shadow-black/20 backdrop-blur-xl lg:p-8">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <div className="inline-flex items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.04] px-3 py-1 text-[11px] uppercase tracking-[0.2em] text-white/50">
              <ShieldAlert className="h-3.5 w-3.5" />
              Admin Backups
            </div>
            <h1 className="mt-4 text-3xl font-semibold tracking-tight text-white lg:text-4xl">
              Sauvegardes claires, séparées, et sans mélange.
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-white/60 lg:text-base">
              Cette page regroupe uniquement les backups locaux, l’export / restauration, et la configuration cloud S3. La rétention est automatique et limitée.
            </p>
          </div>

          <div className="flex flex-wrap gap-3">
            {actionButton({
              onClick: handleCreateBackup,
              disabled: busyAction !== '',
              active: busyAction === 'create' ? 'Création...' : null,
              icon: busyAction === 'create' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Database className="w-4 h-4" strokeWidth={1.8} />,
              label: 'Créer un backup',
              tone: 'success'
            })}
            {actionButton({
              onClick: loadData,
              disabled: busyAction !== '' || loading,
              active: loading ? 'Chargement...' : null,
              icon: loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" strokeWidth={1.8} />,
              label: 'Rafraîchir'
            })}
          </div>
        </div>
      </section>

      {error && (
        <div className="rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-100">
          {error}
        </div>
      )}

      {success && (
        <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">
          {success}
        </div>
      )}

      {jobStatus && (
        <div className="rounded-2xl border border-sky-500/30 bg-sky-500/10 px-4 py-3 text-sm text-sky-100">
          Job backup: {jobStatus.status}
          {jobStatus.started_at ? ` • démarré ${formatDate(jobStatus.started_at)}` : ''}
          {jobStatus.finished_at ? ` • terminé ${formatDate(jobStatus.finished_at)}` : ''}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        {statCard({
          label: 'Taille base',
          value: databaseSize,
          hint: 'Taille totale de la base PostgreSQL',
          icon: <Database className="w-4 h-4" strokeWidth={1.8} />,
          accent: 'text-white'
        })}
        {statCard({
          label: 'Tables',
          value: databaseTables,
          hint: 'Nombre de tables publiques',
          icon: <Layers3 className="w-4 h-4" strokeWidth={1.8} />,
          accent: 'text-white'
        })}
        {statCard({
          label: 'Lignes',
          value: databaseRows,
          hint: 'Lignes estimées totalisées',
          icon: <Server className="w-4 h-4" strokeWidth={1.8} />,
          accent: 'text-white'
        })}
        {statCard({
          label: 'Backups locaux',
          value: `${backupCount}`,
          hint: `Rétention automatique: ${LOCAL_BACKUP_LIMIT} derniers fichiers`,
          icon: <HardDrive className="w-4 h-4" strokeWidth={1.8} />,
          accent: 'text-emerald-300'
        })}
      </div>

      <section className="grid grid-cols-1 gap-6 xl:grid-cols-[1.15fr_0.85fr]">
        <div className="space-y-6">
          <div className="rounded-3xl border border-white/[0.08] bg-[#12131b]/80 p-5 shadow-xl shadow-black/10 backdrop-blur-xl">
            {sectionTitle(
              'Backups locaux',
              'Liste des backups créés sur le serveur avec export, restauration et suppression.',
              <HardDrive className="h-5 w-5" strokeWidth={1.7} />
            )}

            <div className="mt-5 flex flex-wrap gap-3">
              <div className="rounded-2xl border border-white/[0.08] bg-white/[0.03] px-4 py-3 text-sm text-white/70">
                Rétention locale: <span className="font-semibold text-white">{LOCAL_BACKUP_LIMIT}</span> derniers backups
              </div>
              <div className="rounded-2xl border border-white/[0.08] bg-white/[0.03] px-4 py-3 text-sm text-white/70">
                Le plus récent est en haut de la liste
              </div>
            </div>

            <div className="mt-5 overflow-hidden rounded-2xl border border-white/[0.08]">
              {loading ? (
                <div className="px-4 py-10 text-sm text-white/55">Chargement des backups locaux...</div>
              ) : sortedBackups.length === 0 ? (
                <div className="px-4 py-10 text-sm text-white/55">Aucun backup local trouvé pour le moment.</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[860px] text-sm">
                    <thead className="bg-white/[0.03] text-xs uppercase tracking-[0.15em] text-white/45">
                      <tr>
                        <th className="px-4 py-3 text-left">Fichier</th>
                        <th className="px-4 py-3 text-left">Taille</th>
                        <th className="px-4 py-3 text-left">Créé le</th>
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
                          <tr key={backup.filename} className="border-t border-white/[0.06] bg-[#11131c]">
                            <td className="px-4 py-3 text-white/85">
                              <div className="flex items-center gap-2">
                                {backup.uploaded_to_s3 && <Cloud className="h-3.5 w-3.5 text-emerald-400" title="Présent dans S3" />}
                                <span className="font-mono text-xs">{backup.filename}</span>
                              </div>
                            </td>
                            <td className="px-4 py-3 text-white/60">{formatSize(backup.sizeFormatted || backup.size)}</td>
                            <td className="px-4 py-3 text-white/60">{formatDate(backup.created_at)}</td>
                            <td className="px-4 py-3">
                              <div className="flex flex-wrap justify-end gap-2">
                                <button
                                  type="button"
                                  onClick={() => handleDownload(backup.filename)}
                                  disabled={busyAction !== ''}
                                  className="inline-flex items-center gap-2 rounded-lg border border-white/[0.08] bg-white/[0.04] px-3 py-1.5 text-xs text-white/85 transition-colors hover:bg-white/[0.07] disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                  <Download className="h-3.5 w-3.5" />
                                  {isDownloading ? 'Téléchargement...' : 'Export'}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleRestore(backup.filename)}
                                  disabled={busyAction !== ''}
                                  className="inline-flex items-center gap-2 rounded-lg border border-white/[0.08] bg-white/[0.04] px-3 py-1.5 text-xs text-white/85 transition-colors hover:bg-white/[0.07] disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                  <Upload className="h-3.5 w-3.5" />
                                  {isRestoring ? 'Restauration...' : 'Restaurer'}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleUploadToS3(backup.filename)}
                                  disabled={busyAction !== ''}
                                  className="inline-flex items-center gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-3 py-1.5 text-xs text-emerald-200 transition-colors hover:bg-emerald-500/15 disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                  <Cloud className="h-3.5 w-3.5" />
                                  {isS3Uploading ? 'Envoi...' : 'S3'}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleDelete(backup.filename)}
                                  disabled={busyAction !== ''}
                                  className="inline-flex items-center gap-2 rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-1.5 text-xs text-red-200 transition-colors hover:bg-red-500/15 disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                  {isDeleting ? 'Suppression...' : 'Supprimer'}
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
          </div>
        </div>

        <div className="space-y-6">
          <div className="rounded-3xl border border-white/[0.08] bg-[#12131b]/80 p-5 shadow-xl shadow-black/10 backdrop-blur-xl">
            {sectionTitle(
              'Cloud S3 / MinIO',
              'Configuration cloud et fichiers déjà envoyés dans le bucket.',
              <Cloud className="h-5 w-5" strokeWidth={1.7} />
            )}
            <div className="mt-4">
              <S3ConfigPanel />
            </div>
          </div>

          <div className="rounded-3xl border border-white/[0.08] bg-[#12131b]/80 p-5 shadow-xl shadow-black/10 backdrop-blur-xl">
            {sectionTitle(
              'Point important',
              'La restauration écrase la base actuelle. Vérifie toujours le dernier backup avant de lancer une importation.',
              <ShieldAlert className="h-5 w-5" strokeWidth={1.7} />
            )}
            <div className="mt-4 space-y-3 text-sm text-white/65">
              <div className="flex items-start gap-3 rounded-2xl border border-white/[0.08] bg-white/[0.03] px-4 py-3">
                <Copy className="mt-0.5 h-4 w-4 text-white/45" />
                <div>
                  Le bouton <span className="text-white">Export</span> télécharge le fichier local.
                </div>
              </div>
              <div className="flex items-start gap-3 rounded-2xl border border-white/[0.08] bg-white/[0.03] px-4 py-3">
                <Upload className="mt-0.5 h-4 w-4 text-white/45" />
                <div>
                  Le bouton <span className="text-white">Restaurer</span> remplace les données actuelles.
                </div>
              </div>
              <div className="flex items-start gap-3 rounded-2xl border border-white/[0.08] bg-white/[0.03] px-4 py-3">
                <Cloud className="mt-0.5 h-4 w-4 text-white/45" />
                <div>
                  Le bouton <span className="text-white">S3</span> envoie le backup dans le cloud avec purge automatique au-delà de {CLOUD_BACKUP_LIMIT} fichiers.
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
