import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Check, Copy, Loader2, Plus, Terminal, Wifi } from 'lucide-react';
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
    } catch (err) {
      setError(err.response?.data?.message || 'Impossible de creer le tunnel');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div data-admin-theme className="pb-10">
      <div className="mx-auto w-full max-w-3xl px-4 pt-6 md:px-6 md:pt-10">
        <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="max-w-2xl">
            <p className="text-xs uppercase tracking-[0.22em] text-admin-text-muted">Tunnels</p>
            <h1 className="mt-1 text-3xl font-semibold text-admin-text sm:text-4xl">Creer un tunnel</h1>
            <p className="mt-2 text-sm leading-6 text-admin-text-muted">Creation rapide: nom, description puis installation agent.</p>
          </div>
          <AdminButton variant="secondary" onClick={() => navigate(basePath)} className="w-full sm:w-auto">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Retour
          </AdminButton>
        </div>

        {error && (
          <AdminAlert variant="destructive" className="mb-5">
            <AdminAlertTitle>Erreur</AdminAlertTitle>
            <AdminAlertDescription>{error}</AdminAlertDescription>
          </AdminAlert>
        )}

        <AdminCard className="overflow-hidden border-admin-border/80 bg-gradient-to-b from-admin-surface to-admin-surface2 shadow-[0_24px_80px_rgba(0,0,0,0.35)]">
          <AdminCardHeader className="border-b border-admin-border/80 bg-admin-surface/60 px-5 py-4 md:px-6">
            <AdminCardTitle className="flex items-center gap-2 text-xl">
              <Plus className="h-5 w-5 text-admin-primary" />
              Nouveau tunnel
            </AdminCardTitle>
          </AdminCardHeader>
          <AdminCardContent className="p-6 md:p-7">
            <form className="space-y-5" onSubmit={handleSubmit}>
              <div className="space-y-2">
                <Label className="text-admin-text-muted">Nom</Label>
                <Input
                  value={form.name}
                  onChange={(e) => setForm((current) => ({ ...current, name: e.target.value }))}
                  placeholder="serveur-01"
                  className="h-12 border-admin-border bg-admin-surface text-admin-text placeholder:text-admin-text-muted"
                />
              </div>
              <div className="space-y-2">
                <Label className="text-admin-text-muted">Description</Label>
                <Textarea
                  value={form.description}
                  onChange={(e) => setForm((current) => ({ ...current, description: e.target.value }))}
                  placeholder="Machine Linux derriere NAT"
                  className="min-h-32 border-admin-border bg-admin-surface text-admin-text placeholder:text-admin-text-muted"
                />
              </div>

              <div className="rounded-xl border border-admin-border bg-admin-surface/70 px-4 py-3 text-xs text-admin-text-muted">
                Apres creation, une fenetre d installation apparait automatiquement avec la commande agent.
              </div>

              <AdminButton type="submit" disabled={saving} className="h-12 w-full text-sm font-semibold">
                {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
                Creer le tunnel
              </AdminButton>
            </form>
          </AdminCardContent>
        </AdminCard>
      </div>

      <AdminModal open={modalOpen} onOpenChange={() => {}}>
        <AdminModalContent
          className="max-w-[calc(100vw-1.5rem)] border-admin-border bg-gradient-to-b from-admin-surface to-admin-surface2 text-admin-text shadow-2xl sm:max-w-4xl [&>button]:hidden"
          onEscapeKeyDown={(event) => event.preventDefault()}
          onPointerDownOutside={(event) => event.preventDefault()}
          onInteractOutside={(event) => event.preventDefault()}
        >
          <AdminModalHeader>
            <AdminModalTitle className="flex items-center gap-3 text-2xl">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-admin-primary/30 bg-admin-primary/10">
                <Terminal className="h-5 w-5 text-admin-primary" />
              </div>
              Installation de l agent
            </AdminModalTitle>
            <AdminModalDescription className="pt-1 text-sm text-admin-text-muted">
              {modalSubtitle}
            </AdminModalDescription>
          </AdminModalHeader>

          <div className="space-y-5 pt-4">
            <div className="grid gap-4 rounded-2xl border border-admin-border bg-admin-surface p-4 md:grid-cols-[1fr_auto] md:items-center">
              <div>
                <div className="text-[11px] uppercase tracking-[0.2em] text-admin-text-muted">Code enrollment</div>
                <div className="mt-2 break-all rounded-lg border border-admin-border bg-admin-surface2 px-3 py-2 font-mono text-sm text-admin-text">
                  {installCode || 'Generation en cours...'}
                </div>
                <div className="mt-2 text-xs text-admin-text-muted">
                  {installExpiresAt ? `Expire le ${installExpiresAt}` : 'Code a usage unique'}
                </div>
              </div>
              <AdminButton type="button" variant="secondary" onClick={() => handleCopy(installCode, 'code')} className="w-full md:w-auto">
                {copiedField === 'code' ? <Check className="mr-2 h-4 w-4" /> : <Copy className="mr-2 h-4 w-4" />}
                Copier le code
              </AdminButton>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <div className="rounded-2xl border border-admin-border bg-admin-surface p-4">
                <div className="mb-2 flex items-center justify-between text-xs text-admin-text-muted">
                  <span className="font-medium text-admin-text">Linux</span>
                  <AdminButton type="button" variant="secondary" onClick={() => handleCopy(installCommands.linux, 'linux')} className="w-full sm:w-auto">
                    {copiedField === 'linux' ? <Check className="mr-2 h-4 w-4" /> : <Copy className="mr-2 h-4 w-4" />}
                    Copier
                  </AdminButton>
                </div>
                <code className="block break-all rounded-xl border border-admin-border bg-admin-surface p-3 text-[11px] leading-6 text-admin-text-muted">
                  {installCommands.linux || 'Commande en cours de preparation...'}
                </code>
              </div>

              <div className="rounded-2xl border border-admin-border bg-admin-surface p-4">
                <div className="mb-2 flex items-center justify-between text-xs text-admin-text-muted">
                  <span className="font-medium text-admin-text">Windows</span>
                  <AdminButton type="button" variant="secondary" onClick={() => handleCopy(installCommands.windows, 'windows')} className="w-full sm:w-auto">
                    {copiedField === 'windows' ? <Check className="mr-2 h-4 w-4" /> : <Copy className="mr-2 h-4 w-4" />}
                    Copier
                  </AdminButton>
                </div>
                <code className="block break-all rounded-xl border border-admin-border bg-admin-surface p-3 text-[11px] leading-6 text-admin-text-muted">
                  {installCommands.windows || 'Commande en cours de preparation...'}
                </code>
              </div>
            </div>

            <div className="flex items-center justify-between gap-3 rounded-xl border border-admin-success/30 bg-admin-success/10 px-4 py-3 text-xs text-admin-success">
              <div className="flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                Detection automatique de l agent active.
              </div>
              <div className="rounded-full border border-admin-success/40 px-2 py-0.5 text-[10px] uppercase tracking-[0.16em]">
                En attente
              </div>
            </div>

            <div className="rounded-xl border border-admin-border bg-admin-surface px-4 py-3 text-xs text-admin-text-muted">
              1. Copie une commande ci-dessus.
              <br />
              2. Execute-la sur la machine cible.
              <br />
              3. La fenetre se fermera automatiquement des que l agent est connecte.
            </div>
          </div>
        </AdminModalContent>
      </AdminModal>
    </div>
  );
}
