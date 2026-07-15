import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Shield, Upload, RefreshCw, Calendar, CheckCircle, AlertTriangle, XCircle,
  Search, Clock, ChevronUp, ChevronDown, ChevronsUpDown, AlertCircle
} from 'lucide-react';
import { sslAPI } from '../api/client';
import { Combobox } from '../components/ui/combobox';
import { PaginationControls } from '@/components/ui/pagination-controls';
import { useToast } from '@/hooks/use-toast';

// ─── helpers ────────────────────────────────────────────────────────────────

const MIN_VALID_TS = new Date('2000-01-01').getTime();

function safeExpiry(expiresAt) {
  if (!expiresAt) return null;
  const ts = new Date(expiresAt).getTime();
  return ts > MIN_VALID_TS ? new Date(ts) : null;
}

function daysUntil(date) {
  if (!date) return null;
  return Math.ceil((date - Date.now()) / 86400000);
}

// ─── status helpers ──────────────────────────────────────────────────────────

function getStatusBadge(cert) {
  if (cert.renewing) return <span className="badge-info flex items-center gap-1"><RefreshCw className="w-3 h-3 animate-spin" strokeWidth={1.5} />Renewing</span>;
  switch (cert.status) {
    case 'valid':         return <span className="badge-success">Valid</span>;
    case 'expiring-soon': return <span className="badge-warning">Expiring Soon</span>;
    case 'expired':       return <span className="badge-error">Expired</span>;
    case 'invalid-date':  return <span className="badge-warning">Date invalide</span>;
    default:              return <span className="badge-purple">Unknown</span>;
  }
}

function getStatusIcon(cert) {
  if (cert.renewing) return <RefreshCw className="w-4 h-4 text-[#22D3EE] animate-spin" strokeWidth={1.5} />;
  switch (cert.status) {
    case 'valid':         return <CheckCircle  className="w-4 h-4 text-[#34D399]"  strokeWidth={1.5} />;
    case 'expiring-soon': return <AlertTriangle className="w-4 h-4 text-[#FBBF24]"  strokeWidth={1.5} />;
    case 'expired':       return <XCircle       className="w-4 h-4 text-[#F87171]"  strokeWidth={1.5} />;
    case 'invalid-date':  return <AlertCircle   className="w-4 h-4 text-[#FBBF24]"  strokeWidth={1.5} />;
    default:              return <Shield         className="w-4 h-4 text-white/40"   strokeWidth={1.5} />;
  }
}

function rowAccentClasses(cert) {
  if (cert.renewing) return 'bg-[#06B6D4]/10 border border-[#06B6D4]/20';
  switch (cert.status) {
    case 'valid':         return 'bg-[#10B981]/10 border border-[#10B981]/20';
    case 'expiring-soon': return 'bg-[#F59E0B]/10 border border-[#F59E0B]/20';
    case 'expired':
    case 'invalid-date':  return 'bg-[#EF4444]/10 border border-[#EF4444]/20';
    default:              return 'bg-white/[0.04] border border-white/[0.08]';
  }
}

// ─── sort helper ─────────────────────────────────────────────────────────────

const STATUS_ORDER = { renewing: 0, 'expiring-soon': 1, 'invalid-date': 2, expired: 3, valid: 4, unknown: 5 };

function sortCerts(list, field, dir) {
  return [...list].sort((a, b) => {
    let cmp = 0;
    if (field === 'domain') {
      cmp = (a.domain || '').localeCompare(b.domain || '');
    } else if (field === 'expiry') {
      const ta = safeExpiry(a.expiresAt)?.getTime() ?? (dir === 'asc' ? Infinity : -Infinity);
      const tb = safeExpiry(b.expiresAt)?.getTime() ?? (dir === 'asc' ? Infinity : -Infinity);
      cmp = ta - tb;
    } else if (field === 'status') {
      const sa = a.renewing ? STATUS_ORDER.renewing : (STATUS_ORDER[a.status] ?? 5);
      const sb = b.renewing ? STATUS_ORDER.renewing : (STATUS_ORDER[b.status] ?? 5);
      cmp = sa - sb;
    }
    return dir === 'asc' ? cmp : -cmp;
  });
}

