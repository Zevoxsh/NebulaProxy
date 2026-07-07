import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Shield, Upload, RefreshCw, Calendar, CheckCircle, AlertTriangle, XCircle, Search } from 'lucide-react';
import { sslAPI } from '../api/client';
import { Combobox } from '../components/ui/combobox';
import { PaginationControls } from '@/components/ui/pagination-controls';
import { Switch } from '@/components/ui/switch';

export default function SSLCertificates() {
  const navigate = useNavigate();
  const [certificates, setCertificates] = useState([]);
  const [stats, setStats] = useState({ valid: 0, expiringSoon: 0, expired: 0 });
  const [loading, setLoading] = useState(true);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [renewingId, setRenewingId] = useState(null);
  const [uploadData, setUploadData] = useState({
    domainId: '',
    fullChain: '',
    privateKey: ''
  });
  const [uploadError, setUploadError] = useState(null);
  const [ownershipFilter, setOwnershipFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;

  // DNS Challenge States
  const [showDNSModal, setShowDNSModal] = useState(false);
  const [dnsChallenge, setDnsChallenge] = useState(null);
  const [dnsValidating, setDnsValidating] = useState(false);
  const [dnsCheckingPropagation, setDnsCheckingPropagation] = useState(false);
  const [dnsPropagated, setDnsPropagated] = useState(false);
  const [dnsError, setDnsError] = useState(null);
  const [selectedDomainForDNS, setSelectedDomainForDNS] = useState(null);

  // Fetch certificates and stats
  const fetchCertificates = async () => {
    try {
      const [certsResponse, statsResponse] = await Promise.all([
        sslAPI.getCertificates(),
        sslAPI.getStats()
      ]);

      setCertificates(certsResponse.data.certificates || []);
      setStats(statsResponse.data || { valid: 0, expiringSoon: 0, expired: 0 });
    } catch (error) {
      console.error('Error fetching certificates:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCertificates();
  }, []);

  const getDaysUntilExpiry = (expiresAt) => {
    const now = new Date();
    const expiry = new Date(expiresAt);
    const diff = expiry - now;
    return Math.ceil(diff / (1000 * 60 * 60 * 24));
  };

  const getStatusBadge = (status) => {
    switch (status) {
      case 'valid':
        return <span className="badge-success">Valid</span>;
      case 'expiring-soon':
        return <span className="badge-warning">Expiring Soon</span>;
      case 'expired':
        return <span className="badge-error">Expired</span>;
      default:
        return <span className="badge-purple">Unknown</span>;
    }
  };

  const getStatusIcon = (status) => {
    switch (status) {
      case 'valid':
        return <CheckCircle className="w-4 h-4 text-[#34D399]" strokeWidth={1.5} />;
      case 'expiring-soon':
        return <AlertTriangle className="w-4 h-4 text-[#FBBF24]" strokeWidth={1.5} />;
      case 'expired':
        return <XCircle className="w-4 h-4 text-[#F87171]" strokeWidth={1.5} />;
      default:
        return <Shield className="w-4 h-4 text-white/40" strokeWidth={1.5} />;
    }
  };

  const filteredCertificates = certificates.filter((cert) => {
    // Ownership filter
    if (ownershipFilter === 'team' && cert.ownershipType !== 'team') return false;
    if (ownershipFilter === 'personal' && cert.ownershipType === 'team') return false;

    // Search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      return (
        cert.domain?.toLowerCase().includes(query) ||
        cert.issuer?.toLowerCase().includes(query)
      );
    }

    return true;
  });
  const totalPages = Math.max(1, Math.ceil(filteredCertificates.length / itemsPerPage));
  const startIndex = (currentPage - 1) * itemsPerPage;
  const paginatedCertificates = filteredCertificates.slice(startIndex, startIndex + itemsPerPage);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, ownershipFilter]);

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, totalPages]);

  const handleRenew = async (domainId) => {
    const cert = certificates.find(c => c.id === domainId);

    // Manual certs can't be auto-renewed — open the upload dialog directly
    if (cert && cert.type === 'manual') {
      setUploadData({ domainId: String(domainId), fullChain: '', privateKey: '' });
      setUploadError(null);
      setShowUploadModal(true);
      return;
    }

    setRenewingId(domainId);
    try {
      await sslAPI.renew(domainId);
      await fetchCertificates();
    } catch (error) {
      console.error('Error renewing certificate:', error);
      const message = error.response?.data?.message || 'Failed to renew certificate';

      // If renewal failed because DNS-01 challenge is required or initiated,
      // open the DNS challenge modal so the user can follow DNS instructions.
      const lower = (message || '').toLowerCase();
      if (lower.includes('dns') || lower.includes('dns-01') || lower.includes('dns challenge')) {
        handleRequestDNS(domainId);
        return;
      }

      alert(message);
    } finally {
      setRenewingId(null);
    }
  };

  const handleToggleAutoRenew = async (domainId, currentAutoRenew) => {
    try {
      await sslAPI.toggleAutoRenew(domainId, !currentAutoRenew);
      // Update local state
      setCertificates(certs =>
        certs.map(cert =>
          cert.id === domainId ? { ...cert, autoRenew: !currentAutoRenew } : cert
        )
      );
    } catch (error) {
      console.error('Error toggling auto-renew:', error);
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
      // API expects { domainId, fullChain, privateKey }
      await sslAPI.upload(uploadData);
      await fetchCertificates(); // Refresh certificates list
      setShowUploadModal(false);
      setUploadData({ domainId: '', fullChain: '', privateKey: '' });
    } catch (error) {
      setUploadError(error.response?.data?.message || 'Failed to upload certificate');
    } finally {
      setUploading(false);
    }
  };

  // DNS Challenge Handlers
  const handleRequestDNS = async (domainId) => {
    setDnsError(null);
    setShowDNSModal(true);
    setSelectedDomainForDNS(domainId);
    setDnsPropagated(false);

    try {
      const response = await sslAPI.requestDNS(domainId);

      if (response.data.success) {
        setDnsChallenge(response.data.challenge);

        if (response.data.alreadyPending) {
          console.log('Using existing DNS challenge');
        }
      }
    } catch (error) {
      console.error('Error requesting DNS challenge:', error);
      setDnsError(error.response?.data?.message || 'Failed to initiate DNS challenge');
    }
  };

  const handleCheckDNSPropagation = async () => {
    if (!selectedDomainForDNS) return;

    setDnsCheckingPropagation(true);

    try {
      const response = await sslAPI.checkDNSPropagation(selectedDomainForDNS);

      if (response.data.propagated) {
        setDnsPropagated(true);
        setDnsError(null);
      } else {
        setDnsPropagated(false);
        setDnsError('DNS record not yet propagated. Please wait and try again.');
      }
    } catch (error) {
      console.error('Error checking DNS propagation:', error);
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
      const response = await sslAPI.validateDNS(selectedDomainForDNS, true);

      if (response.data.success) {
        // Certificate obtained successfully
        await fetchCertificates(); // Refresh list
        setShowDNSModal(false);
        setDnsChallenge(null);
        setSelectedDomainForDNS(null);

        // Show success notification
        alert('Certificate obtained successfully!');
      } else if (response.data.propagated === false) {
        setDnsError(response.data.message);
      }
    } catch (error) {
      console.error('Error validating DNS challenge:', error);
      const data = error.response?.data;
      if (data?.reinitiateRequired) {
        // Certbot process died — close modal and let user re-initiate
        setShowDNSModal(false);
        setDnsChallenge(null);
        setDnsError(null);
        alert('The certificate session expired (server restarted or timed out). Please click "Request DNS Challenge" again to start over.');
      } else {
        setDnsError(data?.message || 'DNS validation failed');
      }
    } finally {
      setDnsValidating(false);
    }
  };

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
          {/* Header */}
          <div className="animate-fade-in flex items-center justify-between gap-3 flex-wrap">
            <div>
              <h1 className="text-xl md:text-2xl font-light text-white mb-2 tracking-tight">SSL Certificates</h1>
              <p className="text-xs text-white/50 font-light tracking-wide">Manage SSL/TLS certificates and auto-renewal</p>
            </div>
            <button
              onClick={() => setShowUploadModal(true)}
              className="btn-primary flex items-center gap-2 text-xs px-4 py-2"
            >
              <Upload className="w-4 h-4" strokeWidth={1.5} />
              Upload
            </button>
          </div>
        </div>
      </div>

      <div className="page-body">

        {/* Status Overview */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
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
        </div>

        {/* Search & Filters */}
        <div className="mb-4 space-y-3">
          {/* Search Bar */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30" strokeWidth={1.5} />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by domain or issuer..."
              className="input-futuristic pl-10 text-xs"
            />
          </div>

          {/* Ownership Filters */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs uppercase tracking-[0.2em] text-white/40">Ownership</span>
            <button
              onClick={() => setOwnershipFilter('all')}
              className={ownershipFilter === 'all' ? 'btn-primary px-4 text-xs' : 'btn-secondary px-4 text-xs'}
            >
              All
            </button>
            <button
              onClick={() => setOwnershipFilter('personal')}
              className={ownershipFilter === 'personal' ? 'btn-primary px-4 text-xs' : 'btn-secondary px-4 text-xs'}
            >
              Personal
            </button>
            <button
              onClick={() => setOwnershipFilter('team')}
              className={ownershipFilter === 'team' ? 'btn-primary px-4 text-xs' : 'btn-secondary px-4 text-xs'}
            >
              Team
            </button>
          </div>
        </div>

        {/* Certificates List */}
        <div className="bg-[#161722]/50 backdrop-blur-2xl border border-white/[0.08] rounded-xl p-0 overflow-hidden shadow-lg animate-fade-in" style={{ animationDelay: '0.4s' }}>
          <div className="p-4 border-b border-white/[0.08]">
            <h2 className="text-base font-light text-white tracking-tight mb-1">Installed Certificates</h2>
            <p className="text-xs text-white/50 font-light tracking-wide">SSL/TLS certificates for your domains</p>
          </div>

          {filteredCertificates.length === 0 ? (
            <div className="p-12 text-center">
              <div className="w-16 h-16 rounded-xl bg-gradient-to-br from-[#9D4EDD]/10 to-[#9D4EDD]/5 border border-[#9D4EDD]/20 flex items-center justify-center mx-auto mb-4">
                <Shield className="w-8 h-8 text-[#C77DFF]" strokeWidth={1.5} />
              </div>
              <h3 className="text-base font-light text-white mb-2">No SSL Certificates</h3>
              <p className="text-xs text-white/50 font-light mb-6 max-w-md mx-auto">
                Enable SSL on your domains or upload custom certificates
              </p>
              <button
                onClick={() => setShowUploadModal(true)}
                className="btn-primary inline-flex items-center gap-2 text-xs px-4 py-2.5"
              >
                <Upload className="w-4 h-4" strokeWidth={1.5} />
                Upload Certificate
              </button>
            </div>
          ) : (
            <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px]">
                <thead>
                  <tr className="border-b border-white/[0.08]">
                    <th className="text-left text-xs uppercase tracking-[0.15em] text-white/50 font-medium px-3 py-2">
                      Domain
                    </th>
                    <th className="text-left text-xs uppercase tracking-[0.15em] text-white/50 font-medium px-3 py-2">
                      Issuer
                    </th>
                    <th className="text-left text-xs uppercase tracking-[0.15em] text-white/50 font-medium px-3 py-2">
                      Status
                    </th>
                    <th className="text-left text-xs uppercase tracking-[0.15em] text-white/50 font-medium px-3 py-2">
                      Issued
                    </th>
                    <th className="text-left text-xs uppercase tracking-[0.15em] text-white/50 font-medium px-3 py-2">
                      Expiry
                    </th>
                    <th className="text-left text-xs uppercase tracking-[0.15em] text-white/50 font-medium px-3 py-2">
                      Auto-Renew
                    </th>
                    <th className="text-left text-xs uppercase tracking-[0.15em] text-white/50 font-medium px-3 py-2">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedCertificates.map((cert) => {
                  const daysUntilExpiry = getDaysUntilExpiry(cert.expiresAt);

                  return (
                    <tr
                      key={cert.id}
                      className="border-b border-white/[0.05] last:border-0 hover:bg-white/[0.02] transition-all duration-500 cursor-pointer group"
                      onClick={() => navigate(`/certificates/${cert.id}`)}
                    >
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2.5">
                          <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                            cert.status === 'valid' ? 'bg-[#10B981]/10 border border-[#10B981]/20' :
                            cert.status === 'expiring-soon' ? 'bg-[#F59E0B]/10 border border-[#F59E0B]/20' :
                            'bg-[#EF4444]/10 border border-[#EF4444]/20'
                          }`}>
                            {getStatusIcon(cert.status)}
                          </div>
                          <div>
                            <p className="text-xs font-normal text-white group-hover:text-[#C77DFF] transition-colors duration-300">{cert.domain}</p>
                            <p className="text-xs text-white/60 font-light capitalize">{cert.type}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <span className="text-xs text-white/70 font-light">{cert.issuer}</span>
                      </td>
                      <td className="px-3 py-2">
                        {getStatusBadge(cert.status)}
                      </td>
                      <td className="px-3 py-2">
                        <span className="text-xs text-white/60 font-light">
                          {new Date(cert.issuedAt).toLocaleDateString()}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <div>
                          <p className={`text-xs font-normal ${
                            daysUntilExpiry > 30 ? 'text-white' :
                            daysUntilExpiry > 0 ? 'text-[#FBBF24]' :
                            'text-[#F87171]'
                          }`}>
                            {new Date(cert.expiresAt).toLocaleDateString()}
                          </p>
                          <p className="text-xs text-white/60 font-light">
                            {daysUntilExpiry > 0 ? `${daysUntilExpiry}d left` : `Exp. ${Math.abs(daysUntilExpiry)}d ago`}
                          </p>
                        </div>
                      </td>
                      <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                        <Switch
                          checked={cert.autoRenew}
                          onCheckedChange={() => handleToggleAutoRenew(cert.id, cert.autoRenew)}
                        />
                      </td>
                      <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                        <button
                          onClick={() => handleRenew(cert.id)}
                          disabled={renewingId === cert.id}
                          className="p-2 text-[#C77DFF] hover:bg-[#9D4EDD]/10 rounded-lg transition-all duration-500 active:scale-98 disabled:opacity-50 disabled:cursor-not-allowed"
                          title="Renew Now"
                        >
                          <RefreshCw className={`w-4 h-4 ${renewingId === cert.id ? 'animate-spin' : ''}`} strokeWidth={1.5} />
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
                totalItems={filteredCertificates.length}
                pageSize={itemsPerPage}
                onPageChange={setCurrentPage}
                label="certificates"
              />
            </div>
            </>
          )}
        </div>

        {/* Info Card */}
        <div className="bg-[#06B6D4]/10 backdrop-blur-lg border border-[#06B6D4]/20 rounded-xl p-4 mt-6 animate-fade-in" style={{ animationDelay: '0.5s' }}>
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-lg bg-[#06B6D4]/10 border border-[#06B6D4]/30 flex items-center justify-center flex-shrink-0">
              <Shield className="w-4 h-4 text-[#22D3EE]" strokeWidth={1.5} />
            </div>
            <div className="flex-1">
              <p className="text-xs font-medium text-[#22D3EE] mb-1">Automatic SSL Renewal with Let's Encrypt</p>
              <p className="text-xs text-white/70 font-light leading-relaxed">
                Certificates from Let's Encrypt are automatically renewed 30 days before expiration. Manual certificates require manual renewal or upload.
              </p>
            </div>
          </div>
        </div>

      </div>

      {/* Upload Modal */}
      {showUploadModal && (
        <div className="fixed inset-0 bg-[#0B0C0F]/80 backdrop-blur-2xl flex items-center justify-center z-50 p-4" onClick={() => {
          setShowUploadModal(false);
          setUploadError(null);
          setUploadData({ domainId: '', certificate: '', privateKey: '' });
        }}>
          <div className="card-modal max-w-2xl w-full max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-base font-light text-white mb-1">Upload Custom SSL Certificate</h2>
            <p className="text-xs text-white/50 mb-4">Upload a custom SSL/TLS certificate for your domain</p>

            {uploadError && (
              <div className="bg-[#EF4444]/10 backdrop-blur-lg border border-[#EF4444]/20 rounded-lg p-3 mb-4">
                <p className="text-xs text-[#F87171]">{uploadError}</p>
              </div>
            )}

            <div className="space-y-4">
              {/* Domain Selection */}
              <div>
                <label className="block text-xs font-medium text-white/60 uppercase tracking-[0.15em] mb-2">Select Domain</label>
                <Combobox
                  value={uploadData.domainId}
                  onValueChange={(value) => setUploadData({ ...uploadData, domainId: value })}
                  options={[
                    { value: '', label: 'Choose a domain...' },
                    ...certificates.map((cert) => ({ value: cert.id.toString(), label: cert.domain })),
                  ]}
                  placeholder="Choose a domain..."
                  searchPlaceholder="Search domain..."
                  emptyText="No domain found."
                  triggerClassName="h-10 text-xs bg-admin-bg border-admin-border text-admin-text"
                  contentClassName="max-h-72"
                />
              </div>

              {/* Full Chain */}
              <div>
                <label className="block text-xs font-medium text-white/60 uppercase tracking-[0.15em] mb-2">
                  Full Chain (PEM format)
                </label>
                <textarea
                  value={uploadData.fullChain}
                  onChange={(e) => setUploadData({ ...uploadData, fullChain: e.target.value })}
                  className="input-futuristic text-xs font-mono h-32 resize-none"
                  placeholder="-----BEGIN CERTIFICATE-----&#10;MIIDXTCCAkWgAwIBAgIJAKZ...&#10;-----END CERTIFICATE-----\n-----BEGIN CERTIFICATE-----&#10;... intermediate ...&#10;-----END CERTIFICATE-----"
                />
              </div>

              {/* Private Key */}
              <div>
                <label className="block text-xs font-medium text-white/60 uppercase tracking-[0.15em] mb-2">
                  Private Key (PEM format)
                </label>
                <textarea
                  value={uploadData.privateKey}
                  onChange={(e) => setUploadData({ ...uploadData, privateKey: e.target.value })}
                  className="input-futuristic text-xs font-mono h-32 resize-none"
                  placeholder="-----BEGIN PRIVATE KEY-----&#10;MIIEvQIBADANBgkqhkiG...&#10;-----END PRIVATE KEY-----"
                />
              </div>

              {/* Info */}
              <div className="bg-[#06B6D4]/10 backdrop-blur-lg border border-[#06B6D4]/20 rounded-lg p-3">
                <div className="flex items-start gap-2.5">
                  <Shield className="w-4 h-4 text-[#22D3EE] flex-shrink-0 mt-0.5" strokeWidth={1.5} />
                  <div>
                    <p className="text-xs font-medium text-[#22D3EE] mb-0.5">Certificate Format</p>
                    <p className="text-xs text-white/70 font-light leading-relaxed">
                      Both certificate and private key must be in PEM format. The certificate should include the full chain if available.
                    </p>
                  </div>
                </div>
              </div>

              {/* Actions */}
              <div className="flex gap-2.5 pt-3">
                <button
                  onClick={() => {
                    setShowUploadModal(false);
                    setUploadError(null);
                    setUploadData({ domainId: '', certificate: '', privateKey: '' });
                  }}
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
                  {uploading ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" strokeWidth={1.5} />
                      Uploading...
                    </>
                  ) : (
                    <>
                      <Upload className="w-3.5 h-3.5" strokeWidth={1.5} />
                      Upload
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* DNS Challenge Modal */}
      {showDNSModal && (
        <div
          className="fixed inset-0 bg-[#0B0C0F]/80 backdrop-blur-2xl flex items-center justify-center z-50 p-4"
          onClick={() => {
            setShowDNSModal(false);
            setDnsChallenge(null);
            setDnsError(null);
            setSelectedDomainForDNS(null);
            setDnsPropagated(false);
          }}
        >
          <div
            className="card-modal max-w-3xl w-full max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-xl font-light text-white mb-2 tracking-tight">
              DNS-01 Challenge
            </h2>
            <p className="text-xs text-white/50 mb-5 font-light">
              Create a DNS TXT record to verify domain ownership
            </p>

            {dnsError && (
              <div className="bg-[#EF4444]/10 backdrop-blur-lg border border-[#EF4444]/20 rounded-xl p-4 mb-5">
                <p className="text-xs text-[#F87171]">{dnsError}</p>
              </div>
            )}

            {dnsChallenge ? (
              <>
                {/* Instructions Card */}
                <div className="bg-[#06B6D4]/10 backdrop-blur-lg border border-[#06B6D4]/20 rounded-xl p-5 mb-5">
                  <div className="flex items-start gap-3 mb-4">
                    <div className="w-10 h-10 rounded-lg bg-[#06B6D4]/10 border border-[#06B6D4]/30 flex items-center justify-center flex-shrink-0">
                      <Shield className="w-5 h-5 text-[#22D3EE]" strokeWidth={1.5} />
                    </div>
                    <div className="flex-1">
                      <p className="text-sm font-medium text-[#22D3EE] mb-1">
                        DNS Configuration Required
                      </p>
                      <p className="text-xs text-white/70 font-light leading-relaxed">
                        Follow these steps to complete certificate issuance:
                      </p>
                    </div>
                  </div>

                  <ol className="space-y-3 ml-13">
                    {dnsChallenge.instructions?.map((instruction, index) => (
                      <li key={index} className="text-xs text-white/70 font-light leading-relaxed">
                        {instruction}
                      </li>
                    ))}
                  </ol>
                </div>

                {/* DNS Record Details */}
                <div className="space-y-4 mb-5">
                  <div>
                    <label className="block text-xs font-medium text-white/60 uppercase tracking-[0.15em] mb-2">
                      TXT Record Name
                    </label>
                    <div className="bg-white/[0.02] border border-white/[0.08] rounded-lg px-4 py-3 flex items-center justify-between">
                      <code className="text-xs text-white/90 font-mono">
                        {dnsChallenge.txtRecord}
                      </code>
                      <button
                        onClick={() => navigator.clipboard.writeText(dnsChallenge.txtRecord)}
                        className="text-[#C77DFF] hover:text-[#9D4EDD] text-xs ml-3 transition-colors duration-300"
                      >
                        Copy
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-white/60 uppercase tracking-[0.15em] mb-2">
                      TXT Record Value
                    </label>
                    <div className="bg-white/[0.02] border border-white/[0.08] rounded-lg px-4 py-3 flex items-center justify-between">
                      <code className="text-xs text-white/90 font-mono break-all">
                        {dnsChallenge.txtValue}
                      </code>
                      <button
                        onClick={() => navigator.clipboard.writeText(dnsChallenge.txtValue)}
                        className="text-[#C77DFF] hover:text-[#9D4EDD] text-xs ml-3 flex-shrink-0 transition-colors duration-300"
                      >
                        Copy
                      </button>
                    </div>
                  </div>
                </div>

                {/* Propagation Status */}
                {dnsPropagated && (
                  <div className="bg-[#10B981]/10 backdrop-blur-lg border border-[#10B981]/20 rounded-xl p-4 mb-5">
                    <div className="flex items-center gap-2">
                      <CheckCircle className="w-4 h-4 text-[#34D399]" strokeWidth={1.5} />
                      <p className="text-xs text-[#34D399] font-medium">
                        DNS record found! Ready to validate.
                      </p>
                    </div>
                  </div>
                )}

                {/* Actions */}
                <div className="flex gap-3">
                  <button
                    onClick={() => {
                      setShowDNSModal(false);
                      setDnsChallenge(null);
                      setDnsError(null);
                      setDnsPropagated(false);
                    }}
                    className="bg-white/[0.02] hover:bg-white/[0.05] border border-white/[0.08] hover:border-[#9D4EDD]/30 text-white/90 hover:text-[#C77DFF] rounded-lg px-6 py-3.5 font-light text-sm transition-all duration-500 ease-out active:scale-[0.98] flex-1"
                    disabled={dnsValidating || dnsCheckingPropagation}
                  >
                    Cancel
                  </button>

                  <button
                    onClick={handleCheckDNSPropagation}
                    className="bg-white/[0.02] hover:bg-white/[0.05] border border-white/[0.08] hover:border-[#9D4EDD]/30 text-white/90 hover:text-[#C77DFF] rounded-lg px-6 py-3.5 font-light text-sm transition-all duration-500 ease-out active:scale-[0.98] flex-1 flex items-center justify-center gap-2"
                    disabled={dnsCheckingPropagation || dnsValidating}
                  >
                    {dnsCheckingPropagation ? (
                      <>
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" strokeWidth={1.5} />
                        Checking...
                      </>
                    ) : (
                      <>
                        <RefreshCw className="w-3.5 h-3.5" strokeWidth={1.5} />
                        Check DNS
                      </>
                    )}
                  </button>

                  <button
                    onClick={handleValidateDNS}
                    className="bg-gradient-to-r from-[#9D4EDD] to-[#7B2CBF] text-white font-medium text-sm tracking-wide hover:from-[#C77DFF] hover:to-[#9D4EDD] active:scale-[0.98] disabled:opacity-30 disabled:cursor-not-allowed rounded-lg px-6 py-4  hover: transition-all duration-500 ease-out flex-1 flex items-center justify-center gap-2"
                    disabled={dnsValidating || dnsCheckingPropagation}
                  >
                    {dnsValidating ? (
                      <>
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" strokeWidth={1.5} />
                        Validating...
                      </>
                    ) : (
                      <>
                        <CheckCircle className="w-3.5 h-3.5" strokeWidth={1.5} />
                        Validate & Complete
                      </>
                    )}
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
