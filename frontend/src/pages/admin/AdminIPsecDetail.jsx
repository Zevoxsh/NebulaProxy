import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft, Check, Copy, Download, Eye, EyeOff, Key, Loader2, Power, PowerOff, RefreshCw, Trash2, Wifi, WifiOff
} from 'lucide-react';
import { ipsecAPI } from '../../api/client';
import {
  AdminAlert,
  AdminAlertDescription,
  AdminAlertTitle,
  AdminButton,
  AdminCard,
  AdminCardContent,
  AdminCardHeader,
  AdminCardTitle,
  AdminBadge
} from '@/components/admin';

function CopyButton({ text }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
      className="flex items-center gap-1.5 text-xs text-admin-text-muted hover:text-admin-text transition-colors"
    >
      {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
      {copied ? 'Copie' : 'Copier'}
    </button>
  );
}

function formatBytes(n) {
  if (!n) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = n;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) { value /= 1024; i += 1; }
  return `${value.toFixed(1)} ${units[i]}`;
}

export default function AdminIPsecDetail() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tunnel, setTunnel] = useState(null);
  const [status, setStatus] = useState(null);
  const [actionBusy, setActionBusy] = useState(false);

  const [psk, setPsk] = useState(null);
  const [pskLoading, setPskLoading] = useState(false);

  const refresh = async () => {
    try {
      setError('');
      const response = await ipsecAPI.get(id);
      setTunnel(response.data.tunnel);
      setStatus(response.data.status);
    } catch (err) {
      setError(err.response?.data?.message || 'Impossible de charger ce tunnel');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
    const interval = window.setInterval(refresh, 8000);
    return () => window.clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const toggleEnabled = async () => {
    setActionBusy(true);
    try {
      if (tunnel.running || tunnel.is_enabled) await ipsecAPI.disable(id);
      else await ipsecAPI.enable(id);
      await refresh();
    } catch (err) {
      setError(err.response?.data?.message || 'Action impossible');
    } finally {
      setActionBusy(false);
    }
  };

  const rotatePsk = async () => {
    if (!window.confirm('Regenerer la cle pre-partagee de ce tunnel ? Le site distant devra etre reconfigure avec la nouvelle cle.')) return;
    setActionBusy(true);
    try {
      const response = await ipsecAPI.rotatePsk(id);
      setPsk(response.data.psk);
      await refresh();
    } catch (err) {
      setError(err.response?.data?.message || 'Impossible de regenerer la cle');
    } finally {
      setActionBusy(false);
    }
  };

  const togglePsk = async () => {
    if (psk) {
      setPsk(null);
      return;
    }
    setPskLoading(true);
    try {
      const response = await ipsecAPI.getPsk(id);
      setPsk(response.data.psk);
    } catch (err) {
      setError(err.response?.data?.message || 'Impossible de recuperer la cle pre-partagee');
    } finally {
      setPskLoading(false);
    }
  };

  const deleteTunnel = async () => {
    if (!window.confirm(`Supprimer le tunnel "${tunnel.name}" ? Cette action est irreversible.`)) return;
    setActionBusy(true);
    try {
      await ipsecAPI.delete(id);
      navigate('/admin/ipsec');
    } catch (err) {
      setError(err.response?.data?.message || 'Impossible de supprimer ce tunnel');
      setActionBusy(false);
    }
  };

  const downloadConfig = async () => {
    const response = await ipsecAPI.downloadConfig(id);
    const url = window.URL.createObjectURL(new Blob([response.data]));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${tunnel.conn_name}.conf`;
    a.click();
    window.URL.revokeObjectURL(url);
  };

  if (loading) {
    return (
      <div data-admin-theme className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-admin-primary" />
      </div>
    );
  }

  if (!tunnel) {
    return (
      <div data-admin-theme className="space-y-4">
        <AdminAlert variant="danger">
          <AdminAlertTitle>Erreur</AdminAlertTitle>
          <AdminAlertDescription>{error || 'Tunnel introuvable'}</AdminAlertDescription>
        </AdminAlert>
        <AdminButton variant="secondary" onClick={() => navigate('/admin/ipsec')}>
          <ArrowLeft className="mr-2 h-4 w-4" /> Retour
        </AdminButton>
      </div>
    );
  }

  return (
    <div data-admin-theme className="space-y-6 pb-8">
      <button
        type="button"
        onClick={() => navigate('/admin/ipsec')}
        className="flex items-center gap-1.5 text-sm text-admin-text-muted hover:text-admin-text"
      >
        <ArrowLeft className="h-4 w-4" /> Tous les tunnels
      </button>

      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold text-admin-text md:text-3xl">{tunnel.name}</h1>
            <AdminBadge variant={tunnel.running ? 'success' : 'secondary'}>
              {tunnel.running ? <span className="flex items-center gap-1"><Wifi className="h-3 w-3" /> Actif</span> : <span className="flex items-center gap-1"><WifiOff className="h-3 w-3" /> Arrete</span>}
            </AdminBadge>
            <AdminBadge variant="secondary">{tunnel.mode === 'server' ? 'Serveur' : 'Client'}</AdminBadge>
          </div>
          <div className="mt-2 flex flex-wrap gap-2 text-xs text-admin-text-muted">
            <span className="rounded-full border border-admin-border bg-admin-surface2 px-2.5 py-1 font-mono">{tunnel.conn_name}</span>
            <span className="rounded-full border border-admin-border bg-admin-surface2 px-2.5 py-1 font-mono">{tunnel.local_subnet} &lt;-&gt; {tunnel.remote_subnet}</span>
            {tunnel.remote_addr && <span className="rounded-full border border-admin-border bg-admin-surface2 px-2.5 py-1 font-mono">{tunnel.remote_addr}</span>}
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <AdminButton variant="secondary" onClick={refresh}>
            <RefreshCw className="mr-2 h-4 w-4" /> Actualiser
          </AdminButton>
          <AdminButton variant="secondary" onClick={downloadConfig}>
            <Download className="mr-2 h-4 w-4" /> Exporter la conf
          </AdminButton>
          <AdminButton variant="secondary" onClick={rotatePsk} disabled={actionBusy}>
            <Key className="mr-2 h-4 w-4" /> Regenerer la cle
          </AdminButton>
          <AdminButton onClick={toggleEnabled} disabled={actionBusy} variant={tunnel.is_enabled ? 'danger' : 'default'}>
            {tunnel.is_enabled ? <PowerOff className="mr-2 h-4 w-4" /> : <Power className="mr-2 h-4 w-4" />}
            {tunnel.is_enabled ? 'Arreter' : 'Demarrer'}
          </AdminButton>
        </div>
      </div>

      {error && (
        <AdminAlert variant="danger">
          <AdminAlertTitle>Erreur</AdminAlertTitle>
          <AdminAlertDescription>{error}</AdminAlertDescription>
        </AdminAlert>
      )}

      <AdminCard>
        <AdminCardHeader className="flex flex-row items-center justify-between">
          <AdminCardTitle>Cle pre-partagee (PSK)</AdminCardTitle>
          <div className="flex items-center gap-3">
            {psk && <CopyButton text={psk} />}
            <AdminButton variant="ghost" size="sm" onClick={togglePsk} disabled={pskLoading}>
              {pskLoading ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : psk ? <EyeOff className="mr-2 h-3.5 w-3.5" /> : <Eye className="mr-2 h-3.5 w-3.5" />}
              {psk ? 'Masquer' : 'Afficher'}
            </AdminButton>
          </div>
        </AdminCardHeader>
        <AdminCardContent>
          <code className="block break-all text-sm text-admin-text">
            {psk || '••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••'}
          </code>
          <p className="mt-2 text-xs text-admin-text-muted">
            A saisir tel quel dans la configuration IPsec du site distant. Chaque consultation est journalisee.
          </p>
        </AdminCardContent>
      </AdminCard>

      <AdminCard>
        <AdminCardHeader>
          <AdminCardTitle>Etat de la SA</AdminCardTitle>
        </AdminCardHeader>
        <AdminCardContent>
          {status?.up && (
            <div className="mb-3 flex flex-wrap gap-4 text-xs text-admin-text-muted">
              <span>{formatBytes(status.rxBytes)} recu</span>
              <span>{formatBytes(status.txBytes)} envoye</span>
            </div>
          )}
          <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-all rounded-lg border border-admin-border bg-admin-surface2 p-3 text-xs text-admin-text">
            {status?.raw || (tunnel.is_enabled ? 'Aucune SA — en attente de negociation.' : 'Tunnel arrete.')}
          </pre>
        </AdminCardContent>
      </AdminCard>

      <AdminButton variant="danger" onClick={deleteTunnel} disabled={actionBusy}>
        <Trash2 className="mr-2 h-4 w-4" /> Supprimer ce tunnel
      </AdminButton>
    </div>
  );
}
