import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Loader2, Plus } from 'lucide-react';
import { tunnelsAPI } from '../api/client';
import {
  AdminAlert,
  AdminAlertDescription,
  AdminAlertTitle,
  AdminButton,
  AdminCard,
  AdminCardContent,
  AdminCardHeader,
  AdminCardTitle
} from '@/components/admin';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';

export default function TunnelCreate({ mode = 'client' }) {
  const navigate = useNavigate();
  const { toast } = useToast();
  const basePath = mode === 'admin' ? '/admin/tunnels' : '/tunnels';

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({
    name: '',
    description: '',
    provider: 'cloudflare',
    publicDomain: ''
  });

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      setSaving(true);
      setError('');
      const payload = {
        ...form,
        publicDomain: form.publicDomain.trim() ? form.publicDomain.trim() : undefined
      };
      const response = await tunnelsAPI.create(payload);
      toast({ title: 'Tunnel cree', description: response.data.tunnel.name });
      navigate(`${basePath}/${response.data.tunnel.id}`);
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
              <div className="space-y-2">
                <Label className="text-admin-text-muted">Fournisseur</Label>
                <Select value={form.provider} onValueChange={(value) => setForm((current) => ({ ...current, provider: value }))}>
                  <SelectTrigger className="border-admin-border bg-admin-surface2 text-admin-text">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cloudflare">Cloudflare</SelectItem>
                    <SelectItem value="manual">Manuel</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label className="text-admin-text-muted">Domaine public (optionnel)</Label>
                <Input
                  value={form.publicDomain}
                  onChange={(e) => setForm((current) => ({ ...current, publicDomain: e.target.value }))}
                  placeholder="tunnel.example.com"
                  className="border-admin-border bg-admin-surface2 text-admin-text placeholder:text-admin-text-muted"
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
    </div>
  );
}
