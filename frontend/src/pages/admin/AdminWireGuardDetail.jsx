import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft, Check, Copy, Download, Key, Loader2, Plus, Power, PowerOff, RefreshCw, Trash2, Wifi, WifiOff
} from 'lucide-react';
import { wireguardAPI } from '../../api/client';
import {
  AdminAlert,
  AdminAlertDescription,
  AdminAlertTitle,
  AdminButton,
  AdminCard,
  AdminCardContent,
  AdminCardHeader,
  AdminCardTitle,
  AdminBadge,
  AdminModal,
  AdminModalContent,
  AdminModalHeader,
  AdminModalTitle,
  AdminModalFooter
} from '@/components/admin';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const emptyPeerForm = {
  name: '', allowedIps: '', endpointHost: '', endpointPort: '', persistentKeepalive: '',
  publicKey: '', generateKeypair: true, generatePresharedKey: false
};

function formatBytes(n) {
  if (!n) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = n;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) { value /= 1024; i += 1; }
  return `${value.toFixed(1)} ${units[i]}`;
}

function formatHandshake(iso) {
  if (!iso) return 'Jamais';
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return `il y a ${seconds}s`;
  if (seconds < 3600) return `il y a ${Math.floor(seconds / 60)}min`;
  return `il y a ${Math.floor(seconds / 3600)}h`;
}

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

