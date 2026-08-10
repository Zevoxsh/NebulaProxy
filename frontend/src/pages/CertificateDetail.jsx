import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Download, Upload, RefreshCw, Shield, Calendar, Key, FileText,
  AlertCircle, CheckCircle, Info, Lock, Copy, Trash2, Clock, AlertTriangle, XCircle
} from 'lucide-react';
import { sslAPI, domainAPI } from '../api/client';
import { useToast } from '@/hooks/use-toast';

const MIN_VALID_TS = new Date('2000-01-01').getTime();

function safeDate(val) {
  if (!val) return null;
  const ts = new Date(val).getTime();
  return ts > MIN_VALID_TS ? new Date(ts) : null;
}

function daysUntil(date) {
  if (!date) return null;
  return Math.ceil((date - Date.now()) / 86400000);
}

function formatEventType(type) {
  switch (type) {
    case 'issued':   return { label: 'Issued',          color: 'text-[#34D399]', icon: CheckCircle };
    case 'renewed':  return { label: 'Renewed',         color: 'text-[#22D3EE]', icon: RefreshCw  };
    case 'deleted':  return { label: 'Deleted',         color: 'text-[#F87171]', icon: Trash2     };
    case 'uploaded': return { label: 'Uploaded',        color: 'text-[#C77DFF]', icon: Upload     };
    case 'failed':   return { label: 'Renewal Failed',  color: 'text-[#FBBF24]', icon: AlertTriangle };
    default:         return { label: type,              color: 'text-white/50',  icon: Clock      };
  }
}

