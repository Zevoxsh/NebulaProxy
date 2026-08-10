import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Check, Copy, Loader2, Plus, Terminal } from 'lucide-react';
import { tunnelsAPI } from '../api/client';
import { useToast } from '@/hooks/use-toast';

export default function TunnelCreate() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const basePath = '/tunnels';

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
      return 'Préparation de la commande d\'installation...';
    }

    return 'La fenêtre reste ouverte jusqu\'à la connexion de l\'agent. Détection automatique en cours...';
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
          toast({ title: 'Agent détecté', description: 'Tunnel prêt. Ouverture de l\'onglet Ports.' });
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
  }, [createdTunnelId, modalOpen, navigate, toast]);

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
      setError(err.response?.data?.message || 'Impossible de créer le tunnel');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="page-shell">
      <div className="page-header">
        <div className="page-header-inner">
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div>
              <p className="text-xs uppercase tracking-[0.22em] text-white/40">Tunnels</p>
              <h1 className="text-2xl md:text-3xl font-light text-white tracking-tight mt-1">Créer un tunnel</h1>
              <p className="text-sm text-white/50 font-light mt-1">Création rapide : nom, description puis installation agent.</p>
            </div>
            <button onClick={() => navigate(basePath)} className="btn-secondary flex items-center gap-2 text-xs px-4 py-2">
              <ArrowLeft className="w-4 h-4" />
              Retour
            </button>
          </div>
        </div>
      </div>

      <div className="page-body">
        <div className="max-w-2xl">
          {error && (
            <div className="bg-[#EF4444]/10 backdrop-blur-2xl border border-[#EF4444]/20 rounded-xl p-4 mb-5 flex items-start gap-3">
              <p className="text-xs text-[#F87171] font-light">{error}</p>
            </div>
          )}

          <div className="bg-[#161722]/50 backdrop-blur-2xl border border-white/[0.08] rounded-xl overflow-hidden">
            <div className="flex items-center gap-3 px-4 py-3 border-b border-white/[0.08]">
              <div className="w-9 h-9 rounded-lg flex items-center justify-center border"
                style={{ background: '#9D4EDD18', borderColor: '#9D4EDD44' }}>
                <Plus className="w-4 h-4" style={{ color: '#9D4EDD' }} strokeWidth={1.5} />
              </div>
              <p className="text-sm font-medium text-white">Nouveau tunnel</p>
            </div>
            <div className="p-6">
              <form className="space-y-5" onSubmit={handleSubmit}>
                <div>
                  <label className="text-xs font-medium uppercase tracking-wider text-white/60 mb-2 block">Nom</label>
                  <input
                    value={form.name}
                    onChange={(e) => setForm((current) => ({ ...current, name: e.target.value }))}
                    placeholder="serveur-01"
                    className="input-futuristic text-xs"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium uppercase tracking-wider text-white/60 mb-2 block">Description</label>
                  <textarea
                    value={form.description}
                    onChange={(e) => setForm((current) => ({ ...current, description: e.target.value }))}
                    placeholder="Machine Linux derrière NAT"
                    className="input-futuristic text-xs min-h-32"
                  />
                </div>

                <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] px-4 py-3 text-xs text-white/50">
                  Après création, une fenêtre d'installation apparaît automatiquement avec la commande agent.
                </div>

                <button type="submit" disabled={saving} className="btn-primary w-full text-sm py-3 flex items-center justify-center gap-2">
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                  Créer le tunnel
                </button>
              </form>
            </div>
          </div>
        </div>
      </div>

      {modalOpen && (
        <div className="fixed inset-0 bg-[#0B0C0F]/80 backdrop-blur-2xl flex items-center justify-center z-50 p-4 animate-fade-in">
          <div className="card-modal max-w-2xl w-full animate-scale-in max-h-[90vh] overflow-y-auto">
            <div className="flex items-center gap-3 mb-1">
              <div className="w-9 h-9 rounded-lg flex items-center justify-center border flex-shrink-0"
                style={{ background: '#9D4EDD18', borderColor: '#9D4EDD44' }}>
                <Terminal className="w-4 h-4" style={{ color: '#9D4EDD' }} strokeWidth={1.5} />
              </div>
              <h2 className="text-base font-light text-white">Installation de l'agent</h2>
            </div>
            <p className="text-xs text-white/50 mb-5 ml-12">{modalSubtitle}</p>

            <div className="space-y-4">
              <div className="grid gap-4 rounded-xl border border-white/[0.08] bg-white/[0.03] p-4 md:grid-cols-[1fr_auto] md:items-center">
                <div>
                  <div className="text-[11px] uppercase tracking-[0.2em] text-white/40">Code enrollment</div>
                  <div className="mt-2 break-all rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2 font-mono text-sm text-white">
                    {installCode || 'Génération en cours...'}
                  </div>
                  <div className="mt-2 text-xs text-white/40">
                    {installExpiresAt ? `Expire le ${installExpiresAt}` : 'Code à usage unique'}
                  </div>
                </div>
                <button type="button" onClick={() => handleCopy(installCode, 'code')} className="btn-secondary flex items-center gap-2 text-xs px-4 py-2 w-full md:w-auto">
                  {copiedField === 'code' ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                  Copier le code
                </button>
              </div>

              <div className="grid gap-4 lg:grid-cols-2">
                <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-4">
                  <div className="mb-2 flex items-center justify-between text-xs text-white/50">
                    <span className="font-medium text-white">Linux</span>
                    <button type="button" onClick={() => handleCopy(installCommands.linux, 'linux')} className="btn-secondary flex items-center gap-2 text-xs px-3 py-1.5">
                      {copiedField === 'linux' ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                      Copier
                    </button>
                  </div>
                  <code className="block break-all rounded-lg border border-white/[0.08] bg-black/20 p-3 text-[11px] leading-6 text-white/50">
                    {installCommands.linux || 'Commande en cours de préparation...'}
                  </code>
                </div>

                <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-4">
                  <div className="mb-2 flex items-center justify-between text-xs text-white/50">
                    <span className="font-medium text-white">Windows</span>
                    <button type="button" onClick={() => handleCopy(installCommands.windows, 'windows')} className="btn-secondary flex items-center gap-2 text-xs px-3 py-1.5">
                      {copiedField === 'windows' ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                      Copier
                    </button>
                  </div>
                  <code className="block break-all rounded-lg border border-white/[0.08] bg-black/20 p-3 text-[11px] leading-6 text-white/50">
                    {installCommands.windows || 'Commande en cours de préparation...'}
                  </code>
                </div>
              </div>

              <div className="flex items-center justify-between gap-3 rounded-xl border border-[#10B981]/30 bg-[#10B981]/10 px-4 py-3 text-xs text-[#34D399]">
                <div className="flex items-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Détection automatique de l'agent active.
                </div>
                <div className="rounded-full border border-[#10B981]/40 px-2 py-0.5 text-[10px] uppercase tracking-[0.16em]">
                  En attente
                </div>
              </div>

              <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] px-4 py-3 text-xs text-white/50">
                1. Copie une commande ci-dessus.
                <br />
                2. Exécute-la sur la machine cible.
                <br />
                3. La fenêtre se fermera automatiquement dès que l'agent est connecté.
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