// ─── SortHeader ──────────────────────────────────────────────────────────────

function SortHeader({ label, field, current, dir, onChange }) {
  const active = current === field;
  return (
    <th
      className="text-left text-xs uppercase tracking-[0.15em] text-white/50 font-medium px-3 py-2 select-none cursor-pointer hover:text-white/80 transition-colors"
      onClick={() => onChange(field)}
    >
      <span className="flex items-center gap-1">
        {label}
        {active
          ? dir === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />
          : <ChevronsUpDown className="w-3 h-3 opacity-30" />}
      </span>
    </th>
  );
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function SSLCertificates() {
  const navigate = useNavigate();
  const { toast } = useToast();

  const [certificates, setCertificates] = useState([]);
  const [stats, setStats] = useState({ valid: 0, expiringSoon: 0, expired: 0 });
  const [loading, setLoading] = useState(true);
  const [uploadingId, setUploadingId] = useState(null);  // domainId being renewed
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadData, setUploadData] = useState({ domainId: '', fullChain: '', privateKey: '' });
  const [uploadError, setUploadError] = useState(null);

  // Filters & sort
  const [ownershipFilter, setOwnershipFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortField, setSortField] = useState('expiry');
  const [sortDir, setSortDir] = useState('asc');
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;

  // DNS Challenge
  const [showDNSModal, setShowDNSModal] = useState(false);
  const [dnsChallenge, setDnsChallenge] = useState(null);
  const [dnsValidating, setDnsValidating] = useState(false);
  const [dnsCheckingPropagation, setDnsCheckingPropagation] = useState(false);
  const [dnsPropagated, setDnsPropagated] = useState(false);
  const [dnsError, setDnsError] = useState(null);
  const [selectedDomainForDNS, setSelectedDomainForDNS] = useState(null);
  const [copiedField, setCopiedField] = useState(null); // 'name'|'value'

  // Polling ref to avoid stale closure
  const pollingRef = useRef(null);

  // ── fetch ────────────────────────────────────────────────────────────────

  const fetchCertificates = useCallback(async () => {
    try {
      const [certsRes, statsRes] = await Promise.all([
        sslAPI.getCertificates(),
        sslAPI.getStats()
      ]);
      setCertificates(certsRes.data.certificates || []);
      setStats(statsRes.data || { valid: 0, expiringSoon: 0, expired: 0 });
    } catch (err) {
      console.error('Error fetching certificates:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchCertificates(); }, [fetchCertificates]);

  // Auto-poll while any cert is renewing
  useEffect(() => {
    const anyRenewing = certificates.some(c => c.renewing);
    if (anyRenewing) {
      pollingRef.current = setInterval(fetchCertificates, 8000);
    } else {
      clearInterval(pollingRef.current);
    }
    return () => clearInterval(pollingRef.current);
  }, [certificates, fetchCertificates]);

  // ── sort toggle ──────────────────────────────────────────────────────────

  const handleSortChange = (field) => {
    if (field === sortField) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDir('asc');
    }
    setCurrentPage(1);
  };

  // ── derived ──────────────────────────────────────────────────────────────

  const renewingCount = certificates.filter(c => c.renewing).length;

  const filtered = sortCerts(
    certificates.filter(cert => {
      if (ownershipFilter === 'team'     && cert.ownershipType !== 'team') return false;
      if (ownershipFilter === 'personal' && cert.ownershipType === 'team') return false;
      if (statusFilter === 'renewing'     && !cert.renewing)                           return false;
      if (statusFilter === 'valid'        && (cert.renewing || cert.status !== 'valid'))         return false;
      if (statusFilter === 'expiring-soon'&& (cert.renewing || cert.status !== 'expiring-soon')) return false;
      if (statusFilter === 'expired'      && (cert.renewing || cert.status !== 'expired'))       return false;
      if (statusFilter === 'issues'       && !cert.renewalErrorCount && cert.status !== 'invalid-date') return false;
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        return cert.domain?.toLowerCase().includes(q) || cert.issuer?.toLowerCase().includes(q);
      }
      return true;
    }),
    sortField, sortDir
  );

  const totalPages = Math.max(1, Math.ceil(filtered.length / itemsPerPage));
  const paginated = filtered.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  useEffect(() => { setCurrentPage(1); }, [searchQuery, ownershipFilter, statusFilter]);
  useEffect(() => { if (currentPage > totalPages) setCurrentPage(totalPages); }, [currentPage, totalPages]);

  // ── actions ──────────────────────────────────────────────────────────────

  const handleRenew = async (domainId) => {
    const cert = certificates.find(c => c.id === domainId);
    if (cert?.type === 'manual') {
      setUploadData({ domainId: String(domainId), fullChain: '', privateKey: '' });
      setUploadError(null);
      setShowUploadModal(true);
      return;
    }

    setUploadingId(domainId);
    try {
      await sslAPI.renew(domainId);
      await fetchCertificates();
    } catch (err) {
      const message = err.response?.data?.message || 'Failed to renew certificate';
      const lower = message.toLowerCase();
      if (lower.includes('dns') || lower.includes('dns-01') || lower.includes('dns challenge')) {
        handleRequestDNS(domainId);
        return;
      }
      toast({ variant: 'destructive', title: 'Renewal failed', description: message });
    } finally {
      setUploadingId(null);
    }
  };

  const handleUpload = async () => {
    if (!uploadData.domainId || !uploadData.fullChain || !uploadData.privateKey) {
      setUploadError('Please fill in all fields');
      return;
    }
    setUploading(true);
    setUploadError(null);
    try {
      await sslAPI.upload(uploadData);
      await fetchCertificates();
      setShowUploadModal(false);
      setUploadData({ domainId: '', fullChain: '', privateKey: '' });
      toast({ title: 'Certificate uploaded', description: 'The certificate was uploaded successfully.' });
    } catch (err) {
      setUploadError(err.response?.data?.message || 'Failed to upload certificate');
    } finally {
      setUploading(false);
    }
  };

  // ── DNS challenge ─────────────────────────────────────────────────────────

  const handleRequestDNS = async (domainId) => {
    setDnsError(null);
    setShowDNSModal(true);
    setSelectedDomainForDNS(domainId);
    setDnsPropagated(false);
    setDnsChallenge(null);
    try {
      const res = await sslAPI.requestDNS(domainId);
      if (res.data.success) setDnsChallenge(res.data.challenge);
    } catch (err) {
      setDnsError(err.response?.data?.message || 'Failed to initiate DNS challenge');
    }
  };

  const handleCheckDNSPropagation = async () => {
    if (!selectedDomainForDNS) return;
    setDnsCheckingPropagation(true);
    try {
      const res = await sslAPI.checkDNSPropagation(selectedDomainForDNS);
      if (res.data.propagated) { setDnsPropagated(true); setDnsError(null); }
      else { setDnsPropagated(false); setDnsError('DNS record not yet propagated. Please wait and try again.'); }
    } catch {
      setDnsError('Failed to check DNS propagation');
    } finally {
      setDnsCheckingPropagation(false);
    }
  };

  const handleValidateDNS = async () => {
    if (!selectedDomainForDNS) return;
    setDnsValidating(true);
    setDnsError(null);
    try {
      const res = await sslAPI.validateDNS(selectedDomainForDNS, true);
      if (res.data.success) {
        await fetchCertificates();
        setShowDNSModal(false);
        setDnsChallenge(null);
        setSelectedDomainForDNS(null);
        toast({ title: 'Certificate obtained', description: 'DNS-01 challenge completed successfully.' });
      } else if (res.data.propagated === false) {
        setDnsError(res.data.message);
      }
    } catch (err) {
      const data = err.response?.data;
      if (data?.reinitiateRequired) {
        setShowDNSModal(false);
        setDnsChallenge(null);
        setDnsError(null);
        toast({
          variant: 'destructive',
          title: 'Session expired',
          description: 'The certbot session ended (server restarted or timed out). Click "Request DNS Challenge" again to restart.'
        });
      } else {
        setDnsError(data?.message || 'DNS validation failed');
      }
    } finally {
      setDnsValidating(false);
    }
  };

  const copyField = (text, field) => {
    navigator.clipboard.writeText(text);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 1500);
  };

  // ── render ────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-white/60 text-sm font-light">Loading certificates...</div>
      </div>
    );
  }

  return (
    <div className="page-shell">
      <div className="page-header">
        <div className="page-header-inner">
          <div className="animate-fade-in flex items-center justify-between gap-3 flex-wrap">
            <div>
              <h1 className="text-xl md:text-2xl font-light text-white mb-2 tracking-tight">SSL Certificates</h1>
              <p className="text-xs text-white/50 font-light tracking-wide">Manage SSL/TLS certificates and auto-renewal</p>
            </div>
            <button onClick={() => { setShowUploadModal(true); setUploadData({ domainId: '', fullChain: '', privateKey: '' }); setUploadError(null); }} className="btn-primary flex items-center gap-2 text-xs px-4 py-2">
              <Upload className="w-4 h-4" strokeWidth={1.5} />
              Upload
            </button>
          </div>
        </div>
      </div>

      <div className="page-body">

        {/* ── Stats ── */}
        <div className={`grid gap-4 mb-6 ${renewingCount > 0 ? 'grid-cols-2 sm:grid-cols-4' : 'grid-cols-1 sm:grid-cols-3'}`}>
          <div className="bg-[#1A1B28]/40 backdrop-blur-xl border border-white/[0.08] rounded-xl p-4 animate-fade-in" style={{ animationDelay: '0.1s' }}>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-[#10B981]/10 to-[#10B981]/5 border border-[#10B981]/20 flex items-center justify-center">
                <CheckCircle className="w-5 h-5 text-[#34D399]" strokeWidth={1.5} />
              </div>
              <div>
                <p className="text-xs font-medium text-white/50 uppercase tracking-[0.15em]">Valid</p>
                <p className="text-xl font-light text-white">{stats.valid || 0}</p>
              </div>
            </div>
          </div>

          <div className="bg-[#1A1B28]/40 backdrop-blur-xl border border-white/[0.08] rounded-xl p-4 animate-fade-in" style={{ animationDelay: '0.2s' }}>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-[#F59E0B]/10 to-[#F59E0B]/5 border border-[#F59E0B]/20 flex items-center justify-center">
                <AlertTriangle className="w-5 h-5 text-[#FBBF24]" strokeWidth={1.5} />
              </div>
              <div>
                <p className="text-xs font-medium text-white/50 uppercase tracking-[0.15em]">Expiring</p>
                <p className="text-xl font-light text-white">{stats.expiringSoon || 0}</p>
              </div>
            </div>
          </div>

          <div className="bg-[#1A1B28]/40 backdrop-blur-xl border border-white/[0.08] rounded-xl p-4 animate-fade-in" style={{ animationDelay: '0.3s' }}>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-[#EF4444]/10 to-[#EF4444]/5 border border-[#EF4444]/20 flex items-center justify-center">
                <XCircle className="w-5 h-5 text-[#F87171]" strokeWidth={1.5} />
              </div>
              <div>
                <p className="text-xs font-medium text-white/50 uppercase tracking-[0.15em]">Expired</p>
                <p className="text-xl font-light text-white">{stats.expired || 0}</p>
              </div>
            </div>
          </div>

          {renewingCount > 0 && (
            <div className="bg-[#1A1B28]/40 backdrop-blur-xl border border-[#06B6D4]/20 rounded-xl p-4 animate-fade-in" style={{ animationDelay: '0.35s' }}>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-[#06B6D4]/10 to-[#06B6D4]/5 border border-[#06B6D4]/20 flex items-center justify-center">
                  <RefreshCw className="w-5 h-5 text-[#22D3EE] animate-spin" strokeWidth={1.5} />
                </div>
                <div>
                  <p className="text-xs font-medium text-white/50 uppercase tracking-[0.15em]">Renewing</p>
                  <p className="text-xl font-light text-white">{renewingCount}</p>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* ── Search & Filters ── */}
        <div className="mb-4 space-y-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30" strokeWidth={1.5} />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search by domain or issuer..."
              className="input-futuristic pl-10 text-xs"
            />
          </div>

          <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs uppercase tracking-[0.2em] text-white/40">Owner</span>
              {['all', 'personal', 'team'].map(v => (
                <button key={v} onClick={() => setOwnershipFilter(v)} className={ownershipFilter === v ? 'btn-primary px-3 text-xs' : 'btn-secondary px-3 text-xs'}>
                  {v.charAt(0).toUpperCase() + v.slice(1)}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs uppercase tracking-[0.2em] text-white/40">Status</span>
              {[
                { v: 'all', label: 'All' },
                { v: 'valid', label: 'Valid' },
                { v: 'expiring-soon', label: 'Expiring' },
                { v: 'expired', label: 'Expired' },
                { v: 'renewing', label: 'Renewing' },
                { v: 'issues', label: 'Issues' },
              ].map(({ v, label }) => (
                <button key={v} onClick={() => setStatusFilter(v)} className={statusFilter === v ? 'btn-primary px-3 text-xs' : 'btn-secondary px-3 text-xs'}>
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* ── Table ── */}
        <div className="bg-[#161722]/50 backdrop-blur-2xl border border-white/[0.08] rounded-xl p-0 overflow-hidden shadow-lg animate-fade-in" style={{ animationDelay: '0.4s' }}>
          <div className="p-4 border-b border-white/[0.08] flex items-center justify-between">
            <div>
              <h2 className="text-base font-light text-white tracking-tight mb-1">Installed Certificates</h2>
              <p className="text-xs text-white/50 font-light tracking-wide">SSL/TLS certificates for your domains</p>
            </div>
            <button onClick={fetchCertificates} className="p-2 text-white/40 hover:text-white/70 hover:bg-white/[0.04] rounded-lg transition-all" title="Refresh">
              <RefreshCw className="w-4 h-4" strokeWidth={1.5} />
            </button>
          </div>

          {filtered.length === 0 ? (
            <div className="p-12 text-center">
              <div className="w-16 h-16 rounded-xl bg-gradient-to-br from-[#9D4EDD]/10 to-[#9D4EDD]/5 border border-[#9D4EDD]/20 flex items-center justify-center mx-auto mb-4">
                <Shield className="w-8 h-8 text-[#C77DFF]" strokeWidth={1.5} />
              </div>
              <h3 className="text-base font-light text-white mb-2">No certificates match</h3>
              <p className="text-xs text-white/50 font-light mb-6 max-w-md mx-auto">
                {searchQuery || statusFilter !== 'all' || ownershipFilter !== 'all'
                  ? 'Try adjusting the search or filters'
                  : 'Enable SSL on your domains or upload custom certificates'}
              </p>
              {!searchQuery && statusFilter === 'all' && ownershipFilter === 'all' && (
                <button onClick={() => setShowUploadModal(true)} className="btn-primary inline-flex items-center gap-2 text-xs px-4 py-2.5">
                  <Upload className="w-4 h-4" strokeWidth={1.5} />
                  Upload Certificate
                </button>
              )}
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[820px]">
                  <thead>
                    <tr className="border-b border-white/[0.08]">
                      <SortHeader label="Domain"  field="domain" current={sortField} dir={sortDir} onChange={handleSortChange} />
                      <th className="text-left text-xs uppercase tracking-[0.15em] text-white/50 font-medium px-3 py-2">Issuer</th>
                      <SortHeader label="Status"  field="status" current={sortField} dir={sortDir} onChange={handleSortChange} />
                      <th className="text-left text-xs uppercase tracking-[0.15em] text-white/50 font-medium px-3 py-2">Issued</th>
                      <SortHeader label="Expiry"  field="expiry" current={sortField} dir={sortDir} onChange={handleSortChange} />
                      <th className="text-left text-xs uppercase tracking-[0.15em] text-white/50 font-medium px-3 py-2">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paginated.map(cert => {
                      const expiry = safeExpiry(cert.expiresAt);
                      const days   = daysUntil(expiry);
                      const isRenewing = uploadingId === cert.id || cert.renewing;

                      return (
                        <tr
                          key={cert.id}
                          className="border-b border-white/[0.05] last:border-0 hover:bg-white/[0.02] transition-all duration-300 cursor-pointer group"
                          onClick={() => navigate(`/certificates/${cert.id}`)}
                        >
                          {/* Domain */}
                          <td className="px-3 py-2">
                            <div className="flex items-center gap-2.5">
                              <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${rowAccentClasses(cert)}`}>
                                {getStatusIcon(cert)}
                              </div>
                              <div>
                                <p className="text-xs font-normal text-white group-hover:text-[#C77DFF] transition-colors duration-300">{cert.domain}</p>
                                <p className="text-xs text-white/60 font-light capitalize">{cert.type}</p>
                                {cert.renewalErrorCount > 0 && (
                                  <p className="text-xs text-[#FBBF24] font-light truncate max-w-[220px]" title={cert.renewalError || undefined}>
                                    ⚠ {cert.renewalErrorCount} renewal error{cert.renewalErrorCount > 1 ? 's' : ''}
                                  </p>
                                )}
                              </div>
                            </div>
                          </td>

                          {/* Issuer */}
                          <td className="px-3 py-2">
                            <span className="text-xs text-white/70 font-light">{cert.issuer}</span>
                          </td>

                          {/* Status */}
                          <td className="px-3 py-2">
                            {getStatusBadge(cert)}
                          </td>

                          {/* Issued */}
                          <td className="px-3 py-2">
                            <span className="text-xs text-white/60 font-light">
                              {cert.issuedAt ? new Date(cert.issuedAt).toLocaleDateString() : '—'}
                            </span>
                          </td>

                          {/* Expiry */}
                          <td className="px-3 py-2">
                            {expiry ? (
                              <div>
                                <p className={`text-xs font-normal ${
                                  days !== null && days > 45 ? 'text-white' :
                                  days !== null && days > 0  ? 'text-[#FBBF24]' :
                                  'text-[#F87171]'
                                }`}>
                                  {expiry.toLocaleDateString()}
                                </p>
                                <p className="text-xs text-white/60 font-light">
                                  {days !== null
                                    ? days > 0 ? `${days}d left` : `Exp. ${Math.abs(days)}d ago`
                                    : ''}
                                </p>
                              </div>
                            ) : (
                              <span className="text-xs text-[#FBBF24] font-light">Date invalide</span>
                            )}
                          </td>

                          {/* Actions */}
                          <td className="px-3 py-2" onClick={e => e.stopPropagation()}>
                            <button
                              onClick={() => handleRenew(cert.id)}
                              disabled={isRenewing}
                              className="p-2 text-[#C77DFF] hover:bg-[#9D4EDD]/10 rounded-lg transition-all duration-300 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
                              title={cert.type === 'manual' ? 'Upload new certificate' : 'Renew now'}
                            >
                              {cert.type === 'manual'
                                ? <Upload className="w-4 h-4" strokeWidth={1.5} />
                                : <RefreshCw className={`w-4 h-4 ${isRenewing ? 'animate-spin' : ''}`} strokeWidth={1.5} />
                              }
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="px-4 pb-4">
                <PaginationControls
                  currentPage={currentPage}
                  totalPages={totalPages}
                  totalItems={filtered.length}
                  pageSize={itemsPerPage}
                  onPageChange={setCurrentPage}
                  label="certificates"
                />
              </div>
            </>
          )}
        </div>

        {/* ── Info card ── */}
        <div className="bg-[#06B6D4]/10 backdrop-blur-lg border border-[#06B6D4]/20 rounded-xl p-4 mt-6 animate-fade-in" style={{ animationDelay: '0.5s' }}>
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-lg bg-[#06B6D4]/10 border border-[#06B6D4]/30 flex items-center justify-center flex-shrink-0">
              <Shield className="w-4 h-4 text-[#22D3EE]" strokeWidth={1.5} />
            </div>
            <div className="flex-1">
              <p className="text-xs font-medium text-[#22D3EE] mb-1">Automatic SSL Renewal with Let's Encrypt</p>
              <p className="text-xs text-white/70 font-light leading-relaxed">
                Certificates from Let's Encrypt are automatically renewed <strong>45 days</strong> before expiration, with exponential back-off on repeated failures. Manual certificates require uploading a new PEM.
              </p>
            </div>
          </div>
        </div>

      </div>

      {/* ── Upload Modal ── */}
      {showUploadModal && (
        <div
          className="fixed inset-0 bg-[#0B0C0F]/80 backdrop-blur-2xl flex items-center justify-center z-50 p-4"
          onClick={() => { setShowUploadModal(false); setUploadError(null); }}
        >
          <div className="card-modal max-w-2xl w-full max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <h2 className="text-base font-light text-white mb-1">Upload Custom SSL Certificate</h2>
            <p className="text-xs text-white/50 mb-4">Upload a custom SSL/TLS certificate for your domain</p>

            {uploadError && (
              <div className="bg-[#EF4444]/10 backdrop-blur-lg border border-[#EF4444]/20 rounded-lg p-3 mb-4">
                <p className="text-xs text-[#F87171]">{uploadError}</p>
              </div>
            )}

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-white/60 uppercase tracking-[0.15em] mb-2">Select Domain</label>
                <Combobox
                  value={uploadData.domainId}
                  onValueChange={value => setUploadData({ ...uploadData, domainId: value })}
                  options={[
                    { value: '', label: 'Choose a domain...' },
                    ...certificates.map(cert => ({ value: cert.id.toString(), label: cert.domain })),
                  ]}
                  placeholder="Choose a domain..."
                  searchPlaceholder="Search domain..."
                  emptyText="No domain found."
                  triggerClassName="h-10 text-xs bg-admin-bg border-admin-border text-admin-text"
                  contentClassName="max-h-72"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-white/60 uppercase tracking-[0.15em] mb-2">Full Chain (PEM)</label>
                <textarea
                  value={uploadData.fullChain}
                  onChange={e => setUploadData({ ...uploadData, fullChain: e.target.value })}
                  className="input-futuristic text-xs font-mono h-32 resize-none"
                  placeholder="-----BEGIN CERTIFICATE-----&#10;...&#10;-----END CERTIFICATE-----"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-white/60 uppercase tracking-[0.15em] mb-2">Private Key (PEM)</label>
                <textarea
                  value={uploadData.privateKey}
                  onChange={e => setUploadData({ ...uploadData, privateKey: e.target.value })}
                  className="input-futuristic text-xs font-mono h-32 resize-none"
                  placeholder="-----BEGIN PRIVATE KEY-----&#10;...&#10;-----END PRIVATE KEY-----"
                />
              </div>

              <div className="bg-[#06B6D4]/10 backdrop-blur-lg border border-[#06B6D4]/20 rounded-lg p-3">
                <div className="flex items-start gap-2.5">
                  <Shield className="w-4 h-4 text-[#22D3EE] flex-shrink-0 mt-0.5" strokeWidth={1.5} />
                  <div>
                    <p className="text-xs font-medium text-[#22D3EE] mb-0.5">Certificate Format</p>
                    <p className="text-xs text-white/70 font-light leading-relaxed">
                      Both must be PEM format. Include the full chain (leaf + intermediates).
                    </p>
                  </div>
                </div>
              </div>

              <div className="flex gap-2.5 pt-3">
                <button
                  onClick={() => { setShowUploadModal(false); setUploadError(null); }}
                  className="btn-secondary flex-1 text-xs px-4 py-2.5"
                  disabled={uploading}
                >
                  Cancel
                </button>
                <button
                  onClick={handleUpload}
                  className="btn-primary flex-1 flex items-center justify-center gap-2 text-xs px-4 py-2.5"
                  disabled={uploading}
                >
                  {uploading ? <><RefreshCw className="w-3.5 h-3.5 animate-spin" strokeWidth={1.5} />Uploading...</> : <><Upload className="w-3.5 h-3.5" strokeWidth={1.5} />Upload</>}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── DNS Challenge Modal ── */}
      {showDNSModal && (
        <div
          className="fixed inset-0 bg-[#0B0C0F]/80 backdrop-blur-2xl flex items-center justify-center z-50 p-4"
          onClick={() => { setShowDNSModal(false); setDnsChallenge(null); setDnsError(null); setSelectedDomainForDNS(null); setDnsPropagated(false); }}
        >
          <div className="card-modal max-w-3xl w-full max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <h2 className="text-xl font-light text-white mb-2 tracking-tight">DNS-01 Challenge</h2>
            <p className="text-xs text-white/50 mb-5 font-light">Create a DNS TXT record to verify domain ownership</p>

            {dnsError && (
              <div className="bg-[#EF4444]/10 border border-[#EF4444]/20 rounded-xl p-4 mb-5">
                <p className="text-xs text-[#F87171]">{dnsError}</p>
              </div>
            )}

            {dnsChallenge ? (
              <>
                <div className="bg-[#06B6D4]/10 border border-[#06B6D4]/20 rounded-xl p-5 mb-5">
                  <div className="flex items-start gap-3 mb-4">
                    <div className="w-10 h-10 rounded-lg bg-[#06B6D4]/10 border border-[#06B6D4]/30 flex items-center justify-center flex-shrink-0">
                      <Shield className="w-5 h-5 text-[#22D3EE]" strokeWidth={1.5} />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-[#22D3EE] mb-1">DNS Configuration Required</p>
                      <p className="text-xs text-white/70 font-light">Add the TXT record below to your DNS provider, then click Validate.</p>
                    </div>
                  </div>
                </div>

                <div className="space-y-4 mb-5">
                  {[
                    { label: 'TXT Record Name',  value: dnsChallenge.txtRecord, field: 'name' },
                    { label: 'TXT Record Value', value: dnsChallenge.txtValue,  field: 'value' },
                  ].map(({ label, value, field }) => (
                    <div key={field}>
                      <label className="block text-xs font-medium text-white/60 uppercase tracking-[0.15em] mb-2">{label}</label>
                      <div className="bg-white/[0.02] border border-white/[0.08] rounded-lg px-4 py-3 flex items-center justify-between gap-3">
                        <code className="text-xs text-white/90 font-mono break-all">{value}</code>
                        <button
                          onClick={() => copyField(value, field)}
                          className={`text-xs flex-shrink-0 transition-colors duration-200 ${copiedField === field ? 'text-[#34D399]' : 'text-[#C77DFF] hover:text-[#9D4EDD]'}`}
                        >
                          {copiedField === field ? 'Copied!' : 'Copy'}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>

                {dnsPropagated && (
                  <div className="bg-[#10B981]/10 border border-[#10B981]/20 rounded-xl p-4 mb-5 flex items-center gap-2">
                    <CheckCircle className="w-4 h-4 text-[#34D399]" strokeWidth={1.5} />
                    <p className="text-xs text-[#34D399] font-medium">DNS record found! Ready to validate.</p>
                  </div>
                )}

                <div className="flex gap-3">
                  <button onClick={() => { setShowDNSModal(false); setDnsChallenge(null); setDnsError(null); setDnsPropagated(false); }}
                    className="btn-secondary flex-1 text-sm" disabled={dnsValidating || dnsCheckingPropagation}>
                    Cancel
                  </button>
                  <button onClick={handleCheckDNSPropagation}
                    className="btn-secondary flex-1 flex items-center justify-center gap-2 text-sm" disabled={dnsCheckingPropagation || dnsValidating}>
                    {dnsCheckingPropagation ? <><RefreshCw className="w-3.5 h-3.5 animate-spin" strokeWidth={1.5} />Checking...</> : <><RefreshCw className="w-3.5 h-3.5" strokeWidth={1.5} />Check DNS</>}
                  </button>
                  <button onClick={handleValidateDNS}
                    className="bg-gradient-to-r from-[#9D4EDD] to-[#7B2CBF] text-white font-medium text-sm hover:from-[#C77DFF] hover:to-[#9D4EDD] active:scale-[0.98] disabled:opacity-30 disabled:cursor-not-allowed rounded-lg px-6 py-3.5 transition-all duration-300 flex-1 flex items-center justify-center gap-2"
                    disabled={dnsValidating || dnsCheckingPropagation}>
                    {dnsValidating ? <><RefreshCw className="w-3.5 h-3.5 animate-spin" strokeWidth={1.5} />Validating...</> : <><CheckCircle className="w-3.5 h-3.5" strokeWidth={1.5} />Validate & Complete</>}
                  </button>
                </div>
              </>
            ) : (
              <div className="text-center py-8">
                <RefreshCw className="w-8 h-8 text-[#C77DFF] animate-spin mx-auto mb-3" strokeWidth={1.5} />
                <p className="text-xs text-white/60">Initiating DNS challenge...</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
