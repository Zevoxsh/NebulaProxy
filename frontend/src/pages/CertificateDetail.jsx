import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Download, Upload, RefreshCw, Shield, Calendar, Key, FileText, AlertCircle, CheckCircle, Info, Lock, Copy, Trash2 } from 'lucide-react';
import { sslAPI, domainAPI } from '../api/client';

export default function CertificateDetail() {
  const { domainId } = useParams();
  const navigate = useNavigate();

  const [domain, setDomain] = useState(null);
  const [certificate, setCertificate] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [certContent, setCertContent] = useState(null);
  const [keyContent, setKeyContent] = useState(null);
  const [fullChainContent, setFullChainContent] = useState(null);
  const [loadingContent, setLoadingContent] = useState(false);

  // Upload states
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadData, setUploadData] = useState({
    fullChain: '',
    privateKey: ''
  });
  const [uploadError, setUploadError] = useState('');

  // Renewing state
  const [renewing, setRenewing] = useState(false);

  useEffect(() => {
    fetchCertificateDetails();
  }, [domainId]);

  const fetchCertificateDetails = async () => {
    try {
      setLoading(true);
      setError('');

      const [domainResponse, certResponse] = await Promise.all([
        domainAPI.get(domainId),
        sslAPI.getCertificateDetails(domainId)
      ]);

      setDomain(domainResponse.data.domain);
      setCertificate(certResponse.data.certificate);

      // Load certificate content
      if (certResponse.data.certificate) {
        loadCertificateContent();
      }
    } catch (err) {
      console.error('Error fetching certificate details:', err);
      setError(err.response?.data?.message || 'Failed to load certificate details');
    } finally {
      setLoading(false);
    }
  };

  const loadCertificateContent = async () => {
    try {
      setLoadingContent(true);
      // Note: Private key is not loaded for security reasons
      const [certResp, fullChainResp] = await Promise.all([
        sslAPI.downloadCertificatePart(domainId, 'certificate').catch(() => ({ data: null })),
        sslAPI.downloadCertificatePart(domainId, 'fullchain').catch(() => ({ data: null }))
      ]);

      setCertContent(certResp.data);
      setFullChainContent(fullChainResp.data);
    } catch (err) {
      console.error('Error loading certificate content:', err);
    } finally {
      setLoadingContent(false);
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
      await sslAPI.upload({
        domainId,
        fullChain: uploadData.fullChain,
        privateKey: uploadData.privateKey
      });

      setSuccess('Certificate uploaded successfully');
      setShowUploadModal(false);
      setUploadData({ fullChain: '', privateKey: '' });
      await fetchCertificateDetails();

      setTimeout(() => setSuccess(''), 5000);
    } catch (err) {
      console.error('Error uploading certificate:', err);
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
    } catch (err) {
      setError(`Failed to download ${type}`);
      setTimeout(() => setError(''), 3000);
    }
  };

  const handleRenew = async () => {
    if (!confirm('Are you sure you want to renew this certificate?')) {
      return;
    }

    setRenewing(true);
    setError('');

    try {
      await sslAPI.renew(domainId);
      setSuccess('Certificate renewal initiated');
      await fetchCertificateDetails();
      setTimeout(() => setSuccess(''), 5000);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to renew certificate');
      setTimeout(() => setError(''), 5000);
    } finally {
      setRenewing(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm(`Are you sure you want to delete the certificate for ${domain?.hostname}? This action cannot be undone.`)) {
      return;
    }

    try {
      await sslAPI.deleteCertificate(domainId);
      setSuccess('Certificate deleted successfully');
      setTimeout(() => {
        navigate('/ssl-certificates');
      }, 2000);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to delete certificate');
      setTimeout(() => setError(''), 5000);
    }
  };

  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text);
    setSuccess('Copied to clipboard');
    setTimeout(() => setSuccess(''), 2000);
  };

  const getDaysUntilExpiry = () => {
    if (!certificate?.expiresAt) return null;
    const now = new Date();
    const expiry = new Date(certificate.expiresAt);
    const diff = expiry - now;
    return Math.ceil(diff / (1000 * 60 * 60 * 24));
  };

  const getStatusColor = () => {
    const days = getDaysUntilExpiry();
    if (!days) return 'text-white/40';
    if (days > 30) return 'text-[#34D399]';
    if (days > 0) return 'text-[#FBBF24]';
    return 'text-[#F87171]';
  };

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <RefreshCw className="w-8 h-8 text-[#C77DFF] animate-spin" strokeWidth={1.5} />
      </div>
    );
  }

  if (error && !domain) {
    return (
      <div className="flex-1 flex items-center justify-center p-4">
        <div className="bg-[#EF4444]/10 border border-[#EF4444]/20 rounded-xl p-6 max-w-md">
          <AlertCircle className="w-12 h-12 text-[#F87171] mx-auto mb-4" strokeWidth={1.5} />
          <p className="text-sm text-[#F87171] text-center">{error}</p>
          <button onClick={() => navigate('/ssl-certificates')} className="btn-secondary w-full mt-4">
            Go Back
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="page-shell">
      <div className="page-header">
        <div className="page-header-inner">
          {/* Header */}
          <div className="flex items-center gap-4">
            <button
              onClick={() => navigate('/ssl-certificates')}
              className="w-10 h-10 rounded-lg bg-white/[0.02] hover:bg-white/[0.05] border border-white/[0.08] flex items-center justify-center transition-all duration-300"
            >
              <ArrowLeft className="w-5 h-5 text-white/70" strokeWidth={1.5} />
            </button>
            <div className="flex-1">
              <h1 className="text-xl md:text-2xl font-light text-white mb-1 tracking-tight">SSL Certificate</h1>
              <p className="text-xs text-white/50 font-light tracking-wide">{domain?.hostname}</p>
            </div>
          </div>
        </div>
      </div>

      <div className="page-body">

        {/* Success/Error Messages */}
        {success && (
          <div className="mb-4 bg-[#10B981]/10 border border-[#10B981]/20 rounded-xl p-4 flex items-center gap-3 animate-fade-in">
            <CheckCircle className="w-5 h-5 text-[#34D399]" strokeWidth={1.5} />
            <p className="text-sm text-[#34D399]">{success}</p>
          </div>
        )}

        {error && (
          <div className="mb-4 bg-[#EF4444]/10 border border-[#EF4444]/20 rounded-xl p-4 flex items-center gap-3 animate-fade-in">
            <AlertCircle className="w-5 h-5 text-[#F87171]" strokeWidth={1.5} />
            <p className="text-sm text-[#F87171]">{error}</p>
          </div>
        )}

        {certificate ? (
          <div className="space-y-4">
            {/* Certificate Status Card */}
            <div className="bg-[#161722]/50 backdrop-blur-2xl border border-white/[0.08] rounded-xl p-5">
              <div className="flex items-start justify-between mb-5">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-[#9D4EDD]/10 to-[#9D4EDD]/5 border border-[#9D4EDD]/20 flex items-center justify-center">
                    <Shield className="w-6 h-6 text-[#C77DFF]" strokeWidth={1.5} />
                  </div>
                  <div>
                    <h2 className="text-base font-light text-white mb-1">Certificate Status</h2>
                    <p className={`text-sm font-medium ${getStatusColor()}`}>
                      {getDaysUntilExpiry() !== null
                        ? getDaysUntilExpiry() > 0
                          ? `Valid for ${getDaysUntilExpiry()} days`
                          : 'Expired'
                        : 'Unknown'}
                    </p>
                  </div>
                </div>
                <div className="flex gap-2">
                  {certificate.type === 'auto' && (
                    <button
                      onClick={handleRenew}
                      disabled={renewing}
                      className="btn-secondary flex items-center gap-2"
                    >
                      {renewing ? (
                        <RefreshCw className="w-4 h-4 animate-spin" strokeWidth={1.5} />
                      ) : (
                        <RefreshCw className="w-4 h-4" strokeWidth={1.5} />
                      )}
                      Renew
                    </button>
                  )}
                  <button onClick={() => setShowUploadModal(true)} className="btn-primary flex items-center gap-2">
                    <Upload className="w-4 h-4" strokeWidth={1.5} />
                    Upload New
                  </button>
                </div>
              </div>

              {/* Certificate Info Grid */}
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
                  <p className="text-sm text-white/90 font-light">
                    {certificate.expiresAt ? new Date(certificate.expiresAt).toLocaleDateString('en-US', {
                      year: 'numeric',
                      month: 'long',
                      day: 'numeric'
                    }) : 'Unknown'}
                  </p>
                </div>

                <div className="bg-white/[0.02] border border-white/[0.06] rounded-lg p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <Calendar className="w-4 h-4 text-[#C77DFF]" strokeWidth={1.5} />
                    <p className="text-xs font-medium text-white/50 uppercase tracking-wider">Issued</p>
                  </div>
                  <p className="text-sm text-white/90 font-light">
                    {certificate.issuedAt ? new Date(certificate.issuedAt).toLocaleDateString('en-US', {
                      year: 'numeric',
                      month: 'long',
                      day: 'numeric'
                    }) : 'Unknown'}
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

            {/* Certificate Details */}
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
                      <p className="text-xs font-medium text-white/50 uppercase tracking-wider mb-2 flex items-center justify-between">
                        Serial Number
                        <button
                          onClick={() => copyToClipboard(certificate.details.serialNumber)}
                          className="text-[#C77DFF] hover:text-[#9D4EDD] transition-colors"
                        >
                          <Copy className="w-3.5 h-3.5" strokeWidth={1.5} />
                        </button>
                      </p>
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
                        {certificate.details.subjectAltNames.split(',').map((san, index) => (
                          <span key={index} className="px-3 py-1.5 bg-[#9D4EDD]/15 text-[#C77DFF] rounded-full text-xs font-medium border border-[#9D4EDD]/30">
                            {san.trim()}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Download Actions */}
            <div className="bg-[#161722]/50 backdrop-blur-2xl border border-white/[0.08] rounded-xl p-5">
              <h2 className="text-base font-light text-white mb-4">Download Certificate Files</h2>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <button
                  onClick={() => handleDownload('certificate')}
                  className="bg-white/[0.02] hover:bg-white/[0.05] border border-white/[0.08] hover:border-[#9D4EDD]/30 text-white/90 hover:text-[#C77DFF] rounded-lg px-4 py-3 font-light text-sm transition-all duration-300 flex items-center justify-center gap-2"
                >
                  <Download className="w-4 h-4" strokeWidth={1.5} />
                  Certificate
                </button>
                <button
                  onClick={() => handleDownload('fullchain')}
                  className="bg-white/[0.02] hover:bg-white/[0.05] border border-white/[0.08] hover:border-[#9D4EDD]/30 text-white/90 hover:text-[#C77DFF] rounded-lg px-4 py-3 font-light text-sm transition-all duration-300 flex items-center justify-center gap-2"
                >
                  <Lock className="w-4 h-4" strokeWidth={1.5} />
                  Full Chain
                </button>
              </div>

              {/* Certificate Content Display */}
              {loadingContent ? (
                <div className="mt-6 flex items-center justify-center py-8">
                  <RefreshCw className="w-6 h-6 text-[#C77DFF] animate-spin" strokeWidth={1.5} />
                </div>
              ) : (
                <div className="mt-6 space-y-4">
                  {/* Full Chain */}
                  {fullChainContent && (
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <label className="text-xs font-medium text-white/50 uppercase tracking-wider">Full Chain Certificate</label>
                        <button
                          onClick={() => copyToClipboard(fullChainContent)}
                          className="text-[#C77DFF] hover:text-[#9D4EDD] transition-colors flex items-center gap-1 text-xs"
                        >
                          <Copy className="w-3.5 h-3.5" strokeWidth={1.5} />
                          Copy
                        </button>
                      </div>
                      <pre className="bg-white/[0.02] border border-white/[0.06] rounded-lg p-4 text-xs text-white/80 font-mono font-light overflow-x-auto max-h-64 overflow-y-auto">
                        {fullChainContent}
                      </pre>
                    </div>
                  )}

                  {/* Certificate */}
                  {certContent && (
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <label className="text-xs font-medium text-white/50 uppercase tracking-wider">Certificate</label>
                        <button
                          onClick={() => copyToClipboard(certContent)}
                          className="text-[#C77DFF] hover:text-[#9D4EDD] transition-colors flex items-center gap-1 text-xs"
                        >
                          <Copy className="w-3.5 h-3.5" strokeWidth={1.5} />
                          Copy
                        </button>
                      </div>
                      <pre className="bg-white/[0.02] border border-white/[0.06] rounded-lg p-4 text-xs text-white/80 font-mono font-light overflow-x-auto max-h-64 overflow-y-auto">
                        {certContent}
                      </pre>
                    </div>
                  )}

                  {/* Private Key - Hidden for security */}
                  <div className="bg-[#F59E0B]/5 border border-[#F59E0B]/20 rounded-lg p-4">
                    <div className="flex items-start gap-3">
                      <AlertCircle className="w-5 h-5 text-[#FBBF24] flex-shrink-0 mt-0.5" strokeWidth={1.5} />
                      <div>
                        <h3 className="text-sm font-medium text-[#FBBF24] mb-1">Private Key</h3>
                        <p className="text-xs text-white/60 font-light">
                          For security reasons, the private key is not displayed. You can download it using the button above if needed.
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Danger Zone */}
            <div className="bg-[#EF4444]/5 border border-[#EF4444]/20 rounded-xl p-5">
              <h2 className="text-base font-light text-[#F87171] mb-2">Danger Zone</h2>
              <p className="text-sm text-white/70 font-light mb-4">
                Deleting this certificate will remove all associated files and cannot be undone.
              </p>
              <button
                onClick={handleDelete}
                className="bg-[#EF4444]/10 hover:bg-[#EF4444]/20 border border-[#EF4444]/30 hover:border-[#EF4444]/50 text-[#F87171] rounded-lg px-4 py-2.5 font-light text-sm transition-all duration-300 flex items-center gap-2"
              >
                <Trash2 className="w-4 h-4" strokeWidth={1.5} />
                Delete Certificate
              </button>
            </div>
          </div>
        ) : (
          /* No Certificate */
          <div className="bg-[#161722]/50 backdrop-blur-2xl border border-white/[0.08] rounded-xl p-8 text-center">
            <div className="w-16 h-16 rounded-full bg-white/[0.02] border border-white/[0.08] flex items-center justify-center mx-auto mb-4">
              <Shield className="w-8 h-8 text-white/40" strokeWidth={1.5} />
            </div>
            <h2 className="text-lg font-light text-white mb-2">No Certificate Found</h2>
            <p className="text-sm text-white/50 font-light mb-6 max-w-md mx-auto">
              This domain doesn't have an SSL certificate yet. You can upload a custom certificate or request one from Let's Encrypt.
            </p>
            <button onClick={() => setShowUploadModal(true)} className="btn-primary">
              <Upload className="w-4 h-4" strokeWidth={1.5} />
              Upload Certificate
            </button>
          </div>
        )}

        {/* Upload Modal */}
        {showUploadModal && (
          <div
            className="fixed inset-0 bg-[#0B0C0F]/80 backdrop-blur-2xl flex items-center justify-center z-[250] p-4"
            onClick={() => setShowUploadModal(false)}
          >
            <div
              className="bg-[#161722]/95 backdrop-blur-2xl border border-white/[0.08] rounded-xl max-w-2xl w-full p-6 shadow-lg max-h-[90vh] overflow-y-auto"
              onClick={(e) => e.stopPropagation()}
            >
              <h2 className="text-xl font-light text-white mb-6 tracking-tight">Upload Custom Certificate</h2>

              {uploadError && (
                <div className="bg-[#EF4444]/10 border border-[#EF4444]/20 rounded-xl p-4 mb-4 flex items-start gap-3">
                  <AlertCircle className="w-5 h-5 text-[#F87171] flex-shrink-0 mt-0.5" strokeWidth={1.5} />
                  <p className="text-sm text-[#F87171]">{uploadError}</p>
                </div>
              )}

              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-white/60 uppercase tracking-wider mb-2">
                    Full Chain (fullchain.pem) *
                  </label>
                  <p className="text-xs text-white/40 mb-2 font-light">
                    Inclure le certificat principal suivi des certificats intermédiaires (si disponibles)
                  </p>
                  <textarea
                    value={uploadData.fullChain}
                    onChange={(e) => setUploadData({ ...uploadData, fullChain: e.target.value })}
                    placeholder="-----BEGIN CERTIFICATE-----&#10;... (site cert) ...&#10;-----END CERTIFICATE-----\n-----BEGIN CERTIFICATE-----&#10;... (intermediate) ...&#10;-----END CERTIFICATE-----"
                    className="w-full h-36 bg-white/[0.02] border border-white/[0.08] rounded-lg px-4 py-3 text-white/95 placeholder-white/30 font-mono text-xs font-light focus:outline-none focus:border-[#9D4EDD]/50 focus:ring-2 focus:ring-[#9D4EDD]/10 transition-all duration-300 resize-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-white/60 uppercase tracking-wider mb-2">
                    Private Key (key.pem) *
                  </label>
                  <p className="text-xs text-white/40 mb-2 font-light">
                    La clé privée correspondante (à garder secret)
                  </p>
                  <textarea
                    value={uploadData.privateKey}
                    onChange={(e) => setUploadData({ ...uploadData, privateKey: e.target.value })}
                    placeholder="-----BEGIN PRIVATE KEY-----&#10;...&#10;-----END PRIVATE KEY-----"
                    className="w-full h-32 bg-white/[0.02] border border-white/[0.08] rounded-lg px-4 py-3 text-white/95 placeholder-white/30 font-mono text-xs font-light focus:outline-none focus:border-[#9D4EDD]/50 focus:ring-2 focus:ring-[#9D4EDD]/10 transition-all duration-300 resize-none"
                  />
                </div>

                <div className="bg-[#06B6D4]/10 border border-[#06B6D4]/20 rounded-lg p-4">
                  <div className="flex items-start gap-2">
                    <Shield className="w-4 h-4 text-[#22D3EE] flex-shrink-0 mt-0.5" strokeWidth={1.5} />
                    <div>
                      <p className="text-xs text-[#22D3EE] font-medium mb-1">Validation automatique</p>
                      <ul className="text-xs text-white/70 font-light space-y-1">
                        <li>✓ Format PEM valide</li>
                        <li>✓ Certificat correspond au domaine <span className="font-medium text-[#22D3EE]">{domain?.hostname}</span></li>
                        <li>✓ Certificat non expiré</li>
                        <li>✓ Clé privée correspond au certificat</li>
                      </ul>
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex gap-3 mt-6">
                <button
                  onClick={() => setShowUploadModal(false)}
                  disabled={uploading}
                  className="flex-1 bg-white/[0.02] hover:bg-white/[0.05] border border-white/[0.08] hover:border-[#9D4EDD]/30 text-white/90 hover:text-[#C77DFF] rounded-lg px-6 py-3.5 font-light text-sm transition-all duration-300 active:scale-[0.98]"
                >
                  Cancel
                </button>
                <button
                  onClick={handleUpload}
                  disabled={uploading}
                  className="flex-1 bg-gradient-to-r from-[#9D4EDD] to-[#7B2CBF] text-white font-medium text-sm hover:from-[#C77DFF] hover:to-[#9D4EDD] active:scale-[0.98] disabled:opacity-30 disabled:cursor-not-allowed rounded-lg px-6 py-4  hover: transition-all duration-300 flex items-center justify-center gap-2"
                >
                  {uploading ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" strokeWidth={1.5} />
                      Uploading...
                    </>
                  ) : (
                    <>
                      <Upload className="w-4 h-4" strokeWidth={1.5} />
                      Upload Certificate
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