export default function AdminWireGuardDetail() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tunnel, setTunnel] = useState(null);
  const [peers, setPeers] = useState([]);
  const [actionBusy, setActionBusy] = useState(false);

  const [addingPeer, setAddingPeer] = useState(false);
  const [peerForm, setPeerForm] = useState(emptyPeerForm);
  const [peerSubmitting, setPeerSubmitting] = useState(false);
  const [peerFormError, setPeerFormError] = useState('');
  const [revealPeer, setRevealPeer] = useState(null); // { generatedPrivateKey, presharedKey, peerConfig, peerName }

  const refresh = async () => {
    try {
      setError('');
      const response = await wireguardAPI.get(id);
      setTunnel(response.data.tunnel);
      setPeers(response.data.peers || []);
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
      if (tunnel.running) await wireguardAPI.disable(id);
      else await wireguardAPI.enable(id);
      await refresh();
    } catch (err) {
      setError(err.response?.data?.message || 'Action impossible');
    } finally {
      setActionBusy(false);
    }
  };

  const rotateKeys = async () => {
    if (!window.confirm('Regenerer les cles de ce tunnel ? Tous les peers devront etre reconfigures avec la nouvelle cle publique.')) return;
    setActionBusy(true);
    try {
      await wireguardAPI.rotateKeys(id);
      await refresh();
    } catch (err) {
      setError(err.response?.data?.message || 'Impossible de regenerer les cles');
    } finally {
      setActionBusy(false);
    }
  };

  const deleteTunnel = async () => {
    if (!window.confirm(`Supprimer le tunnel "${tunnel.name}" ? Cette action est irreversible.`)) return;
    setActionBusy(true);
    try {
      await wireguardAPI.delete(id);
      navigate('/admin/wireguard');
    } catch (err) {
      setError(err.response?.data?.message || 'Impossible de supprimer ce tunnel');
      setActionBusy(false);
    }
  };

  const downloadConfig = async () => {
    const response = await wireguardAPI.downloadConfig(id);
    const url = window.URL.createObjectURL(new Blob([response.data]));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${tunnel.interface_name}.conf`;
    a.click();
    window.URL.revokeObjectURL(url);
  };

  const openAddPeer = () => {
    setPeerForm(emptyPeerForm);
    setPeerFormError('');
    setAddingPeer(true);
  };

  const handleAddPeer = async (e) => {
    e.preventDefault();
    setPeerSubmitting(true);
    setPeerFormError('');
    try {
      const payload = {
        name: peerForm.name.trim(),
        allowedIps: peerForm.allowedIps.trim(),
        generateKeypair: peerForm.generateKeypair,
        generatePresharedKey: peerForm.generatePresharedKey
      };
      if (!peerForm.generateKeypair) payload.publicKey = peerForm.publicKey.trim();
      if (peerForm.endpointHost) payload.endpointHost = peerForm.endpointHost.trim();
      if (peerForm.endpointPort) payload.endpointPort = Number.parseInt(peerForm.endpointPort, 10);
      if (peerForm.persistentKeepalive) payload.persistentKeepalive = Number.parseInt(peerForm.persistentKeepalive, 10);

      const response = await wireguardAPI.addPeer(id, payload);
      setAddingPeer(false);
      await refresh();

      if (response.data.generatedPrivateKey) {
        setRevealPeer({
          peerName: payload.name,
          generatedPrivateKey: response.data.generatedPrivateKey,
          presharedKey: response.data.presharedKey,
          peerConfig: response.data.peerConfig
        });
      }
    } catch (err) {
      setPeerFormError(err.response?.data?.message || 'Impossible d ajouter ce peer');
    } finally {
      setPeerSubmitting(false);
    }
  };

  const deletePeer = async (peer) => {
    if (!window.confirm(`Retirer le peer "${peer.name}" ?`)) return;
    try {
      await wireguardAPI.deletePeer(id, peer.id);
      await refresh();
    } catch (err) {
      setError(err.response?.data?.message || 'Impossible de retirer ce peer');
    }
  };

  const downloadPeerConfig = () => {
    const blob = new Blob([revealPeer.peerConfig], { type: 'text/plain' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${revealPeer.peerName.replace(/[^a-z0-9-]/gi, '_')}.conf`;
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
        <AdminButton variant="secondary" onClick={() => navigate('/admin/wireguard')}>
          <ArrowLeft className="mr-2 h-4 w-4" /> Retour
        </AdminButton>
      </div>
    );
  }

  return (
    <div data-admin-theme className="space-y-6 pb-8">
      <button
        type="button"
        onClick={() => navigate('/admin/wireguard')}
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
            <span className="rounded-full border border-admin-border bg-admin-surface2 px-2.5 py-1 font-mono">{tunnel.interface_name}</span>
            <span className="rounded-full border border-admin-border bg-admin-surface2 px-2.5 py-1 font-mono">{tunnel.address}</span>
            {tunnel.listen_port && <span className="rounded-full border border-admin-border bg-admin-surface2 px-2.5 py-1">Port {tunnel.listen_port}</span>}
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <AdminButton variant="secondary" onClick={refresh}>
            <RefreshCw className="mr-2 h-4 w-4" /> Actualiser
          </AdminButton>
          <AdminButton variant="secondary" onClick={downloadConfig}>
            <Download className="mr-2 h-4 w-4" /> Exporter la conf
          </AdminButton>
          <AdminButton variant="secondary" onClick={rotateKeys} disabled={actionBusy}>
            <Key className="mr-2 h-4 w-4" /> Regenerer les cles
          </AdminButton>
          <AdminButton onClick={toggleEnabled} disabled={actionBusy} variant={tunnel.running ? 'danger' : 'default'}>
            {tunnel.running ? <PowerOff className="mr-2 h-4 w-4" /> : <Power className="mr-2 h-4 w-4" />}
            {tunnel.running ? 'Arreter' : 'Demarrer'}
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
          <AdminCardTitle>Cle publique de ce tunnel</AdminCardTitle>
          <CopyButton text={tunnel.public_key} />
        </AdminCardHeader>
        <AdminCardContent>
          <code className="block break-all text-sm text-admin-text">{tunnel.public_key}</code>
          <p className="mt-2 text-xs text-admin-text-muted">
            A communiquer au site distant pour qu il t ajoute comme peer de son cote.
          </p>
        </AdminCardContent>
      </AdminCard>

      <AdminCard>
        <AdminCardHeader className="flex flex-row items-center justify-between">
          <AdminCardTitle>Peers ({peers.length})</AdminCardTitle>
          <AdminButton onClick={openAddPeer}>
            <Plus className="mr-2 h-4 w-4" /> Ajouter un peer
          </AdminButton>
        </AdminCardHeader>
        <AdminCardContent>
          {peers.length === 0 ? (
            <p className="py-6 text-center text-sm text-admin-text-muted">Aucun peer configure sur ce tunnel.</p>
          ) : (
            <div className="space-y-3">
              {peers.map((peer) => (
                <div key={peer.id} className="rounded-lg border border-admin-border bg-admin-surface2 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-admin-text">{peer.name}</span>
                        <AdminBadge variant={peer.status ? 'success' : 'secondary'}>
                          {peer.status ? 'Connecte' : 'Jamais vu'}
                        </AdminBadge>
                      </div>
                      <div className="mt-1 flex flex-wrap gap-2 text-[11px] text-admin-text-muted">
                        <span className="font-mono">{peer.allowed_ips}</span>
                        {peer.endpoint_host && <span className="font-mono">{peer.endpoint_host}:{peer.endpoint_port}</span>}
                        {peer.status && (
                          <>
                            <span>Dernier handshake: {formatHandshake(peer.status.latestHandshakeAt)}</span>
                            <span>{formatBytes(peer.status.rxBytes)} recu / {formatBytes(peer.status.txBytes)} envoye</span>
                          </>
                        )}
                      </div>
                    </div>
                    <AdminButton variant="danger" size="sm" onClick={() => deletePeer(peer)}>
                      <Trash2 className="h-4 w-4" />
                    </AdminButton>
                  </div>
                </div>
              ))}
            </div>
          )}
        </AdminCardContent>
      </AdminCard>

      <AdminButton variant="danger" onClick={deleteTunnel} disabled={actionBusy}>
        <Trash2 className="mr-2 h-4 w-4" /> Supprimer ce tunnel
      </AdminButton>

      {/* Add peer modal */}
      <AdminModal open={addingPeer} onOpenChange={setAddingPeer}>
        <AdminModalContent>
          <AdminModalHeader>
            <AdminModalTitle>Ajouter un peer</AdminModalTitle>
          </AdminModalHeader>
          <form onSubmit={handleAddPeer}>
            <div className="space-y-4 py-4">
              {peerFormError && (
                <AdminAlert variant="danger">
                  <AdminAlertDescription>{peerFormError}</AdminAlertDescription>
                </AdminAlert>
              )}
              <div className="space-y-2">
                <Label className="text-admin-text">Nom</Label>
                <Input
                  value={peerForm.name}
                  onChange={(e) => setPeerForm({ ...peerForm, name: e.target.value })}
                  className="bg-admin-bg border-admin-border text-admin-text"
                  placeholder="Site Lyon"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label className="text-admin-text">Allowed IPs (CIDR)</Label>
                <Input
                  value={peerForm.allowedIps}
                  onChange={(e) => setPeerForm({ ...peerForm, allowedIps: e.target.value })}
                  className="bg-admin-bg border-admin-border text-admin-text font-mono"
                  placeholder="10.10.0.2/32 ou 192.168.2.0/24"
                  required
                />
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="generateKeypair"
                  checked={peerForm.generateKeypair}
                  onChange={(e) => setPeerForm({ ...peerForm, generateKeypair: e.target.checked })}
                  className="h-4 w-4 rounded border-admin-border"
                />
                <Label htmlFor="generateKeypair" className="text-admin-text cursor-pointer">
                  Generer la cle pour ce peer (config prete a telecharger)
                </Label>
              </div>
              {!peerForm.generateKeypair && (
                <div className="space-y-2">
                  <Label className="text-admin-text">Cle publique du peer</Label>
                  <Input
                    value={peerForm.publicKey}
                    onChange={(e) => setPeerForm({ ...peerForm, publicKey: e.target.value })}
                    className="bg-admin-bg border-admin-border text-admin-text font-mono"
                    required={!peerForm.generateKeypair}
                  />
                </div>
              )}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label className="text-admin-text">Endpoint (optionnel)</Label>
                  <Input
                    value={peerForm.endpointHost}
                    onChange={(e) => setPeerForm({ ...peerForm, endpointHost: e.target.value })}
                    className="bg-admin-bg border-admin-border text-admin-text"
                    placeholder="1.2.3.4"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-admin-text">Port endpoint</Label>
                  <Input
                    type="number"
                    value={peerForm.endpointPort}
                    onChange={(e) => setPeerForm({ ...peerForm, endpointPort: e.target.value })}
                    className="bg-admin-bg border-admin-border text-admin-text"
                    placeholder="51820"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label className="text-admin-text">Keepalive (secondes, optionnel)</Label>
                <Input
                  type="number"
                  value={peerForm.persistentKeepalive}
                  onChange={(e) => setPeerForm({ ...peerForm, persistentKeepalive: e.target.value })}
                  className="bg-admin-bg border-admin-border text-admin-text"
                  placeholder="25 (utile derriere du NAT)"
                />
              </div>
            </div>
            <AdminModalFooter>
              <AdminButton type="button" variant="secondary" onClick={() => setAddingPeer(false)}>
                Annuler
              </AdminButton>
              <AdminButton type="submit" disabled={peerSubmitting}>
                {peerSubmitting ? 'Ajout...' : 'Ajouter'}
              </AdminButton>
            </AdminModalFooter>
          </form>
        </AdminModalContent>
      </AdminModal>

      {/* Reveal generated peer key/config — shown once */}
      <AdminModal open={Boolean(revealPeer)} onOpenChange={(open) => !open && setRevealPeer(null)}>
        <AdminModalContent>
          <AdminModalHeader>
            <AdminModalTitle>Config pour {revealPeer?.peerName}</AdminModalTitle>
          </AdminModalHeader>
          <div className="space-y-3 py-4">
            <AdminAlert>
              <AdminAlertDescription>
                La cle privee n est affichee qu une seule fois — copie ou telecharge la conf maintenant.
              </AdminAlertDescription>
            </AdminAlert>
            <div className="rounded-lg border border-admin-border bg-admin-surface2 p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs uppercase tracking-wide text-admin-text-muted">wg-quick .conf</span>
                <CopyButton text={revealPeer?.peerConfig || ''} />
              </div>
              <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all text-xs text-admin-text">{revealPeer?.peerConfig}</pre>
            </div>
          </div>
          <AdminModalFooter>
            <AdminButton variant="secondary" onClick={() => setRevealPeer(null)}>Fermer</AdminButton>
            <AdminButton onClick={downloadPeerConfig}>
              <Download className="mr-2 h-4 w-4" /> Telecharger
            </AdminButton>
          </AdminModalFooter>
        </AdminModalContent>
      </AdminModal>
    </div>
  );
}