export default function CertificateDetail() {
  const { domainId } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();

  const [domain, setDomain] = useState(null);
  const [certificate, setCertificate] = useState(null);
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingContent, setLoadingContent] = useState(false);
  const [loadingEvents, setLoadingEvents] = useState(false);
  const [certContent, setCertContent] = useState(null);
  const [fullChainContent, setFullChainContent] = useState(null);

  // Upload
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadData, setUploadData] = useState({ fullChain: '', privateKey: '' });
  const [uploadError, setUploadError] = useState('');

  // Inline delete confirm
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Renewing
  const [renewing, setRenewing] = useState(false);

  // Copy feedback
  const [copiedKey, setCopiedKey] = useState(null);

  const pollingRef = useRef(null);

  // ── fetch ──────────────────────────────────────────────────────────────────

  const fetchCertificateDetails = useCallback(async () => {
    try {
      const [domainRes, certRes] = await Promise.all([
        domainAPI.get(domainId),
        sslAPI.getCertificateDetails(domainId)
      ]);
      setDomain(domainRes.data.domain);
      setCertificate(certRes.data.certificate);
    } catch (err) {
      console.error('Error fetching certificate details:', err);
      toast({ variant: 'destructive', title: 'Error', description: err.response?.data?.message || 'Failed to load certificate details' });
    } finally {
      setLoading(false);
    }
  }, [domainId, toast]);

  const fetchEvents = useCallback(async () => {
    setLoadingEvents(true);
    try {
      const res = await sslAPI.getEvents(domainId, 30);
      setEvents(res.data.events || []);
    } catch {
      // events are non-critical
    } finally {
      setLoadingEvents(false);
    }
  }, [domainId]);

  const loadCertificateContent = useCallback(async () => {
    setLoadingContent(true);
    try {
      const [certResp, chainResp] = await Promise.all([
        sslAPI.downloadCertificatePart(domainId, 'certificate').catch(() => ({ data: null })),
        sslAPI.downloadCertificatePart(domainId, 'fullchain').catch(() => ({ data: null }))
      ]);
      setCertContent(certResp.data);
      setFullChainContent(chainResp.data);
    } finally {
      setLoadingContent(false);
    }
  }, [domainId]);

  useEffect(() => {
    fetchCertificateDetails();
    fetchEvents();
  }, [fetchCertificateDetails, fetchEvents]);

  useEffect(() => {
    if (certificate) loadCertificateContent();
  }, [certificate, loadCertificateContent]);

  // Auto-poll while renewing
  useEffect(() => {
    if (certificate?.renewing) {
      pollingRef.current = setInterval(() => {
        fetchCertificateDetails();
        fetchEvents();
      }, 8000);
    } else {
      clearInterval(pollingRef.current);
    }
    return () => clearInterval(pollingRef.current);
  }, [certificate?.renewing, fetchCertificateDetails, fetchEvents]);

  // ── derived ────────────────────────────────────────────────────────────────

  const expiry = safeDate(certificate?.expiresAt);
  const issued = safeDate(certificate?.issuedAt);
  const days   = daysUntil(expiry);

  const getStatusColor = () => {
    if (certificate?.renewing) return 'text-[#22D3EE]';
    if (days === null) return 'text-[#FBBF24]';
    if (days > 45) return 'text-[#34D399]';
    if (days > 0)  return 'text-[#FBBF24]';
    return 'text-[#F87171]';
  };

  const getStatusLabel = () => {
    if (certificate?.renewing) return 'Renewing...';
    if (days === null) return 'Date invalide';
    if (days > 0) return `Valid — ${days} days left`;
    return `Expired ${Math.abs(days)} days ago`;
  };

  // ── actions ────────────────────────────────────────────────────────────────

  const handleRenew = async () => {
    setRenewing(true);
    try {
      await sslAPI.renew(domainId);
      await fetchCertificateDetails();
      await fetchEvents();
      toast({ title: 'Renewal initiated', description: 'Certificate renewal started. The page will update automatically.' });
    } catch (err) {
      toast({ variant: 'destructive', title: 'Renewal failed', description: err.response?.data?.message || 'Failed to renew certificate' });
    } finally {
      setRenewing(false);
    }
  };

  const handleUpload = async () => {
    if (!uploadData.fullChain || !uploadData.privateKey) {
      setUploadError('Full chain and private key are required');
      return;
    }
    setUploading(true);
    setUploadError('');
    try {
      await sslAPI.upload({ domainId, fullChain: uploadData.fullChain, privateKey: uploadData.privateKey });
      setShowUploadModal(false);
      setUploadData({ fullChain: '', privateKey: '' });
      await fetchCertificateDetails();
      await fetchEvents();
      toast({ title: 'Certificate uploaded', description: 'The certificate was uploaded successfully.' });
    } catch (err) {
      setUploadError(err.response?.data?.message || 'Failed to upload certificate');
    } finally {
      setUploading(false);
    }
  };

  const handleDownload = async (type) => {
    try {
      const response = await sslAPI.downloadCertificatePart(domainId, type);
      const blob = new Blob([response.data], { type: 'application/x-pem-file' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${domain.hostname}-${type}.pem`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      toast({ variant: 'destructive', title: 'Download failed', description: `Failed to download ${type}` });
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await sslAPI.deleteCertificate(domainId);
      toast({ title: 'Certificate deleted', description: 'Redirecting...' });
      setTimeout(() => navigate('/ssl-certificates'), 1200);
    } catch (err) {
      toast({ variant: 'destructive', title: 'Delete failed', description: err.response?.data?.message || 'Failed to delete certificate' });
      setDeleting(false);
      setConfirmDelete(false);
    }
  };

  const copy = (text, key) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 1500);
  };

  // ── loading / error ────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <RefreshCw className="w-8 h-8 text-[#C77DFF] animate-spin" strokeWidth={1.5} />
      </div>
    );
  }

  if (!domain) {
    return (
      <div className="flex-1 flex items-center justify-center p-4">
        <div className="bg-[#EF4444]/10 border border-[#EF4444]/20 rounded-xl p-6 max-w-md text-center">
          <AlertCircle className="w-12 h-12 text-[#F87171] mx-auto mb-4" strokeWidth={1.5} />
          <p className="text-sm text-[#F87171] mb-4">Failed to load domain</p>
          <button onClick={() => navigate('/ssl-certificates')} className="btn-secondary">Go Back</button>
        </div>
      </div>
    );
  }

  // ── render ─────────────────────────────────────────────────────────────────

  return (
    <div className="page-shell">
      <div className="page-header">
        <div className="page-header-inner">
          <div className="flex items-center gap-4">
            <button onClick={() => navigate('/ssl-certificates')} className="w-10 h-10 rounded-lg bg-white/[0.02] hover:bg-white/[0.05] border border-white/[0.08] flex items-center justify-center transition-all duration-300">
              <ArrowLeft className="w-5 h-5 text-white/70" strokeWidth={1.5} />
            </button>
            <div className="flex-1">
              <h1 className="text-xl md:text-2xl font-light text-white mb-1 tracking-tight">SSL Certificate</h1>
              <p className="text-xs text-white/50 font-light tracking-wide">{domain.hostname}</p>
            </div>
          </div>
        </div>
      </div>

      <div className="page-body">

        {/* ── Renewal error banner ── */}
        {certificate?.renewalErrorCount > 0 && (
          <div className="mb-4 bg-[#F59E0B]/10 border border-[#F59E0B]/20 rounded-xl p-4 flex items-start gap-3 animate-fade-in">
            <AlertTriangle className="w-5 h-5 text-[#FBBF24] flex-shrink-0 mt-0.5" strokeWidth={1.5} />
            <div>
              <p className="text-sm font-medium text-[#FBBF24] mb-1">
                {certificate.renewalErrorCount} failed renewal attempt{certificate.renewalErrorCount > 1 ? 's' : ''}
              </p>
              {certificate.renewalError && (
                <p className="text-xs text-white/70 font-light">{certificate.renewalError}</p>
              )}
              <p className="text-xs text-white/50 font-light mt-1">
                Renewal is subject to exponential back-off. It will be retried automatically.
              </p>
            </div>
          </div>
        )}

        {certificate ? (
          <div className="space-y-4">

            {/* ── Status card ── */}
            <div className="bg-[#161722]/50 backdrop-blur-2xl border border-white/[0.08] rounded-xl p-5">
              <div className="flex items-start justify-between flex-wrap gap-3 mb-5">
                <div className="flex items-center gap-3">
                  <div className={`w-12 h-12 rounded-xl bg-gradient-to-br from-[#9D4EDD]/10 to-[#9D4EDD]/5 border border-[#9D4EDD]/20 flex items-center justify-center ${certificate.renewing ? '' : ''}`}>
                    {certificate.renewing
                      ? <RefreshCw className="w-6 h-6 text-[#22D3EE] animate-spin" strokeWidth={1.5} />
                      : <Shield className="w-6 h-6 text-[#C77DFF]" strokeWidth={1.5} />
                    }
                  </div>
                  <div>
                    <h2 className="text-base font-light text-white mb-1">Certificate Status</h2>
                    <p className={`text-sm font-medium ${getStatusColor()}`}>{getStatusLabel()}</p>
                  </div>
                </div>
                <div className="flex gap-2 flex-wrap">
                  {certificate.type !== 'manual' && (
                    <button onClick={handleRenew} disabled={renewing || certificate.renewing} className="btn-secondary flex items-center gap-2 text-xs px-4 py-2">
                      <RefreshCw className={`w-4 h-4 ${(renewing || certificate.renewing) ? 'animate-spin' : ''}`} strokeWidth={1.5} />
                      Renew
                    </button>
                  )}
                  <button onClick={() => setShowUploadModal(true)} className="btn-primary flex items-center gap-2 text-xs px-4 py-2">
                    <Upload className="w-4 h-4" strokeWidth={1.5} />
                    Upload New
                  </button>
                </div>
              </div>

              {/* Info grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="bg-white/[0.02] border border-white/[0.06] rounded-lg p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <Info className="w-4 h-4 text-[#C77DFF]" strokeWidth={1.5} />
                    <p className="text-xs font-medium text-white/50 uppercase tracking-wider">Issuer</p>
                  </div>
                  <p className="text-sm text-white/90 font-light">{certificate.issuer || "Let's Encrypt"}</p>
                </div>

                <div className="bg-white/[0.02] border border-white/[0.06] rounded-lg p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <Calendar className="w-4 h-4 text-[#C77DFF]" strokeWidth={1.5} />
                    <p className="text-xs font-medium text-white/50 uppercase tracking-wider">Expires</p>
                  </div>
                  <p className={`text-sm font-light ${expiry ? 'text-white/90' : 'text-[#FBBF24]'}`}>
                    {expiry
                      ? expiry.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
                      : 'Date invalide'}
                  </p>
                </div>

                <div className="bg-white/[0.02] border border-white/[0.06] rounded-lg p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <Calendar className="w-4 h-4 text-[#C77DFF]" strokeWidth={1.5} />
                    <p className="text-xs font-medium text-white/50 uppercase tracking-wider">Issued</p>
                  </div>
                  <p className="text-sm text-white/90 font-light">
                    {issued
                      ? issued.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
                      : '—'}
                  </p>
                </div>

                <div className="bg-white/[0.02] border border-white/[0.06] rounded-lg p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <FileText className="w-4 h-4 text-[#C77DFF]" strokeWidth={1.5} />
                    <p className="text-xs font-medium text-white/50 uppercase tracking-wider">Type</p>
                  </div>
                  <p className="text-sm text-white/90 font-light capitalize">{certificate.type || 'Manual'}</p>
                </div>
              </div>
            </div>

            {/* ── Certificate technical details ── */}
            {certificate.details && (
              <div className="bg-[#161722]/50 backdrop-blur-2xl border border-white/[0.08] rounded-xl p-5">
                <h2 className="text-base font-light text-white mb-4">Certificate Details</h2>
                <div className="space-y-4">
                  {certificate.details.subject && (
                    <div>
                      <p className="text-xs font-medium text-white/50 uppercase tracking-wider mb-2">Subject</p>
                      <p className="text-sm text-white/90 font-mono font-light break-all bg-white/[0.02] border border-white/[0.06] rounded-lg p-3">
                        {certificate.details.subject}
                      </p>
                    </div>
                  )}
                  {certificate.details.serialNumber && (
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <p className="text-xs font-medium text-white/50 uppercase tracking-wider">Serial Number</p>
                        <button onClick={() => copy(certificate.details.serialNumber, 'serial')} className={`transition-colors ${copiedKey === 'serial' ? 'text-[#34D399]' : 'text-[#C77DFF] hover:text-[#9D4EDD]'}`}>
                          <Copy className="w-3.5 h-3.5" strokeWidth={1.5} />
                        </button>
                      </div>
                      <p className="text-sm text-white/90 font-mono font-light break-all bg-white/[0.02] border border-white/[0.06] rounded-lg p-3">
                        {certificate.details.serialNumber}
                      </p>
                    </div>
                  )}
                  {certificate.details.signatureAlgorithm && (
                    <div>
                      <p className="text-xs font-medium text-white/50 uppercase tracking-wider mb-2">Signature Algorithm</p>
                      <p className="text-sm text-white/90 font-light">{certificate.details.signatureAlgorithm}</p>
                    </div>
                  )}
                  {certificate.details.subjectAltNames && (
                    <div>
                      <p className="text-xs font-medium text-white/50 uppercase tracking-wider mb-2">Subject Alternative Names</p>
                      <div className="flex flex-wrap gap-2">
                        {certificate.details.subjectAltNames.split(',').map((san, i) => (
                          <span key={i} className="px-3 py-1.5 bg-[#9D4EDD]/15 text-[#C77DFF] rounded-full text-xs font-medium border border-[#9D4EDD]/30">{san.trim()}</span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* ── Download / view PEM ── */}
            <div className="bg-[#161722]/50 backdrop-blur-2xl border border-white/[0.08] rounded-xl p-5">
              <h2 className="text-base font-light text-white mb-4">Certificate Files</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-6">
                <button onClick={() => handleDownload('certificate')} className="bg-white/[0.02] hover:bg-white/[0.05] border border-white/[0.08] hover:border-[#9D4EDD]/30 text-white/90 hover:text-[#C77DFF] rounded-lg px-4 py-3 font-light text-sm transition-all duration-300 flex items-center justify-center gap-2">
                  <Download className="w-4 h-4" strokeWidth={1.5} />Certificate
                </button>
                <button onClick={() => handleDownload('fullchain')} className="bg-white/[0.02] hover:bg-white/[0.05] border border-white/[0.08] hover:border-[#9D4EDD]/30 text-white/90 hover:text-[#C77DFF] rounded-lg px-4 py-3 font-light text-sm transition-all duration-300 flex items-center justify-center gap-2">
                  <Lock className="w-4 h-4" strokeWidth={1.5} />Full Chain
                </button>
              </div>

              {loadingContent ? (
                <div className="flex items-center justify-center py-8">
                  <RefreshCw className="w-6 h-6 text-[#C77DFF] animate-spin" strokeWidth={1.5} />
                </div>
              ) : (
                <div className="space-y-4">
                  {fullChainContent && (
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <label className="text-xs font-medium text-white/50 uppercase tracking-wider">Full Chain</label>
                        <button onClick={() => copy(fullChainContent, 'chain')} className={`flex items-center gap-1 text-xs transition-colors ${copiedKey === 'chain' ? 'text-[#34D399]' : 'text-[#C77DFF] hover:text-[#9D4EDD]'}`}>
                          <Copy className="w-3.5 h-3.5" strokeWidth={1.5} />
                          {copiedKey === 'chain' ? 'Copied!' : 'Copy'}
                        </button>
                      </div>
                      <pre className="bg-white/[0.02] border border-white/[0.06] rounded-lg p-4 text-xs text-white/80 font-mono font-light overflow-x-auto max-h-64 overflow-y-auto">{fullChainContent}</pre>
                    </div>
                  )}
                  {certContent && (
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <label className="text-xs font-medium text-white/50 uppercase tracking-wider">Certificate</label>
                        <button onClick={() => copy(certContent, 'cert')} className={`flex items-center gap-1 text-xs transition-colors ${copiedKey === 'cert' ? 'text-[#34D399]' : 'text-[#C77DFF] hover:text-[#9D4EDD]'}`}>
                          <Copy className="w-3.5 h-3.5" strokeWidth={1.5} />
                          {copiedKey === 'cert' ? 'Copied!' : 'Copy'}
                        </button>
                      </div>
                      <pre className="bg-white/[0.02] border border-white/[0.06] rounded-lg p-4 text-xs text-white/80 font-mono font-light overflow-x-auto max-h-64 overflow-y-auto">{certContent}</pre>
                    </div>
                  )}
                  <div className="bg-[#F59E0B]/5 border border-[#F59E0B]/20 rounded-lg p-4 flex items-start gap-3">
                    <AlertCircle className="w-5 h-5 text-[#FBBF24] flex-shrink-0 mt-0.5" strokeWidth={1.5} />
                    <div>
                      <h3 className="text-sm font-medium text-[#FBBF24] mb-1">Private Key</h3>
                      <p className="text-xs text-white/60 font-light">Not displayed for security. Download it above if needed.</p>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* ── SSL Events history ── */}
            <div className="bg-[#161722]/50 backdrop-blur-2xl border border-white/[0.08] rounded-xl p-5">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-base font-light text-white">Event History</h2>
                <button onClick={fetchEvents} className="p-1.5 text-white/40 hover:text-white/70 hover:bg-white/[0.04] rounded-lg transition-all" title="Refresh events">
                  <RefreshCw className={`w-3.5 h-3.5 ${loadingEvents ? 'animate-spin' : ''}`} strokeWidth={1.5} />
                </button>
              </div>

              {loadingEvents ? (
                <div className="flex items-center justify-center py-6">
                  <RefreshCw className="w-5 h-5 text-[#C77DFF] animate-spin" strokeWidth={1.5} />
                </div>
              ) : events.length === 0 ? (
                <p className="text-xs text-white/40 font-light text-center py-6">No events recorded yet</p>
              ) : (
                <div className="space-y-2">
                  {events.map((ev) => {
                    const { label, color, icon: Icon } = formatEventType(ev.event_type);
                    return (
                      <div key={ev.id} className="flex items-start gap-3 py-2.5 border-b border-white/[0.05] last:border-0">
                        <div className="w-7 h-7 rounded-lg bg-white/[0.03] border border-white/[0.06] flex items-center justify-center flex-shrink-0 mt-0.5">
                          <Icon className={`w-3.5 h-3.5 ${color}`} strokeWidth={1.5} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className={`text-xs font-medium ${color}`}>{label}</p>
                          {ev.message && <p className="text-xs text-white/50 font-light mt-0.5 truncate">{ev.message}</p>}
                        </div>
                        <p className="text-xs text-white/30 font-light flex-shrink-0">
                          {new Date(ev.created_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                        </p>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* ── Danger Zone ── */}
            <div className="bg-[#EF4444]/5 border border-[#EF4444]/20 rounded-xl p-5">
              <h2 className="text-base font-light text-[#F87171] mb-2">Danger Zone</h2>
              <p className="text-sm text-white/70 font-light mb-4">
                Deleting this certificate removes all associated data and cannot be undone.
              </p>
              {!confirmDelete ? (
                <button onClick={() => setConfirmDelete(true)} className="bg-[#EF4444]/10 hover:bg-[#EF4444]/20 border border-[#EF4444]/30 hover:border-[#EF4444]/50 text-[#F87171] rounded-lg px-4 py-2.5 font-light text-sm transition-all duration-300 flex items-center gap-2">
                  <Trash2 className="w-4 h-4" strokeWidth={1.5} />
                  Delete Certificate
                </button>
              ) : (
                <div className="flex items-center gap-3">
                  <p className="text-sm text-[#F87171] font-light">Confirm deletion of the certificate for <strong>{domain.hostname}</strong>?</p>
                  <button onClick={handleDelete} disabled={deleting} className="bg-[#EF4444]/20 hover:bg-[#EF4444]/30 border border-[#EF4444]/50 text-[#F87171] rounded-lg px-4 py-2 font-medium text-sm transition-all flex items-center gap-2 disabled:opacity-50">
                    {deleting ? <RefreshCw className="w-3.5 h-3.5 animate-spin" strokeWidth={1.5} /> : <Trash2 className="w-3.5 h-3.5" strokeWidth={1.5} />}
                    {deleting ? 'Deleting…' : 'Yes, delete'}
                  </button>
                  <button onClick={() => setConfirmDelete(false)} disabled={deleting} className="btn-secondary text-sm px-4 py-2">Cancel</button>
                </div>
              )}
            </div>

          </div>
        ) : (
          /* No cert yet */
          <div className="bg-[#161722]/50 backdrop-blur-2xl border border-white/[0.08] rounded-xl p-8 text-center">
            <div className="w-16 h-16 rounded-full bg-white/[0.02] border border-white/[0.08] flex items-center justify-center mx-auto mb-4">
              <Shield className="w-8 h-8 text-white/40" strokeWidth={1.5} />
            </div>
            <h2 className="text-lg font-light text-white mb-2">No Certificate Found</h2>
            <p className="text-sm text-white/50 font-light mb-6 max-w-md mx-auto">
              This domain doesn't have an SSL certificate yet. Upload one or request one from Let's Encrypt.
            </p>
            <button onClick={() => setShowUploadModal(true)} className="btn-primary inline-flex items-center gap-2">
              <Upload className="w-4 h-4" strokeWidth={1.5} />
              Upload Certificate
            </button>
          </div>
        )}

        {/* ── Upload Modal ── */}
        {showUploadModal && (
          <div className="fixed inset-0 bg-[#0B0C0F]/80 backdrop-blur-2xl flex items-center justify-center z-[250] p-4" onClick={() => setShowUploadModal(false)}>
            <div className="bg-[#161722]/95 backdrop-blur-2xl border border-white/[0.08] rounded-xl max-w-2xl w-full p-6 shadow-lg max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
              <h2 className="text-xl font-light text-white mb-6 tracking-tight">Upload Custom Certificate</h2>

              {uploadError && (
                <div className="bg-[#EF4444]/10 border border-[#EF4444]/20 rounded-xl p-4 mb-4 flex items-start gap-3">
                  <AlertCircle className="w-5 h-5 text-[#F87171] flex-shrink-0 mt-0.5" strokeWidth={1.5} />
                  <p className="text-sm text-[#F87171]">{uploadError}</p>
                </div>
              )}

              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-white/60 uppercase tracking-wider mb-1">Full Chain (fullchain.pem) *</label>
                  <p className="text-xs text-white/40 mb-2 font-light">Certificate + intermediates in PEM format</p>
                  <textarea
                    value={uploadData.fullChain}
                    onChange={e => setUploadData({ ...uploadData, fullChain: e.target.value })}
                    placeholder={"-----BEGIN CERTIFICATE-----\n...\n-----END CERTIFICATE-----"}
                    className="w-full h-36 bg-white/[0.02] border border-white/[0.08] rounded-lg px-4 py-3 text-white/95 placeholder-white/30 font-mono text-xs font-light focus:outline-none focus:border-[#9D4EDD]/50 focus:ring-2 focus:ring-[#9D4EDD]/10 transition-all duration-300 resize-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-white/60 uppercase tracking-wider mb-1">Private Key (key.pem) *</label>
                  <p className="text-xs text-white/40 mb-2 font-light">Keep this secret</p>
                  <textarea
                    value={uploadData.privateKey}
                    onChange={e => setUploadData({ ...uploadData, privateKey: e.target.value })}
                    placeholder={"-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----"}
                    className="w-full h-32 bg-white/[0.02] border border-white/[0.08] rounded-lg px-4 py-3 text-white/95 placeholder-white/30 font-mono text-xs font-light focus:outline-none focus:border-[#9D4EDD]/50 focus:ring-2 focus:ring-[#9D4EDD]/10 transition-all duration-300 resize-none"
                  />
                </div>

                <div className="bg-[#06B6D4]/10 border border-[#06B6D4]/20 rounded-lg p-4 flex items-start gap-2.5">
                  <Shield className="w-4 h-4 text-[#22D3EE] flex-shrink-0 mt-0.5" strokeWidth={1.5} />
                  <div>
                    <p className="text-xs text-[#22D3EE] font-medium mb-1">Automatic validation</p>
                    <ul className="text-xs text-white/70 font-light space-y-0.5">
                      <li>✓ Valid PEM format</li>
                      <li>✓ Matches domain <span className="font-medium text-[#22D3EE]">{domain?.hostname}</span></li>
                      <li>✓ Not expired</li>
                      <li>✓ Private key matches certificate</li>
                    </ul>
                  </div>
                </div>
              </div>

              <div className="flex gap-3 mt-6">
                <button onClick={() => setShowUploadModal(false)} disabled={uploading} className="flex-1 bg-white/[0.02] hover:bg-white/[0.05] border border-white/[0.08] hover:border-[#9D4EDD]/30 text-white/90 hover:text-[#C77DFF] rounded-lg px-6 py-3.5 font-light text-sm transition-all duration-300">
                  Cancel
                </button>
                <button onClick={handleUpload} disabled={uploading} className="flex-1 bg-gradient-to-r from-[#9D4EDD] to-[#7B2CBF] text-white font-medium text-sm hover:from-[#C77DFF] hover:to-[#9D4EDD] active:scale-[0.98] disabled:opacity-30 disabled:cursor-not-allowed rounded-lg px-6 py-3.5 transition-all duration-300 flex items-center justify-center gap-2">
                  {uploading ? <><RefreshCw className="w-4 h-4 animate-spin" strokeWidth={1.5} />Uploading...</> : <><Upload className="w-4 h-4" strokeWidth={1.5} />Upload Certificate</>}
                </button>
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
