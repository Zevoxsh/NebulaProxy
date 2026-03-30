import { useState, useEffect } from 'react';
import { X, AlertCircle, Globe, Zap, Radio, Gamepad2, Plus, Trash2, Layers, Server } from 'lucide-react';
import { useAuthStore } from '../../store/authStore';
import { domainAPI } from '../../api/client';
import { Switch } from '@/components/ui/switch';

const LB_ALGORITHMS = [
  { value: 'round-robin', label: 'Round Robin' },
  { value: 'random', label: 'Random' },
  { value: 'ip-hash', label: 'IP Hash' },
  { value: 'least-connections', label: 'Least Conn.' }
];

export default function DomainForm({ domain, onSubmit, onClose, isLoading = false }) {
  const user = useAuthStore((state) => state.user);
  // Tracks whether the user picked Minecraft→Java or Minecraft→Bedrock.
  // null = user hasn't used the MC sub-selector (e.g. editing an existing domain).
  const [mcVariant, setMcVariant] = useState(null);
  const [formData, setFormData] = useState({
    hostname: '',
    backendUrl: '',
    backendPort: '',
    externalPort: '',
    description: '',
    proxyType: 'http',
    minecraftEdition: 'java',
    sslEnabled: false,
    challengeType: 'http-01',
    fullChain: '',
    privateKey: '',
    // Load Balancing
    loadBalancingEnabled: false,
    loadBalancingAlgorithm: 'round-robin',
    additionalBackends: [] // Array of { url: '', port: '' }
  });
  const [error, setError] = useState('');
  const [loadingBackends, setLoadingBackends] = useState(false);

  useEffect(() => {
    if (domain) {
      // Clean backend URL and split port if present
      let backendUrl = domain.backend_url || '';
      let backendPort = domain.backend_port || '';
      if (backendUrl.includes('://')) {
        try {
          const parsedUrl = new URL(backendUrl);
          if (parsedUrl.port && !backendPort) {
            backendPort = parsedUrl.port;
          }
          if (domain.proxy_type === 'tcp' || domain.proxy_type === 'udp' || domain.proxy_type === 'minecraft') {
            backendUrl = parsedUrl.hostname;
          } else {
            backendUrl = `${parsedUrl.protocol}//${parsedUrl.hostname}`;
          }
        } catch {
          // Keep raw value if parsing fails
        }
      } else if (domain.proxy_type === 'tcp' || domain.proxy_type === 'udp' || domain.proxy_type === 'minecraft') {
        backendUrl = backendUrl.replace(/^(tcp|udp|http|https):\/\//, '');
      }

      setFormData(prev => ({
        ...prev,
        hostname: domain.hostname || '',
        backendUrl: backendUrl,
        backendPort: backendPort,
        externalPort: domain.external_port ? String(domain.external_port) : '',
        description: domain.description || '',
        proxyType: domain.proxy_type || 'http',
        minecraftEdition: domain.minecraft_edition || 'java',
        sslEnabled: domain.ssl_enabled || false,
        challengeType: domain.acme_challenge_type || 'http-01',
        loadBalancingEnabled: domain.load_balancing_enabled || false,
        loadBalancingAlgorithm: domain.load_balancing_algorithm || 'round-robin'
      }));

      // Load existing backends for this domain
      loadExistingBackends(domain.id);
    }
  }, [domain]);

  const loadExistingBackends = async (domainId) => {
    setLoadingBackends(true);
    try {
      const response = await domainAPI.getBackends(domainId);
      const backends = response.data.backends || [];
      setFormData(prev => ({
        ...prev,
        loadBalancingEnabled: response.data.load_balancing_enabled || false,
        loadBalancingAlgorithm: response.data.load_balancing_algorithm || 'round-robin',
        additionalBackends: backends.map(b => ({
          id: b.id,
          url: (() => {
            if (b.backend_url && b.backend_url.includes('://')) {
              try {
                const parsedUrl = new URL(b.backend_url);
                return parsedUrl.hostname;
              } catch {
                return b.backend_url;
              }
            }
            return b.backend_url;
          })(),
          port: b.backend_port || '',
          isActive: b.is_active
        }))
      }));
    } catch (err) {
      console.error('Failed to load backends:', err);
    } finally {
      setLoadingBackends(false);
    }
  };

  // Auto-fill backend port when switching to Minecraft (Java) directly
  useEffect(() => {
    if (formData.proxyType === 'minecraft' && !formData.backendPort) {
      setFormData(prev => ({ ...prev, backendPort: '25565' }));
    }
  }, [formData.proxyType]);

  const selectMcVariant = (variant) => {
    setMcVariant(variant);
    if (variant === 'java') {
      setFormData(prev => ({ ...prev, proxyType: 'minecraft', minecraftEdition: 'java', backendPort: prev.backendPort || '25565', externalPort: '' }));
    } else {
      setFormData(prev => ({ ...prev, proxyType: 'minecraft', minecraftEdition: 'bedrock', backendPort: prev.backendPort || '19132', externalPort: prev.externalPort || '19132' }));
    }
  };

  // Auto-detect wildcard domains and force DNS-01 (HTTP only)
  useEffect(() => {
    if (formData.proxyType !== 'http') return;
    if (formData.hostname.startsWith('*.') && formData.sslEnabled) {
      setFormData(prev => ({
        ...prev,
        challengeType: 'dns-01'
      }));
    }
  }, [formData.hostname, formData.sslEnabled, formData.proxyType]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (!formData.hostname.trim()) {
      setError('Hostname is required');
      return;
    }

    if (!formData.backendUrl.trim()) {
      setError(formData.proxyType === 'http' ? 'Backend URL is required' : 'Backend IP Address is required');
      return;
    }

    if ((formData.proxyType === 'tcp' || formData.proxyType === 'udp' || formData.proxyType === 'minecraft') && user?.role === 'admin' && formData.externalPort) {
      const portNumber = Number(formData.externalPort);
      if (!Number.isInteger(portNumber)) {
        setError('External port must be a valid number');
        return;
      }
      if (portNumber < 1 || portNumber > 65535) {
        setError('External port must be between 1 and 65535');
        return;
      }
    }

    // Validate custom certificate if selected
    if (formData.sslEnabled && formData.challengeType === 'custom') {
      if (!formData.fullChain.trim()) {
        setError('Full chain certificate is required');
        return;
      }
      if (!formData.privateKey.trim()) {
        setError('Private key is required');
        return;
      }
      // Basic PEM format validation
      if (!formData.fullChain.includes('-----BEGIN CERTIFICATE-----')) {
        setError('Invalid certificate format (must be PEM)');
        return;
      }
      if (!formData.privateKey.includes('-----BEGIN') || !formData.privateKey.includes('PRIVATE KEY-----')) {
        setError('Invalid private key format (must be PEM)');
        return;
      }
    }

    // Common regex patterns
    const hostnameRegex = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/i;

    // Validate hostname for HTTP only (TCP/UDP can be any identifier)
    if (formData.proxyType === 'http') {
      const wildcardRegex = /^\*\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/i;

      if (!hostnameRegex.test(formData.hostname) && !wildcardRegex.test(formData.hostname)) {
        setError('Invalid hostname format (e.g., example.com or *.example.com)');
        return;
      }
    }

    // Validate backend URL/IP based on proxy type
    if (formData.proxyType === 'http') {
      try {
        const parsedUrl = new URL(formData.backendUrl);
        if (parsedUrl.port) {
          setError('Backend URL must not include a port. Use the Backend Port field.');
          return;
        }
      } catch {
        setError('Invalid backend URL (must include http:// or https://)');
        return;
      }
    } else {
      // For TCP/UDP/Minecraft, validate IP address or hostname
      const ipRegex = /^(\d{1,3}\.){3}\d{1,3}$/;
      const isValidIp = ipRegex.test(formData.backendUrl);
      const isValidHostname = hostnameRegex.test(formData.backendUrl);

      if (!isValidIp && !isValidHostname) {
        setError('Invalid backend IP address or hostname');
        return;
      }

      // If IP, validate octets are 0-255
      if (isValidIp) {
        const octets = formData.backendUrl.split('.');
        if (octets.some(octet => parseInt(octet) > 255)) {
          setError('Invalid IP address (octets must be 0-255)');
          return;
        }
      }
      // Block host:port in backend URL (use backend port field instead)
      if (/:\d+$/.test(formData.backendUrl)) {
        setError('Backend URL must not include a port. Use the Backend Port field.');
        return;
      }
    }

    // Validate additional backends
    for (const backend of (formData.additionalBackends || [])) {
      if (!backend.url) continue;
      if (formData.proxyType === 'http') {
        try {
          const parsedUrl = new URL(backend.url);
          if (parsedUrl.port) {
            setError('Additional backend URLs must not include a port. Use the Backend Port field.');
            return;
          }
        } catch {
          setError('Invalid additional backend URL (must include http:// or https://)');
          return;
        }
      } else if (/:\d+$/.test(backend.url)) {
        setError('Additional backend URLs must not include a port. Use the Backend Port field.');
        return;
      }
    }

    onSubmit(formData);
  };

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value
    }));
  };

  // Load Balancing helpers
  const addBackend = () => {
    setFormData(prev => ({
      ...prev,
      additionalBackends: [...prev.additionalBackends, { url: '', port: '', isNew: true }]
    }));
  };

  const removeBackend = (index) => {
    setFormData(prev => ({
      ...prev,
      additionalBackends: prev.additionalBackends.filter((_, i) => i !== index)
    }));
  };

  const updateBackend = (index, field, value) => {
    setFormData(prev => ({
      ...prev,
      additionalBackends: prev.additionalBackends.map((b, i) =>
        i === index ? { ...b, [field]: value } : b
      )
    }));
  };

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-[150] p-3">
      <div className="bg-[#161722]/95 backdrop-blur-2xl border border-white/[0.08] rounded-xl shadow-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-white/[0.08]">
          <h2 className="text-base font-light text-white tracking-tight">
            {domain ? 'Edit Domain' : 'Add Domain'}
          </h2>
          <button
            onClick={onClose}
            disabled={isLoading}
            className="text-white/40 hover:text-white/80 transition-colors disabled:opacity-50"
          >
            <X className="w-4 h-4" strokeWidth={1.5} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-4">
          {error && (
            <div className="bg-[#EF4444]/10 border border-[#EF4444]/20 rounded-lg p-2.5 mb-3 flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-[#F87171] flex-shrink-0 mt-0.5" strokeWidth={1.5} />
              <p className="text-xs text-[#F87171]">{error}</p>
            </div>
          )}

          {/* Proxy Type Selection */}
          <div className="mb-3">
            <label className="text-xs text-white/50 font-medium mb-2 block uppercase tracking-widest">Proxy Type</label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => { setMcVariant(null); setFormData(prev => ({ ...prev, proxyType: 'http' })); }}
                className={`flex flex-col items-center gap-1.5 p-2.5 rounded-lg border transition-all ${
                  formData.proxyType === 'http'
                    ? 'bg-[#9D4EDD]/10 border-[#9D4EDD]/30 text-white'
                    : 'bg-white/[0.03] border-white/[0.08] text-white/60 hover:border-[#9D4EDD]/30'
                }`}
              >
                <Globe className="w-4 h-4" strokeWidth={1.5} />
                <span className="text-xs font-medium">HTTP/HTTPS</span>
              </button>
              <button
                type="button"
                onClick={() => { setMcVariant(null); setFormData(prev => ({ ...prev, proxyType: 'tcp' })); }}
                className={`flex flex-col items-center gap-1.5 p-2.5 rounded-lg border transition-all ${
                  formData.proxyType === 'tcp'
                    ? 'bg-[#F59E0B]/10 border-[#F59E0B]/30 text-white'
                    : 'bg-white/[0.03] border-white/[0.08] text-white/60 hover:border-[#F59E0B]/30'
                }`}
              >
                <Zap className="w-4 h-4" strokeWidth={1.5} />
                <span className="text-xs font-medium">TCP</span>
              </button>
              <button
                type="button"
                onClick={() => { setMcVariant(null); setFormData(prev => ({ ...prev, proxyType: 'udp' })); }}
                className={`flex flex-col items-center gap-1.5 p-2.5 rounded-lg border transition-all ${
                  formData.proxyType === 'udp' && mcVariant === null
                    ? 'bg-[#9D4EDD]/10 border-[#9D4EDD]/30 text-white'
                    : 'bg-white/[0.03] border-white/[0.08] text-white/60 hover:border-[#9D4EDD]/30'
                }`}
              >
                <Radio className="w-4 h-4" strokeWidth={1.5} />
                <span className="text-xs font-medium">UDP</span>
              </button>
              <button
                type="button"
                onClick={() => mcVariant === null && selectMcVariant('java')}
                className={`flex flex-col items-center gap-1.5 p-2.5 rounded-lg border transition-all ${
                  mcVariant !== null || formData.proxyType === 'minecraft'
                    ? 'bg-[#10B981]/10 border-[#10B981]/30 text-white'
                    : 'bg-white/[0.03] border-white/[0.08] text-white/60 hover:border-[#10B981]/30'
                }`}
              >
                <Gamepad2 className="w-4 h-4" strokeWidth={1.5} />
                <span className="text-xs font-medium">Minecraft</span>
              </button>
            </div>

            {/* Minecraft sub-type: Java / Bedrock */}
            {(mcVariant !== null || formData.proxyType === 'minecraft') && (
              <div className="mt-2 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => selectMcVariant('java')}
                  className={`flex items-center justify-center gap-2 p-2.5 rounded-lg border transition-all ${
                    formData.proxyType === 'minecraft' && formData.minecraftEdition === 'java'
                      ? 'bg-[#10B981]/15 border-[#10B981]/40 text-white'
                      : 'bg-white/[0.02] border-white/[0.06] text-white/50 hover:border-[#10B981]/30'
                  }`}
                >
                  <Gamepad2 className="w-3.5 h-3.5" strokeWidth={1.5} />
                  <div className="text-left">
                    <p className="text-xs font-medium">Java</p>
                    <p className="text-[10px] text-white/40">TCP · port 25565</p>
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => selectMcVariant('bedrock')}
                  className={`flex items-center justify-center gap-2 p-2.5 rounded-lg border transition-all ${
                    formData.proxyType === 'minecraft' && formData.minecraftEdition === 'bedrock'
                      ? 'bg-[#22D3EE]/15 border-[#22D3EE]/40 text-white'
                      : 'bg-white/[0.02] border-white/[0.06] text-white/50 hover:border-[#22D3EE]/30'
                  }`}
                >
                  <Radio className="w-3.5 h-3.5" strokeWidth={1.5} />
                  <div className="text-left">
                    <p className="text-xs font-medium">Bedrock</p>
                    <p className="text-[10px] text-white/40">UDP · port 19132</p>
                  </div>
                </button>
              </div>
            )}
          </div>

          {/* Domain Name */}
          <div className="mb-3">
            <label className="text-xs text-white/50 font-medium mb-2 block uppercase tracking-widest">Domain Name</label>
            <input
              type="text"
              name="hostname"
              value={formData.hostname}
              onChange={handleChange}
              placeholder="example.com or *.example.com"
              disabled={isLoading}
              className="input-futuristic"
            />
            {formData.proxyType === 'http' && (
              <p className="text-xs text-white/40 mt-1">
                Supports wildcard domains (e.g., *.example.com)
              </p>
            )}
            {formData.proxyType === 'minecraft' && formData.minecraftEdition === 'java' && (
              <p className="text-xs text-white/40 mt-1">Hostname auquel les joueurs Java se connectent (ex : mc.example.com)</p>
            )}
            {formData.proxyType === 'minecraft' && formData.minecraftEdition === 'bedrock' && (
              <p className="text-xs text-white/40 mt-1">Hostname auquel les joueurs Bedrock se connectent (ex : pe.example.com)</p>
            )}
            {(formData.proxyType === 'tcp' || (formData.proxyType === 'udp' && mcVariant === null)) && (
              <p className="text-xs text-white/40 mt-1">
                Identifiant pour ce proxy {formData.proxyType.toUpperCase()}
              </p>
            )}
          </div>

          {/* Backend URL/IP */}
          <div className="mb-3">
            <label className="text-xs text-white/50 font-medium mb-2 block uppercase tracking-widest">
              {formData.proxyType === 'http' ? 'Backend URL' : 'Backend IP/Hostname'}
            </label>
            <input
              type="text"
              name="backendUrl"
              value={formData.backendUrl}
              onChange={handleChange}
              placeholder={formData.proxyType === 'http' ? 'http://192.168.1.100' : '192.168.1.100'}
              disabled={isLoading}
              className="input-futuristic"
            />
          </div>

          {/* Backend Port */}
          <div className="mb-3">
            <label className="text-xs text-white/50 font-medium mb-2 block uppercase tracking-widest">Backend Port</label>
            <input
              type="text"
              name="backendPort"
              value={formData.backendPort}
              onChange={handleChange}
              placeholder={formData.proxyType === 'minecraft' && formData.minecraftEdition === 'bedrock' ? '19132' : formData.proxyType === 'minecraft' ? '25565' : '8080'}
              disabled={isLoading}
              className="input-futuristic"
            />
            {formData.proxyType === 'minecraft' && formData.minecraftEdition === 'java' && (
              <p className="text-xs text-white/40 mt-1">Port Java par défaut : 25565</p>
            )}
            {formData.proxyType === 'minecraft' && formData.minecraftEdition === 'bedrock' && (
              <p className="text-xs text-white/40 mt-1">Port Bedrock / Geyser par défaut : 19132</p>
            )}
          </div>

          {/* Load Balancing Section */}
          <div className="mb-3 p-3 rounded-xl bg-white/[0.02] border border-white/[0.08]">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Layers className="w-4 h-4 text-[#C77DFF]" strokeWidth={1.5} />
                <span className="text-xs text-white/70 font-medium uppercase tracking-widest">Load Balancing</span>
              </div>
              <Switch
                checked={formData.loadBalancingEnabled}
                onCheckedChange={(checked) => setFormData(prev => ({ ...prev, loadBalancingEnabled: checked }))}
                disabled={isLoading}
              />
            </div>

            {formData.loadBalancingEnabled && (
              <>
                {/* Algorithm Selection */}
                <div className="mb-3">
                  <label className="text-xs text-white/50 font-medium mb-2 block">Algorithm</label>
                  <div className="grid grid-cols-4 gap-1.5">
                    {LB_ALGORITHMS.map((alg) => (
                      <button
                        key={alg.value}
                        type="button"
                        onClick={() => setFormData(prev => ({ ...prev, loadBalancingAlgorithm: alg.value }))}
                        disabled={isLoading}
                        className={`px-2 py-1.5 rounded-lg text-[9px] font-medium transition-all ${
                          formData.loadBalancingAlgorithm === alg.value
                            ? 'bg-[#9D4EDD]/20 border border-[#9D4EDD]/40 text-white'
                            : 'bg-white/[0.02] border border-white/[0.08] text-white/60 hover:border-[#9D4EDD]/30'
                        }`}
                      >
                        {alg.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Additional Backends */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-xs text-white/50 font-medium">
                      Additional Backends ({formData.additionalBackends.length})
                    </label>
                    <button
                      type="button"
                      onClick={addBackend}
                      disabled={isLoading}
                      className="flex items-center gap-1 px-2 py-1 bg-[#9D4EDD]/10 hover:bg-[#9D4EDD]/20 border border-[#9D4EDD]/30 text-[#C77DFF] rounded-lg text-[9px] font-medium transition-all"
                    >
                      <Plus className="w-3 h-3" strokeWidth={2} />
                      Add
                    </button>
                  </div>

                  {formData.additionalBackends.length === 0 ? (
                    <p className="text-xs text-white/40 text-center py-3">
                      No additional backends. The primary backend URL above will be used.
                    </p>
                  ) : (
                    <div className="space-y-2 max-h-40 overflow-y-auto">
                      {formData.additionalBackends.map((backend, index) => (
                        <div key={index} className="flex items-center gap-2 p-2 bg-white/[0.02] rounded-lg border border-white/[0.05]">
                          <Server className="w-3.5 h-3.5 text-white/30 flex-shrink-0" strokeWidth={1.5} />
                          <input
                            type="text"
                            value={backend.url}
                            onChange={(e) => updateBackend(index, 'url', e.target.value)}
                            placeholder={formData.proxyType === 'http' ? 'http://ip' : 'IP or hostname'}
                            disabled={isLoading}
                            className="flex-1 bg-transparent border-none text-xs text-white/90 placeholder-white/30 focus:outline-none min-w-0"
                          />
                          <input
                            type="text"
                            value={backend.port}
                            onChange={(e) => updateBackend(index, 'port', e.target.value)}
                            placeholder="Port"
                            disabled={isLoading}
                            className="w-16 bg-white/[0.03] border border-white/[0.08] rounded px-2 py-1 text-xs text-white/90 placeholder-white/30 focus:outline-none focus:border-[#9D4EDD]/30"
                          />
                          <button
                            type="button"
                            onClick={() => removeBackend(index)}
                            disabled={isLoading}
                            className="p-1 text-white/40 hover:text-[#F87171] transition-colors"
                          >
                            <Trash2 className="w-3.5 h-3.5" strokeWidth={1.5} />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  <p className="text-xs text-white/40 mt-2">
                    Traffic will be distributed between the primary backend and all additional backends.
                  </p>
                </div>
              </>
            )}

            {!formData.loadBalancingEnabled && (
              <p className="text-xs text-white/40">
                Enable to distribute traffic across multiple backend servers.
              </p>
            )}
          </div>

          {/* External Port (Admin only) */}
          {(formData.proxyType === 'tcp' || formData.proxyType === 'udp' || formData.proxyType === 'minecraft') && user?.role === 'admin' && (
            <div className="mb-3">
              <label className="text-xs text-white/50 font-medium mb-2 block uppercase tracking-widest">External Listen Port</label>
              <input
                type="text"
                name="externalPort"
                value={formData.externalPort}
                onChange={handleChange}
                placeholder="Leave empty for auto"
                disabled={isLoading}
                className="input-futuristic"
              />
              <p className="text-xs text-white/40 mt-1">
                {formData.proxyType === 'minecraft' && formData.minecraftEdition === 'java'
                  ? 'Admin only. Port partagé 25565 par défaut. Port custom pour routage dédié.'
                  : formData.proxyType === 'minecraft' && formData.minecraftEdition === 'bedrock'
                  ? 'Admin only. Port UDP Bedrock/Geyser — 19132 par défaut.'
                  : 'Admin only. Range 1-65535. Leave empty for a random port.'}
              </p>
            </div>
          )}

          {/* Description */}
          <div className="mb-3">
            <label className="text-xs text-white/50 font-medium mb-2 block uppercase tracking-widest">Description</label>
            <input
              type="text"
              name="description"
              value={formData.description}
              onChange={handleChange}
              placeholder="Optional description"
              disabled={isLoading}
              className="input-futuristic"
            />
          </div>

          {/* SSL/TLS Toggle */}
          {formData.proxyType === 'http' && (
            <>
              <div className="mb-3">
                <div className="flex items-center justify-between p-3 rounded-lg bg-white/[0.03] border border-white/[0.08]">
                  <div>
                    <label htmlFor="sslEnabled" className="text-xs font-medium text-white cursor-pointer block">
                      SSL/TLS
                    </label>
                    <p className="text-xs text-white/40 mt-0.5">
                      Enable SSL/TLS for this domain
                    </p>
                  </div>
                  <Switch
                    id="sslEnabled"
                    name="sslEnabled"
                    checked={formData.sslEnabled}
                    onCheckedChange={(checked) => setFormData(prev => ({ ...prev, sslEnabled: checked }))}
                    disabled={isLoading}
                  />
                </div>
              </div>

              {/* ACME Challenge Type Selection */}
              {formData.sslEnabled && (
                <div className="mb-3">
                  <label className="text-xs text-white/50 font-medium mb-2 block uppercase tracking-widest">
                    Certificate Method
                  </label>
                  <div className="grid grid-cols-3 gap-2">
                    <button
                      type="button"
                      onClick={() => !formData.hostname.startsWith('*.') && setFormData(prev => ({ ...prev, challengeType: 'http-01' }))}
                      disabled={formData.hostname.startsWith('*.')}
                      className={`flex flex-col items-start gap-1 p-3 rounded-lg border transition-all ${
                        formData.challengeType === 'http-01'
                          ? 'bg-[#10B981]/10 border-[#10B981]/30'
                          : formData.hostname.startsWith('*.')
                          ? 'bg-white/[0.02] border-white/[0.05] opacity-40 cursor-not-allowed'
                          : 'bg-white/[0.03] border-white/[0.08] hover:border-[#10B981]/30'
                      }`}
                    >
                      <span className="text-xs font-medium text-white">HTTP-01 (Auto)</span>
                      <span className="text-xs text-white/50">Automatic via port 80</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setFormData(prev => ({ ...prev, challengeType: 'dns-01' }))}
                      className={`flex flex-col items-start gap-1 p-3 rounded-lg border transition-all ${
                        formData.challengeType === 'dns-01'
                          ? 'bg-[#06B6D4]/10 border-[#06B6D4]/30'
                          : 'bg-white/[0.03] border-white/[0.08] hover:border-[#06B6D4]/30'
                      }`}
                    >
                      <span className="text-xs font-medium text-white">DNS-01 (Manual)</span>
                      <span className="text-xs text-white/50">Manual DNS TXT record</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setFormData(prev => ({ ...prev, challengeType: 'custom' }))}
                      className={`flex flex-col items-start gap-1 p-3 rounded-lg border transition-all ${
                        formData.challengeType === 'custom'
                          ? 'bg-[#9D4EDD]/10 border-[#9D4EDD]/30'
                          : 'bg-white/[0.03] border-white/[0.08] hover:border-[#9D4EDD]/30'
                      }`}
                    >
                      <span className="text-xs font-medium text-white">Custom</span>
                      <span className="text-xs text-white/50">Upload your own cert</span>
                    </button>
                  </div>

                  {formData.hostname.startsWith('*.') && (
                    <div className="mt-2 p-2.5 rounded-lg bg-[#06B6D4]/10 border border-[#06B6D4]/20">
                      <p className="text-xs text-[#22D3EE] leading-relaxed">
                        <strong className="text-white">Wildcard domain detected:</strong> DNS-01 challenge required for *.{formData.hostname.replace('*.', '')}
                      </p>
                    </div>
                  )}

                  {formData.challengeType === 'dns-01' && !formData.hostname.startsWith('*.') && (
                    <div className="mt-2 p-2.5 rounded-lg bg-[#F59E0B]/10 border border-[#F59E0B]/20">
                      <p className="text-xs text-white/70 leading-relaxed">
                        DNS-01 requires manual DNS TXT record creation. You'll receive instructions after domain creation.
                      </p>
                    </div>
                  )}

                  {formData.challengeType === 'http-01' && (
                    <div className="mt-2 p-2.5 rounded-lg bg-[#10B981]/10 border border-[#10B981]/20">
                      <p className="text-xs text-white/70 leading-relaxed">
                        Point your domain CNAME to public.paxcia.net and keep port 80 reachable (no proxy) for ACME.
                      </p>
                    </div>
                  )}

                  {formData.challengeType === 'custom' && (
                    <div className="mt-2 p-2.5 rounded-lg bg-[#9D4EDD]/10 border border-[#9D4EDD]/20">
                      <p className="text-xs text-white/70 leading-relaxed">
                        Upload your own SSL certificate and private key in PEM format.
                      </p>
                    </div>
                  )}
                </div>
              )}

              {/* Custom Certificate Upload Fields */}
              {formData.sslEnabled && formData.challengeType === 'custom' && (
                <>
                  <div className="mb-3">
                    <label className="text-xs text-white/50 font-medium mb-2 block uppercase tracking-widest">
                      Full Chain Certificate (PEM)
                    </label>
                    <textarea
                      name="fullChain"
                      value={formData.fullChain}
                      onChange={handleChange}
                      placeholder="-----BEGIN CERTIFICATE-----&#10;MIIDXTCCAkWgAwIBAgIJAKZ...&#10;-----END CERTIFICATE-----&#10;-----BEGIN CERTIFICATE-----&#10;... intermediate ...&#10;-----END CERTIFICATE-----"
                      disabled={isLoading}
                      className="input-futuristic font-mono text-xs h-32 resize-none"
                    />
                    <p className="text-xs text-white/40 mt-1">
                      Include the full certificate chain (server cert + intermediates)
                    </p>
                  </div>

                  <div className="mb-3">
                    <label className="text-xs text-white/50 font-medium mb-2 block uppercase tracking-widest">
                      Private Key (PEM)
                    </label>
                    <textarea
                      name="privateKey"
                      value={formData.privateKey}
                      onChange={handleChange}
                      placeholder="-----BEGIN PRIVATE KEY-----&#10;MIIEvQIBADANBgkqhkiG...&#10;-----END PRIVATE KEY-----"
                      disabled={isLoading}
                      className="input-futuristic font-mono text-xs h-32 resize-none"
                    />
                    <p className="text-xs text-white/40 mt-1">
                      RSA or ECDSA private key in PEM format
                    </p>
                  </div>
                </>
              )}
            </>
          )}

          {/* Info blocks */}
          {formData.proxyType === 'tcp' && mcVariant === null && (
            <div className="mb-3 p-3 rounded-lg bg-[#F59E0B]/10 border border-[#F59E0B]/20">
              <p className="text-xs text-white/70 leading-relaxed">
                <strong className="text-white">TCP Proxy :</strong> Port auto alloué (1-65535). Les admins peuvent définir un port custom.
              </p>
            </div>
          )}
          {formData.proxyType === 'udp' && mcVariant === null && (
            <div className="mb-3 p-3 rounded-lg bg-[#9D4EDD]/10 border border-[#9D4EDD]/20">
              <p className="text-xs text-white/70 leading-relaxed">
                <strong className="text-white">UDP Proxy :</strong> Port auto alloué (1-65535). Les admins peuvent définir un port custom.
              </p>
            </div>
          )}
          {formData.proxyType === 'minecraft' && formData.minecraftEdition === 'java' && (
            <div className="mb-3 p-3 rounded-lg bg-[#10B981]/10 border border-[#10B981]/20">
              <p className="text-xs text-white/70 leading-relaxed mb-1">
                <strong className="text-white">Minecraft Java :</strong> Port partagé 25565, routage par hostname.
              </p>
              <p className="text-xs text-white/60 leading-relaxed">
                Les joueurs se connectent à <strong className="text-white">{formData.hostname || 'mc.example.com'}:25565</strong>. Le proxy route automatiquement selon le handshake.
              </p>
            </div>
          )}
          {formData.proxyType === 'minecraft' && formData.minecraftEdition === 'bedrock' && (
            <div className="mb-3 p-3 rounded-lg bg-[#22D3EE]/10 border border-[#22D3EE]/20">
              <p className="text-xs text-white/70 leading-relaxed mb-1">
                <strong className="text-white">Minecraft Bedrock / Geyser :</strong> Proxy UDP sur le port 19132.
              </p>
              <p className="text-xs text-white/60 leading-relaxed">
                Les joueurs Bedrock se connectent à <strong className="text-white">{formData.hostname || 'mc.example.com'}:19132</strong>. Active le PROXY Protocol v2 dans les options avancées pour transmettre les vraies IPs à Geyser.
              </p>
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={isLoading}
              className="flex-1 btn-secondary"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isLoading}
              className="flex-1 btn-primary"
            >
              {isLoading ? 'Saving...' : (domain ? 'Save' : 'Add')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
