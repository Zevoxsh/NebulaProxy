import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Check, Copy, Loader2, Plus, Wifi } from 'lucide-react';
import { tunnelsAPI } from '../api/client';
import {
  AdminAlert,
  AdminAlertDescription,
  AdminAlertTitle,
  AdminButton,
  AdminCard,
  AdminCardContent,
  AdminCardHeader,
  AdminCardTitle,
  AdminModal,
  AdminModalContent,
  AdminModalDescription,
  AdminModalHeader,
  AdminModalTitle
} from '@/components/admin';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';

export default function TunnelCreate({ mode = 'client' }) {
  const navigate = useNavigate();
  const { toast } = useToast();
  const basePath = mode === 'admin' ? '/admin/tunnels' : '/tunnels';

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [createdTunnelId, setCreatedTunnelId] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [checkingAgent, setCheckingAgent] = useState(false);
  const [installCode, setInstallCode] = useState('');
  const [installExpiresAt, setInstallExpiresAt] = useState('');
  const [installCommands, setInstallCommands] = useState({ linux: '', windows: '' });
  const [copiedField, setCopiedField] = useState('');
  const [form, setForm] = useState({
    name: '',
    description: ''
  });

  const modalSubtitle = useMemo(() => {
    if (!checkingAgent) {
      return 'Preparation de la commande d installation...';
    }

    return 'La fenetre reste ouverte jusqu a la connexion de l agent. Detection automatique en cours...';
  }, [checkingAgent]);

  useEffect(() => {
    if (!modalOpen || !createdTunnelId) return undefined;

    let cancelled = false;
    setCheckingAgent(true);

    const poll = async () => {
      try {
        const response = await tunnelsAPI.getOne(createdTunnelId);
        const tunnel = response.data?.tunnel;
        const onlineAgents = (tunnel?.agents || []).filter((agent) => agent.status === 'online');

        if (!cancelled && onlineAgents.length > 0) {
          toast({ title: 'Agent detecte', description: 'Tunnel pret. Ouverture de l onglet Ports.' });
          navigate(`${basePath}/${createdTunnelId}/ports`);
        }
      } catch {
        // Ignore transient polling errors while waiting for the agent.
      }
    };

    const interval = window.setInterval(poll, 4000);
    poll();

    return () => {
      cancelled = true;
      window.clearInterval(interval);
      setCheckingAgent(false);
    };
  }, [basePath, createdTunnelId, modalOpen, navigate, toast]);

  const handleCopy = async (value, fieldKey) => {
    if (!value) return;

    try {
      await navigator.clipboard.writeText(value);
      setCopiedField(fieldKey);
      setTimeout(() => {
        setCopiedField((current) => (current === fieldKey ? '' : current));
      }, 1200);
      toast({ title: 'Copie', description: 'Commande copiee dans le presse-papiers.' });
    } catch {
      toast({ variant: 'destructive', title: 'Erreur', description: 'Copie automatique impossible.' });
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!form.name.trim()) {
      setError('Le nom du tunnel est requis.');
      return;
    }

    try {
      setSaving(true);
      setError('');
      const payload = {
        name: form.name.trim(),
        description: form.description.trim() || undefined
      };
      const response = await tunnelsAPI.create(payload);
      const tunnelId = response.data.tunnel.id;

      const codeResponse = await tunnelsAPI.generateCode(tunnelId, {});

      setCreatedTunnelId(tunnelId);
      setInstallCode(codeResponse.data.code || '');
      setInstallExpiresAt(codeResponse.data.expiresAt || '');
      setInstallCommands({
        linux: codeResponse.data.linuxCommand || '',
        windows: codeResponse.data.windowsCommand || ''
      });
      setModalOpen(true);

      toast({ title: 'Tunnel cree', description: 'Installe maintenant l agent avec la commande affichee.' });
    } catch (err) {
      setError(err.response?.data?.message || 'Impossible de creer le tunnel');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div data-admin-theme className="space-y-6 max-w-4xl pb-10">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.22em] text-admin-text-muted">Tunnels</p>
          <h1 className="mt-1 text-3xl font-semibold text-admin-text">Creer un tunnel</h1>
        </div>
        <AdminButton variant="secondary" onClick={() => navigate(basePath)}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Retour
        </AdminButton>
      </div>

      {error && (
        <AdminAlert variant="destructive">
          <AdminAlertTitle>Erreur</AdminAlertTitle>
          <AdminAlertDescription>{error}</AdminAlertDescription>
        </AdminAlert>
      )}

      <AdminCard>
        <AdminCardHeader>
          <AdminCardTitle className="flex items-center gap-2">
            <Plus className="h-4 w-4 text-admin-primary" />
            Nouveau tunnel
          </AdminCardTitle>
        </AdminCardHeader>
        <AdminCardContent className="p-6">
          <form className="space-y-4" onSubmit={handleSubmit}>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2 md:col-span-2">
                <Label className="text-admin-text-muted">Nom</Label>
                <Input
                  value={form.name}
                  onChange={(e) => setForm((current) => ({ ...current, name: e.target.value }))}
                  placeholder="serveur-01"
                  className="border-admin-border bg-admin-surface2 text-admin-text placeholder:text-admin-text-muted"
                />
              </div>
              <div className="space-y-2 md:col-span-2">
                <Label className="text-admin-text-muted">Description</Label>
                <Textarea
                  value={form.description}
                  onChange={(e) => setForm((current) => ({ ...current, description: e.target.value }))}
                  placeholder="Machine Linux derriere NAT"
                  className="min-h-28 border-admin-border bg-admin-surface2 text-admin-text placeholder:text-admin-text-muted"
                />
              </div>
            </div>

            <AdminButton type="submit" disabled={saving} className="w-full">
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
              Creer le tunnel
            </AdminButton>
          </form>
        </AdminCardContent>
      </AdminCard>

      <AdminModal open={modalOpen} onOpenChange={() => {}}>
        <AdminModalContent
          className="max-w-3xl border-admin-border bg-admin-surface text-admin-text"
          onEscapeKeyDown={(event) => event.preventDefault()}
          onPointerDownOutside={(event) => event.preventDefault()}
          onInteractOutside={(event) => event.preventDefault()}
        >
          <AdminModalHeader>
            <AdminModalTitle className="flex items-center gap-2">
              <Wifi className="h-5 w-5 text-admin-primary" />
              Installation de l agent
            </AdminModalTitle>
            <AdminModalDescription className="text-admin-text-muted">
              {modalSubtitle}
            </AdminModalDescription>
          </AdminModalHeader>

          <div className="space-y-4 pt-4">
            <div className="rounded-2xl border border-admin-border bg-admin-surface2 p-4">
              <div className="text-xs uppercase tracking-[0.2em] text-admin-text-muted">Code enrollment</div>
              <div className="mt-2 break-all font-mono text-sm text-admin-text">{installCode || 'Generation en cours...'}</div>
              <div className="mt-2 text-xs text-admin-text-muted">
                {installExpiresAt ? `Expire le ${installExpiresAt}` : 'Code a usage unique'}
              </div>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <div className="rounded-2xl border border-admin-border bg-admin-surface2 p-4">
                <div className="mb-2 flex items-center justify-between text-xs text-admin-text-muted">
                  <span>Linux</span>
                  <AdminButton type="button" variant="ghost" onClick={() => handleCopy(installCommands.linux, 'linux')}>
                    {copiedField === 'linux' ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                  </AdminButton>
                </div>
                <code className="block break-all rounded-xl border border-admin-border bg-admin-surface p-3 text-[11px] leading-6 text-admin-text-muted">
                  {installCommands.linux || 'Commande en cours de preparation...'}
                </code>
              </div>

              <div className="rounded-2xl border border-admin-border bg-admin-surface2 p-4">
                <div className="mb-2 flex items-center justify-between text-xs text-admin-text-muted">
                  <span>Windows</span>
                  <AdminButton type="button" variant="ghost" onClick={() => handleCopy(installCommands.windows, 'windows')}>
                    {copiedField === 'windows' ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                  </AdminButton>
                </div>
                <code className="block break-all rounded-xl border border-admin-border bg-admin-surface p-3 text-[11px] leading-6 text-admin-text-muted">
                  {installCommands.windows || 'Commande en cours de preparation...'}
                </code>
              </div>
            </div>

            <div className="flex items-center gap-2 rounded-xl border border-admin-success/30 bg-admin-success/10 px-3 py-2 text-xs text-admin-success">
              <Loader2 className="h-4 w-4 animate-spin" />
              Detection automatique de l agent active.
            </div>
          </div>
        </AdminModalContent>
      </AdminModal>
    </div>
  );
}
