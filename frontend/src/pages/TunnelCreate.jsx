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
      const response = await tunnelsAPI.create(form);
      toast({ title: 'Tunnel created', description: response.data.tunnel.name });
      navigate(`${basePath}/${response.data.tunnel.id}`);
    } catch (err) {
      setError(err.response?.data?.message || 'Impossible de creer le tunnel');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6 max-w-4xl pb-10">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.22em] text-white/35">Tunnels</p>
          <h1 className="mt-1 text-3xl font-semibold text-white">Create tunnel</h1>
        </div>
        <AdminButton variant="secondary" onClick={() => navigate(basePath)} className="border-white/10 bg-white/[0.03] text-white hover:bg-white/[0.06]">
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back
        </AdminButton>
      </div>

      {error && (
        <AdminAlert variant="destructive" className="border-red-500/20 bg-red-500/10 text-red-100">
          <AdminAlertTitle>Error</AdminAlertTitle>
          <AdminAlertDescription>{error}</AdminAlertDescription>
        </AdminAlert>
      )}

      <AdminCard className="rounded-[1.75rem] border-white/10 bg-slate-950/70 shadow-[0_24px_70px_rgba(0,0,0,0.25)] backdrop-blur-xl">
        <AdminCardHeader className="border-b border-white/10 bg-white/[0.02]">
          <AdminCardTitle className="flex items-center gap-2 text-white">
            <Plus className="h-4 w-4 text-cyan-300" />
            New tunnel
          </AdminCardTitle>
        </AdminCardHeader>
        <AdminCardContent className="p-6">
          <form className="space-y-4" onSubmit={handleSubmit}>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2 md:col-span-2">
                <Label className="text-white/70">Name</Label>
                <Input
                  value={form.name}
                  onChange={(e) => setForm((current) => ({ ...current, name: e.target.value }))}
                  placeholder="workstation-01"
                  className="border-white/10 bg-white/[0.03] text-white placeholder:text-white/30"
                />
              </div>
              <div className="space-y-2 md:col-span-2">
                <Label className="text-white/70">Description</Label>
                <Textarea
                  value={form.description}
                  onChange={(e) => setForm((current) => ({ ...current, description: e.target.value }))}
                  placeholder="Linux host behind NAT"
                  className="min-h-28 border-white/10 bg-white/[0.03] text-white placeholder:text-white/30"
                />
              </div>
              <div className="space-y-2">
                <Label className="text-white/70">Provider</Label>
                <Select value={form.provider} onValueChange={(value) => setForm((current) => ({ ...current, provider: value }))}>
                  <SelectTrigger className="border-white/10 bg-white/[0.03] text-white">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cloudflare">Cloudflare</SelectItem>
                    <SelectItem value="manual">Manual</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label className="text-white/70">Public domain (optional)</Label>
                <Input
                  value={form.publicDomain}
                  onChange={(e) => setForm((current) => ({ ...current, publicDomain: e.target.value }))}
                  placeholder="tunnel.example.com"
                  className="border-white/10 bg-white/[0.03] text-white placeholder:text-white/30"
                />
              </div>
            </div>

            <AdminButton type="submit" disabled={saving} className="w-full bg-gradient-to-r from-cyan-500 to-blue-600 text-white hover:from-cyan-400 hover:to-blue-500">
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
              Create tunnel
            </AdminButton>
          </form>
        </AdminCardContent>
      </AdminCard>
    </div>
  );
}
