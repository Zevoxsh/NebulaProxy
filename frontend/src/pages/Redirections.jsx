import { useState, useEffect } from 'react';
import { Plus, AlertCircle, Loader2, Search, Users, X, Copy, ExternalLink, BarChart3, Power, CheckCircle, Link as LinkIcon } from 'lucide-react';
import { redirectionAPI } from '../api/client';
import { useAuthStore } from '../store/authStore';
import { PaginationControls } from '@/components/ui/pagination-controls';

export default function Redirections() {
  const [redirections, setRedirections] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editingRedirection, setEditingRedirection] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');
  const [formData, setFormData] = useState({
    shortCode: '',
    targetUrl: '',
    description: '',
    teamId: null
  });
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;

  const user = useAuthStore((state) => state.user);
  const baseUrl = import.meta.env.VITE_REDIRECT_BASE_URL || window.location.origin;

  useEffect(() => {
    fetchRedirections();
  }, []);

  const fetchRedirections = async () => {
    try {
      setLoading(true);
      setError('');
      const response = await redirectionAPI.list();
      setRedirections(response.data.redirections);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to load redirections');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      setSubmitting(true);
      setError('');

      const payload = {
        targetUrl: formData.targetUrl.trim(),
        description: formData.description.trim() || undefined
      };

      if (formData.shortCode.trim()) {
        payload.shortCode = formData.shortCode.trim();
      }

      if (formData.teamId) {
        payload.teamId = parseInt(formData.teamId);
      }

      if (editingRedirection) {
        const response = await redirectionAPI.update(editingRedirection.id, payload);
        setRedirections(redirections.map(r =>
          r.id === editingRedirection.id ? response.data.redirection : r
        ));
        setSuccess('Redirection updated successfully');
      } else {
        const response = await redirectionAPI.create(payload);
        setRedirections([response.data.redirection, ...redirections]);
        setSuccess(`Redirection created! URL: ${baseUrl}/r/${response.data.redirection.short_code}`);
      }

      setShowForm(false);
      setEditingRedirection(null);
      setFormData({ shortCode: '', targetUrl: '', description: '', teamId: null });
      setTimeout(() => setSuccess(''), 5000);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to save redirection');
    } finally {
      setSubmitting(false);
    }
  };

  const handleEdit = (redirection) => {
    setEditingRedirection(redirection);
    setFormData({
      shortCode: redirection.short_code,
      targetUrl: redirection.target_url,
      description: redirection.description || '',
      teamId: redirection.team_id || null
    });
    setShowForm(true);
  };

  const handleDelete = async (id) => {
    if (!confirm('Are you sure you want to delete this redirection?')) return;

    try {
      await redirectionAPI.delete(id);
      setRedirections(redirections.filter(r => r.id !== id));
      setSuccess('Redirection deleted successfully');
      setTimeout(() => setSuccess(''), 3000);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to delete redirection');
    }
  };

  const handleToggle = async (id) => {
    try {
      const response = await redirectionAPI.toggle(id);
      setRedirections(redirections.map(r =>
        r.id === id ? response.data.redirection : r
      ));
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to toggle redirection');
    }
  };

  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text);
    setSuccess('Copied to clipboard!');
    setTimeout(() => setSuccess(''), 2000);
  };

  const filteredRedirections = redirections.filter(r => {
    const matchesSearch = r.short_code.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         r.target_url.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         (r.description && r.description.toLowerCase().includes(searchTerm.toLowerCase()));
    const matchesStatus = filterStatus === 'all' ||
                         (filterStatus === 'active' && r.is_active) ||
                         (filterStatus === 'inactive' && !r.is_active);
    return matchesSearch && matchesStatus;
  });
  const totalPages = Math.max(1, Math.ceil(filteredRedirections.length / itemsPerPage));
  const startIndex = (currentPage - 1) * itemsPerPage;
  const paginatedRedirections = filteredRedirections.slice(startIndex, startIndex + itemsPerPage);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, filterStatus]);

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, totalPages]);

  return (
    <>
      {/* Page Header */}
      <div className="page-header">
        <div className="page-header-inner">
          {/* Title */}
          <div className="animate-fade-in">
            <h1 className="text-xl md:text-2xl font-light text-white mb-2 tracking-tight">Redirections</h1>
            <p className="text-xs text-white/50 font-light tracking-wide">Manage your short URL redirections</p>
          </div>

          {/* Actions */}
          <div className="flex flex-col sm:flex-row gap-2.5 mt-4 animate-fade-in" style={{ animationDelay: '0.1s' }}>
            <button
              onClick={() => {
                setEditingRedirection(null);
                setFormData({ shortCode: '', targetUrl: '', description: '', teamId: null });
                setShowForm(true);
              }}
              className="btn-primary flex items-center justify-center gap-2 text-xs px-4 py-2.5"
            >
              <Plus className="w-4 h-4" strokeWidth={1.5} />
              New Redirection
            </button>
          </div>

          {/* Filters */}
          <div className="flex flex-col md:flex-row md:items-center gap-3 mt-4 animate-fade-in" style={{ animationDelay: '0.2s' }}>
            {/* Search */}
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30" strokeWidth={1.5} />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Search redirections..."
                className="input-futuristic pl-10 text-xs w-full"
              />
            </div>

            {/* Status Filter */}
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs uppercase tracking-[0.2em] text-white/40">Status</span>
              <button
                onClick={() => setFilterStatus('all')}
                className={filterStatus === 'all' ? 'btn-primary px-4 text-xs' : 'btn-secondary px-4 text-xs'}
              >
                All
              </button>
              <button
                onClick={() => setFilterStatus('active')}
                className={filterStatus === 'active' ? 'btn-primary px-4 text-xs' : 'btn-secondary px-4 text-xs'}
              >
                Active
              </button>
              <button
                onClick={() => setFilterStatus('inactive')}
                className={filterStatus === 'inactive' ? 'btn-primary px-4 text-xs' : 'btn-secondary px-4 text-xs'}
              >
                Inactive
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="page-body">
        {/* Success Message */}
        {success && (
          <div className="fixed top-20 left-1/2 transform -translate-x-1/2 z-[200] w-full max-w-md mx-auto px-4 animate-fade-in">
            <div className="bg-[#10B981]/10 backdrop-blur-2xl border border-[#10B981]/20 rounded-xl p-4 flex items-start gap-3 ">
              <CheckCircle className="w-4 h-4 text-[#34D399] mt-0.5 flex-shrink-0" strokeWidth={1.5} />
              <p className="text-xs text-[#34D399] font-light">{success}</p>
              <button onClick={() => setSuccess('')} className="ml-auto text-[#34D399]/50 hover:text-[#34D399] transition-colors">
                <X className="w-3.5 h-3.5" strokeWidth={1.5} />
              </button>
            </div>
          </div>
        )}

        {/* Error Message */}
        {error && (
          <div className="fixed top-20 left-1/2 transform -translate-x-1/2 z-[200] w-full max-w-md mx-auto px-4 animate-fade-in">
            <div className="bg-[#EF4444]/10 backdrop-blur-2xl border border-[#EF4444]/20 rounded-xl p-4 flex items-start gap-3 ">
              <AlertCircle className="w-4 h-4 text-[#F87171] mt-0.5 flex-shrink-0" strokeWidth={1.5} />
              <p className="text-xs text-[#F87171] font-light">{error}</p>
              <button onClick={() => setError('')} className="ml-auto text-[#F87171]/50 hover:text-[#F87171] transition-colors">
                <X className="w-3.5 h-3.5" strokeWidth={1.5} />
              </button>
            </div>
          </div>
        )}

        {/* Form Modal */}
        {showForm && (
          <div
            className="fixed inset-0 bg-[#0B0C0F]/80 backdrop-blur-2xl flex items-center justify-center z-[250] p-4"
            onClick={() => !submitting && setShowForm(false)}
          >
            <div
              className="card-modal max-w-2xl w-full"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-start justify-between mb-5">
                <div>
                  <h2 className="text-lg font-light text-white mb-2 tracking-tight">
                    {editingRedirection ? 'Edit Redirection' : 'Create New Redirection'}
                  </h2>
                  <p className="text-xs text-white/50 font-light">
                    {editingRedirection ? 'Update your redirection settings' : 'Create a new short URL redirection'}
                  </p>
                </div>
                <button
                  onClick={() => setShowForm(false)}
                  className="text-white/50 hover:text-white transition-colors"
                  disabled={submitting}
                >
                  <X className="w-5 h-5" strokeWidth={1.5} />
                </button>
              </div>

              <form onSubmit={handleSubmit} className="space-y-5">
                {user?.role === 'admin' && (
                  <div>
                    <label className="text-xs font-medium text-white/50 uppercase tracking-[0.15em] mb-2 block">
                      Custom Short Code (optional - admin only)
                    </label>
                    <input
                      type="text"
                      value={formData.shortCode}
                      onChange={(e) => setFormData({ ...formData, shortCode: e.target.value })}
                      className="input-futuristic text-xs"
                      placeholder="custom-code"
                      pattern="[a-zA-Z0-9_-]*"
                      disabled={submitting}
                    />
                    <p className="text-xs text-white/30 mt-1.5 font-light">Leave empty for auto-generation. Only letters, numbers, underscores, and hyphens.</p>
                  </div>
                )}

                <div>
                  <label className="text-xs font-medium text-white/50 uppercase tracking-[0.15em] mb-2 block">
                    Target URL <span className="text-[#F87171]">*</span>
                  </label>
                  <input
                    type="url"
                    value={formData.targetUrl}
                    onChange={(e) => setFormData({ ...formData, targetUrl: e.target.value })}
                    className="input-futuristic text-xs"
                    placeholder="https://example.com"
                    required
                    disabled={submitting}
                  />
                </div>

                <div>
                  <label className="text-xs font-medium text-white/50 uppercase tracking-[0.15em] mb-2 block">
                    Description (optional)
                  </label>
                  <input
                    type="text"
                    value={formData.description}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    className="input-futuristic text-xs"
                    placeholder="Link to my website"
                    disabled={submitting}
                  />
                </div>

                <div className="flex gap-3 pt-4">
                  <button
                    type="button"
                    onClick={() => setShowForm(false)}
                    className="btn-secondary flex-1 text-xs px-4 py-2.5"
                    disabled={submitting}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="btn-primary flex-1 text-xs px-4 py-2.5 flex items-center justify-center gap-2"
                    disabled={submitting}
                  >
                    {submitting ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" strokeWidth={1.5} />
                        {editingRedirection ? 'Updating...' : 'Creating...'}
                      </>
                    ) : (
                      editingRedirection ? 'Update Redirection' : 'Create Redirection'
                    )}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Redirections Grid */}
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="flex flex-col items-center gap-3">
              <Loader2 className="w-8 h-8 text-admin-text animate-spin" strokeWidth={1.5} />
              <p className="text-xs text-white/40 font-light tracking-wide">Loading redirections...</p>
            </div>
          </div>
        ) : filteredRedirections.length === 0 ? (
          <div className="flex items-center justify-center py-20">
            <div className="text-center max-w-sm">
              <div className="w-12 h-12 rounded-xl bg-admin-surface2 border border-admin-border flex items-center justify-center mx-auto mb-4">
                <LinkIcon className="w-6 h-6 text-admin-text" strokeWidth={1.5} />
              </div>
              <h3 className="text-sm font-medium text-white/90 mb-2">No redirections found</h3>
              <p className="text-xs text-white/40 font-light mb-6">
                {searchTerm || filterStatus !== 'all' ? 'Try adjusting your filters' : 'Create your first redirection to get started'}
              </p>
              {!searchTerm && filterStatus === 'all' && (
                <button
                  onClick={() => {
                    setEditingRedirection(null);
                    setFormData({ shortCode: '', targetUrl: '', description: '', teamId: null });
                    setShowForm(true);
                  }}
                  className="btn-primary text-xs px-4 py-2.5 inline-flex items-center gap-2"
                >
                  <Plus className="w-4 h-4" strokeWidth={1.5} />
                  Create Redirection
                </button>
              )}
            </div>
          </div>
        ) : (
          <div className="grid gap-4">
            {paginatedRedirections.map((redirection, index) => (
              <div
                key={redirection.id}
                className="bg-[#1A1B28]/40 backdrop-blur-xl border border-white/[0.08] rounded-xl p-4 hover:border-admin-border transition-all duration-500 animate-fade-in"
                 style={{ animationDelay: `${index * 0.05}s` }}
              >
                <div className="flex items-start gap-3 mb-3">
                  <div className="w-10 h-10 rounded-lg bg-admin-surface2 border border-admin-border flex items-center justify-center flex-shrink-0">
                    <LinkIcon className="w-5 h-5 text-admin-text" strokeWidth={1.5} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start gap-2 mb-1">
                      <code className="text-sm text-admin-text font-mono break-all">/r/{redirection.short_code}</code>
                      <button
                        onClick={() => copyToClipboard(`${baseUrl}/r/${redirection.short_code}`)}
                        className="text-white/40 hover:text-white/90 transition-colors flex-shrink-0"
                        title="Copy URL"
                      >
                        <Copy className="w-3.5 h-3.5" strokeWidth={1.5} />
                      </button>
                      <a
                        href={`/r/${redirection.short_code}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-white/40 hover:text-white/90 transition-colors flex-shrink-0"
                        title="Open in new tab"
                      >
                        <ExternalLink className="w-3.5 h-3.5" strokeWidth={1.5} />
                      </a>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={redirection.is_active ? 'badge-success' : 'badge-purple'}>
                        <div className={`w-1.5 h-1.5 rounded-full ${redirection.is_active ? 'bg-[#34D399]' : 'bg-white/40'}`} />
                        {redirection.is_active ? 'Active' : 'Inactive'}
                      </span>
                      <span className="badge-success flex items-center gap-1.5">
                        <BarChart3 className="w-3 h-3" strokeWidth={1.5} />
                        {redirection.click_count || 0} clicks
                      </span>
                      {redirection.ownership_type === 'team' && redirection.team_name && (
                        <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-admin-surface2 text-admin-text rounded-full text-xs font-medium tracking-wide border border-admin-border">
                          <Users className="w-3 h-3" strokeWidth={1.5} />
                          {redirection.team_name}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="mb-3">
                  <p className="text-xs text-white/60 font-light uppercase tracking-wider mb-0.5">Target</p>
                  <a
                    href={redirection.target_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-white/60 hover:text-white/90 font-mono break-all transition-colors"
                  >
                    {redirection.target_url}
                  </a>
                </div>

                {redirection.description && (
                  <div className="mb-3">
                    <p className="text-xs text-white/60 font-light uppercase tracking-wider mb-0.5">Description</p>
                    <p className="text-xs text-white/50 font-light">{redirection.description}</p>
                  </div>
                )}

                <div className="flex items-center gap-2 mt-3 pt-3 border-t border-white/[0.05]">
                  <button
                    onClick={() => handleEdit(redirection)}
                    className="btn-secondary text-xs px-3 py-1.5 flex-1"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => handleToggle(redirection.id)}
                    className="btn-secondary text-xs px-3 py-1.5 flex-1"
                  >
                    {redirection.is_active ? 'Disable' : 'Enable'}
                  </button>
                  <button
                    onClick={() => handleDelete(redirection.id)}
                    className="text-xs px-3 py-1.5 text-[#F87171] hover:bg-[#EF4444]/10 rounded-lg transition-all"
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
            <PaginationControls
              currentPage={currentPage}
              totalPages={totalPages}
              totalItems={filteredRedirections.length}
              pageSize={itemsPerPage}
              onPageChange={setCurrentPage}
              label="redirections"
            />
          </div>
        )}
      </div>
    </>
  );
}
