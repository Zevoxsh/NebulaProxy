import { useState, useEffect } from 'react';
import { Shield, Edit, Trash2, Power, AlertCircle, Play } from 'lucide-react';
import { adminAPI, domainAPI } from '../../api/client';
import {
  AdminCard,
  AdminCardHeader,
  AdminCardTitle,
  AdminCardContent,
  AdminButton,
  AdminBadge,
  AdminAlert,
  AdminAlertDescription
} from '@/components/admin';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Combobox } from '@/components/ui/combobox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import { PaginationControls } from '@/components/ui/pagination-controls';

export default function UrlBlockingRules({ clientMode = false }) {
  const patternTypeOptions = [
    { value: 'exact', label: 'Exact - Exact match' },
    { value: 'prefix', label: 'Prefix - Starts with' },
    { value: 'wildcard', label: 'Wildcard - * and ?' },
    { value: 'regex', label: 'Regex - Full regex' },
    { value: 'ip', label: 'IP - Exact client IP' },
    { value: 'cidr', label: 'CIDR - Client IP subnet' },
  ];

  const actionOptions = [
    { value: 'block', label: 'Block - Deny access' },
    { value: 'allow', label: 'Allow - Explicitly allow' },
  ];

  const patternTypeSimpleOptions = [
    { value: 'exact', label: 'Exact' },
    { value: 'prefix', label: 'Prefix' },
    { value: 'wildcard', label: 'Wildcard' },
    { value: 'regex', label: 'Regex' },
    { value: 'ip', label: 'IP' },
    { value: 'cidr', label: 'CIDR' },
  ];
  const [domains, setDomains] = useState([]);
  const [selectedDomain, setSelectedDomain] = useState('');
  const [rules, setRules] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [showTestModal, setShowTestModal] = useState(false);
  const [editingRule, setEditingRule] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const { toast } = useToast();

  const [ruleForm, setRuleForm] = useState({
    pattern: '',
    pattern_type: 'exact',
    action: 'block',
    priority: 100,
    response_code: 403,
    response_message: '',
    allowed_ips: '',
    description: '',
    is_active: true
  });

  const [testForm, setTestForm] = useState({
    pattern: '',
    pattern_type: 'exact',
    test_paths: ''
  });

  const [testResults, setTestResults] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;

  const getDomainName = (domain) =>
    [domain?.hostname, domain?.domain_name, domain?.domain, domain?.name]
      .find((value) => typeof value === 'string' && value.trim().length > 0)
      || `Domain #${domain?.id}`;

  const getDomainLabel = (domain) => {
    const base = getDomainName(domain);
    const owner = domain?.owner_username || domain?.username || '';
    return owner ? `${base} (${owner})` : base;
  };

  const parseAllowedIps = (value) =>
    value
      .split(/[\n,]/)
      .map((entry) => entry.trim())
      .filter(Boolean);

  const getAllowedIpsPreview = (allowedIps) => {
    if (Array.isArray(allowedIps)) {
      if (allowedIps.length === 0) return '';
      return allowedIps.length === 1 ? allowedIps[0] : `${allowedIps[0]}...`;
    }

    if (typeof allowedIps === 'string') {
      const entries = parseAllowedIps(allowedIps);
      if (entries.length === 0) return '';
      return entries.length === 1 ? entries[0] : `${entries[0]}...`;
    }

    return '';
  };

  useEffect(() => {
    fetchDomains();
  }, []);

  useEffect(() => {
    if (selectedDomain) {
      fetchRules();
    }
  }, [selectedDomain]);

  const fetchDomains = async () => {
    try {
      setLoading(true);
      setError('');
      const response = clientMode
        ? await domainAPI.list()
        : await adminAPI.getAllDomains();
      const activeDomains = (response.data.domains || [])
        .filter(d => d.is_active)
        .sort((a, b) => getDomainLabel(a).localeCompare(getDomainLabel(b)));
      setDomains(activeDomains);

      if (activeDomains.length === 0) {
        setSelectedDomain('');
        return;
      }

      if (!selectedDomain) {
        setSelectedDomain(activeDomains[0].id.toString());
        return;
      }

      const stillExists = activeDomains.some(d => d.id.toString() === selectedDomain);
      if (!stillExists) {
        setSelectedDomain(activeDomains[0].id.toString());
      }
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to load domains');
    } finally {
      setLoading(false);
    }
  };

  const fetchRules = async () => {
    if (!selectedDomain) return;
    try {
      setLoading(true);
      setError('');
      const response = await adminAPI.getUrlBlockingRules(selectedDomain);
      setRules(response.data.rules || []);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to load blocking rules');
    } finally {
      setLoading(false);
    }
  };

  const openCreateModal = () => {
    setEditingRule(null);
    setRuleForm({
      pattern: '',
      pattern_type: 'exact',
      action: 'block',
      priority: 100,
      response_code: 403,
      response_message: '',
      allowed_ips: '',
      description: '',
      is_active: true
    });
    setShowModal(true);
  };

  const openEditModal = (rule) => {
    setEditingRule(rule);
    setRuleForm({
      pattern: rule.pattern,
      pattern_type: rule.pattern_type,
      action: rule.action,
      priority: rule.priority,
      response_code: rule.response_code || 403,
      response_message: rule.response_message || '',
      allowed_ips: Array.isArray(rule.allowed_ips) ? rule.allowed_ips.join('\n') : (rule.allowed_ips || ''),
      description: rule.description || '',
      is_active: rule.is_active
    });
    setShowModal(true);
  };

  const closeModal = () => {
    setShowModal(false);
    setEditingRule(null);
    setError('');
  };

  const handleSubmitRule = async (e) => {
    e.preventDefault();
    try {
      setSubmitting(true);
      setError('');
      const payload = {
        ...ruleForm,
        allowed_ips: parseAllowedIps(ruleForm.allowed_ips)
      };

      if (editingRule) {
        await adminAPI.updateUrlBlockingRule(editingRule.id, payload);
        toast({
          title: 'Rule Updated',
          description: 'Blocking rule updated successfully'
        });
      } else {
        await adminAPI.createUrlBlockingRule(selectedDomain, payload);
        toast({
          title: 'Rule Created',
          description: 'Blocking rule created successfully'
        });
      }

      await fetchRules();
      closeModal();
    } catch (err) {
      const errorMsg = err.response?.data?.message || 'Failed to save rule';
      setError(errorMsg);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: errorMsg
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteRule = async (rule) => {
    const confirmed = window.confirm(`Delete blocking rule for pattern "${rule.pattern}"?`);
    if (!confirmed) return;

    try {
      await adminAPI.deleteUrlBlockingRule(rule.id);
      toast({
        title: 'Rule Deleted',
        description: 'Blocking rule deleted successfully'
      });
      await fetchRules();
    } catch (err) {
      const errorMsg = err.response?.data?.message || 'Failed to delete rule';
      setError(errorMsg);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: errorMsg
      });
    }
  };

  const handleToggleRule = async (rule) => {
    try {
      await adminAPI.updateUrlBlockingRule(rule.id, { is_active: !rule.is_active });
      setRules(rules.map(r =>
        r.id === rule.id ? { ...r, is_active: !r.is_active } : r
      ));
      toast({
        title: 'Rule Updated',
        description: `Rule ${rule.is_active ? 'disabled' : 'enabled'} successfully`
      });
    } catch (err) {
      const errorMsg = err.response?.data?.message || 'Failed to toggle rule';
      setError(errorMsg);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: errorMsg
      });
    }
  };

  const handleTestPattern = async (e) => {
    e.preventDefault();
    try {
      setSubmitting(true);
      setError('');

      const paths = testForm.test_paths.split('\n').filter(p => p.trim());
      const response = await adminAPI.testUrlPattern(
        testForm.pattern,
        testForm.pattern_type,
        paths
      );

      setTestResults(response.data);
      toast({
        title: 'Test Complete',
        description: `Tested ${paths.length} path(s)`
      });
    } catch (err) {
      const errorMsg = err.response?.data?.message || 'Failed to test pattern';
      setError(errorMsg);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: errorMsg
      });
    } finally {
      setSubmitting(false);
    }
  };

  const getActionBadge = (action) => {
    if (clientMode) {
      return action === 'block'
        ? <span className="badge-warning">Block</span>
        : <span className="badge-success">Allow</span>;
    }
    return action === 'block' ? (
      <AdminBadge variant="danger">Block</AdminBadge>
    ) : (
      <AdminBadge variant="success">Allow</AdminBadge>
    );
  };

  const getPatternTypeBadge = (type) => {
    if (clientMode) {
      return <span className="badge-purple uppercase">{type}</span>;
    }
    const variants = {
      exact: 'default',
      prefix: 'default',
      wildcard: 'warning',
      regex: 'danger'
    };
    return <AdminBadge variant={variants[type] || 'default'}>{type}</AdminBadge>;
  };

  const selectedDomainObj = domains.find((d) => d.id.toString() === selectedDomain);
  const selectedDomainLabel = selectedDomainObj ? getDomainLabel(selectedDomainObj) : '';
  const totalPages = Math.max(1, Math.ceil(rules.length / itemsPerPage));
  const startIndex = (currentPage - 1) * itemsPerPage;
  const paginatedRules = rules.slice(startIndex, startIndex + itemsPerPage);
  const domainOptions = domains.length > 0
    ? domains.map((domain) => ({ value: domain.id.toString(), label: getDomainLabel(domain) }))
    : [];
  const pageRootClass = clientMode ? 'page-shell' : 'space-y-6';
  const titleClass = clientMode ? 'text-xl md:text-2xl font-light tracking-tight text-white mb-2' : 'text-3xl font-semibold text-admin-text mb-2';
  const descriptionClass = clientMode ? 'text-white/60 text-sm' : 'text-admin-text-muted';

  useEffect(() => {
    setCurrentPage(1);
  }, [selectedDomain]);

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, totalPages]);

  if (loading && domains.length === 0) {
    return (
      <div className="space-y-6" data-admin-theme={!clientMode ? true : undefined}>
        <div className="mb-6">
          <Skeleton className="h-8 w-48 bg-admin-border mb-2" />
          <Skeleton className="h-4 w-96 bg-admin-border" />
        </div>
        <Skeleton className="h-96 bg-admin-border" />
      </div>
    );
  }

  return (
    <div data-admin-theme={!clientMode ? true : undefined} className={pageRootClass}>
      {clientMode ? (
        <div className="page-header">
          <div className="page-header-inner">
            <div className="mb-4 animate-fade-in flex items-center justify-between gap-4 flex-wrap">
              <div>
                <h1 className={titleClass}>My URL Blocking Rules</h1>
                <p className={descriptionClass}>Manage your own domain URL filtering rules</p>
              </div>
              {selectedDomain && (
                <div className="flex gap-2">
                  <button onClick={() => setShowTestModal(true)} className="btn-secondary flex items-center gap-2 text-xs px-4">
                    <Play className="w-4 h-4" strokeWidth={1.5} />
                    Test Pattern
                  </button>
                  <button onClick={openCreateModal} className="btn-primary flex items-center gap-2">
                    <Shield className="w-4 h-4" strokeWidth={1.5} />
                    Add Rule
                  </button>
                </div>
              )}
            </div>
            <div className="flex flex-col md:flex-row gap-3 animate-fade-in" style={{ animationDelay: '0.1s' }}>
              <div className="flex gap-2 flex-wrap md:flex-nowrap w-full">
                <div className="min-w-[300px] w-full md:w-auto">
                  <Combobox
                    value={selectedDomain}
                    onValueChange={setSelectedDomain}
                    options={domainOptions}
                    placeholder={`Select domain (${domains.length})`}
                    searchPlaceholder="Search domain..."
                    emptyText="No domain found"
                    triggerClassName="h-10 text-xs bg-admin-bg border-admin-border text-admin-text"
                    contentClassName="max-h-80"
                  />
                </div>
              </div>
            </div>
            {selectedDomainLabel && (
              <p className="mt-2 text-xs text-white/50 font-light tracking-wide animate-fade-in" style={{ animationDelay: '0.12s' }}>
                Selected: {selectedDomainLabel}
              </p>
            )}
          </div>
        </div>
      ) : (
        <>
          <div className="flex items-start justify-between gap-4 mb-2">
            <div>
              <h1 className={titleClass}>URL Blocking Rules</h1>
              <p className={descriptionClass}>Manage URL pattern-based access control</p>
            </div>
          </div>
          <AdminCard>
            <AdminCardContent className="pt-6">
              <div className="flex flex-col xl:flex-row xl:items-end xl:justify-between gap-4">
                <div className="grid grid-cols-1 w-full xl:max-w-lg gap-3">
                  <div className="space-y-2">
                    <Label className="text-admin-text-muted text-xs uppercase tracking-wide">Active Domain</Label>
                    <Combobox
                      value={selectedDomain}
                      onValueChange={setSelectedDomain}
                      options={domainOptions}
                      placeholder={`Select domain (${domains.length})`}
                      searchPlaceholder="Search domain..."
                      emptyText="No domain found"
                      triggerClassName="h-10 bg-admin-bg border-admin-border text-admin-text"
                      contentClassName="max-h-80"
                    />
                  </div>
                </div>
                {selectedDomain && (
                  <div className="flex items-center gap-2 self-start xl:self-end">
                    <AdminButton onClick={() => setShowTestModal(true)} variant="secondary">
                      <Play className="w-4 h-4 mr-2" />
                      Test Pattern
                    </AdminButton>
                    <AdminButton onClick={openCreateModal}>
                      <Shield className="w-4 h-4 mr-2" />
                      Add Rule
                    </AdminButton>
                  </div>
                )}
              </div>
              {selectedDomainLabel && (
                <div className="mt-3 text-xs text-admin-text-muted">
                  Selected: <span className="text-admin-text font-medium">{selectedDomainLabel}</span>
                </div>
              )}
            </AdminCardContent>
          </AdminCard>
        </>
      )}

      <div className={clientMode ? 'page-body space-y-4' : 'space-y-4'}>
        {error && (
          clientMode ? (
            <div className="bg-[#EF4444]/10 border border-[#EF4444]/20 rounded-xl p-3 flex items-center gap-2 text-[#FCA5A5] text-xs">
              <AlertCircle className="h-4 w-4" />
              <span>{error}</span>
            </div>
          ) : (
            <AdminAlert variant="danger">
              <AlertCircle className="h-4 w-4" />
              <AdminAlertDescription>{error}</AdminAlertDescription>
            </AdminAlert>
          )
        )}

        {selectedDomain && (
          clientMode ? (
            <div className="bg-[#161722]/50 backdrop-blur-2xl border border-white/[0.08] rounded-xl p-3">
              <p className="text-xs text-white/60 font-light">
                Domain: <span className="font-medium text-white">{selectedDomainObj ? getDomainLabel(selectedDomainObj) : selectedDomain}</span>. Rules are evaluated by priority (highest first).
              </p>
            </div>
          ) : (
            <AdminAlert>
              <Shield className="h-4 w-4" />
              <AdminAlertDescription>
                Domain: <span className="font-semibold">{selectedDomainObj ? getDomainLabel(selectedDomainObj) : selectedDomain}</span>. URL blocking rules are evaluated by priority (highest first).
              </AdminAlertDescription>
            </AdminAlert>
          )
        )}

        {selectedDomain && (
          clientMode ? (
            <div className="bg-[#161722]/50 backdrop-blur-2xl border border-white/[0.08] rounded-xl overflow-hidden animate-fade-in" style={{ animationDelay: '0.2s' }}>
              <div className="px-4 py-3 border-b border-white/[0.08]">
                <h3 className="text-base font-medium text-white tracking-tight">Blocking Rules ({rules.length})</h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-white/[0.08]">
                      <th className="text-left text-xs uppercase tracking-wider text-white/60 font-medium px-3 py-2">Priority</th>
                      <th className="text-left text-xs uppercase tracking-wider text-white/60 font-medium px-3 py-2">Pattern</th>
                      <th className="text-left text-xs uppercase tracking-wider text-white/60 font-medium px-3 py-2">Type</th>
                      <th className="text-left text-xs uppercase tracking-wider text-white/60 font-medium px-3 py-2">Action</th>
                      <th className="text-left text-xs uppercase tracking-wider text-white/60 font-medium px-3 py-2">Status</th>
                      <th className="text-left text-xs uppercase tracking-wider text-white/60 font-medium px-3 py-2">Response</th>
                      <th className="text-left text-xs uppercase tracking-wider text-white/60 font-medium px-3 py-2">IP Access</th>
                      <th className="text-left text-xs uppercase tracking-wider text-white/60 font-medium px-3 py-2">Description</th>
                      <th className="text-left text-xs uppercase tracking-wider text-white/60 font-medium px-3 py-2">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rules.length === 0 ? (
                      <tr>
                        <td colSpan={9} className="px-3 py-12 text-center text-white/40 text-sm">
                          No blocking rules configured
                        </td>
                      </tr>
                    ) : (
                      paginatedRules.map((rule) => (
                        <tr key={rule.id} className="border-b border-white/[0.05] last:border-0 hover:bg-white/[0.02] transition-all">
                          <td className="px-3 py-2 text-xs text-white">{rule.priority}</td>
                          <td className="px-3 py-2">
                            <code className="text-xs text-white/85 font-mono bg-white/[0.05] px-2 py-1 rounded">{rule.pattern}</code>
                          </td>
                          <td className="px-3 py-2">{getPatternTypeBadge(rule.pattern_type)}</td>
                          <td className="px-3 py-2">{getActionBadge(rule.action)}</td>
                          <td className="px-3 py-2">
                            {rule.is_active ? <span className="badge-success">Active</span> : <span className="badge-purple">Off</span>}
                          </td>
                          <td className="px-3 py-2 text-xs text-white/70">
                            {rule.action === 'block' && rule.response_code ? <span className="font-mono">{rule.response_code}</span> : <span className="text-white/30">-</span>}
                          </td>
                          <td className="px-3 py-2 text-xs text-white/70">
                            {getAllowedIpsPreview(rule.allowed_ips) ? <span className="font-mono">{getAllowedIpsPreview(rule.allowed_ips)}</span> : <span className="text-white/30">All</span>}
                          </td>
                          <td className="px-3 py-2 text-xs text-white/55 max-w-[220px] truncate">{rule.description || '-'}</td>
                          <td className="px-3 py-2">
                            <div className="flex items-center gap-1.5">
                              <button onClick={() => openEditModal(rule)} className="btn-secondary p-2" title="Edit Rule">
                                <Edit className="w-3.5 h-3.5" />
                              </button>
                              <button onClick={() => handleToggleRule(rule)} className="btn-secondary p-2" title={rule.is_active ? 'Disable' : 'Enable'}>
                                <Power className="w-3.5 h-3.5" />
                              </button>
                              <button onClick={() => handleDeleteRule(rule)} className="p-2 rounded-lg text-[#F87171] hover:bg-[#EF4444]/10 transition-colors" title="Delete Rule">
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
              <div className="px-4 pb-4">
                <PaginationControls
                  currentPage={currentPage}
                  totalPages={totalPages}
                  totalItems={rules.length}
                  pageSize={itemsPerPage}
                  onPageChange={setCurrentPage}
                  label="rules"
                />
              </div>
            </div>
          ) : (
            <AdminCard>
              <AdminCardHeader>
                <AdminCardTitle>Blocking Rules ({rules.length})</AdminCardTitle>
              </AdminCardHeader>
              <AdminCardContent className="pt-0">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-admin-surface2 border-admin-border hover:bg-admin-surface2">
                      <TableHead className="text-admin-text font-semibold">Priority</TableHead>
                      <TableHead className="text-admin-text font-semibold">Pattern</TableHead>
                      <TableHead className="text-admin-text font-semibold">Type</TableHead>
                      <TableHead className="text-admin-text font-semibold">Action</TableHead>
                      <TableHead className="text-admin-text font-semibold">Status</TableHead>
                      <TableHead className="text-admin-text font-semibold">Response</TableHead>
                      <TableHead className="text-admin-text font-semibold">IP Access</TableHead>
                      <TableHead className="text-admin-text font-semibold">Description</TableHead>
                      <TableHead className="text-admin-text font-semibold">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rules.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={9} className="text-center text-admin-text-muted py-12">
                          No blocking rules configured
                        </TableCell>
                      </TableRow>
                    ) : (
                      paginatedRules.map((rule) => (
                        <TableRow key={rule.id} className="border-admin-border bg-admin-surface hover:bg-admin-surface2">
                          <TableCell className="text-admin-text font-medium">{rule.priority}</TableCell>
                          <TableCell>
                            <code className="text-admin-primary text-sm bg-admin-bg px-2 py-1 rounded">{rule.pattern}</code>
                          </TableCell>
                          <TableCell>{getPatternTypeBadge(rule.pattern_type)}</TableCell>
                          <TableCell>{getActionBadge(rule.action)}</TableCell>
                          <TableCell>
                            {rule.is_active ? <AdminBadge variant="success">Active</AdminBadge> : <AdminBadge variant="danger">Disabled</AdminBadge>}
                          </TableCell>
                          <TableCell className="text-admin-text text-sm">
                            {rule.action === 'block' && rule.response_code ? <span className="font-mono">{rule.response_code}</span> : <span className="text-admin-text-muted">-</span>}
                          </TableCell>
                          <TableCell className="text-admin-text text-sm">
                            {getAllowedIpsPreview(rule.allowed_ips) ? <span className="font-mono text-xs">{getAllowedIpsPreview(rule.allowed_ips)}</span> : <span className="text-admin-text-muted">All</span>}
                          </TableCell>
                          <TableCell className="text-admin-text-muted text-sm max-w-xs truncate">{rule.description || '-'}</TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <AdminButton variant="ghost" size="icon" onClick={() => openEditModal(rule)} title="Edit Rule">
                                <Edit className="w-4 h-4" />
                              </AdminButton>
                              <AdminButton
                                variant="ghost"
                                size="icon"
                                onClick={() => handleToggleRule(rule)}
                                title={rule.is_active ? 'Disable' : 'Enable'}
                                className={rule.is_active ? 'text-admin-success' : 'text-admin-text-muted'}
                              >
                                <Power className="w-4 h-4" />
                              </AdminButton>
                              <AdminButton
                                variant="ghost"
                                size="icon"
                                onClick={() => handleDeleteRule(rule)}
                                title="Delete Rule"
                                className="text-admin-danger hover:text-admin-danger"
                              >
                                <Trash2 className="w-4 h-4" />
                              </AdminButton>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
                <PaginationControls
                  currentPage={currentPage}
                  totalPages={totalPages}
                  totalItems={rules.length}
                  pageSize={itemsPerPage}
                  onPageChange={setCurrentPage}
                  label="rules"
                />
              </AdminCardContent>
            </AdminCard>
          )
        )}
      </div>

      {/* Create/Edit Modal */}
      <Dialog open={showModal} onOpenChange={(open) => !open && closeModal()}>
        <DialogContent className="bg-[#111113] border-admin-border max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-admin-text">
              {editingRule ? 'Edit Blocking Rule' : 'Create Blocking Rule'}
            </DialogTitle>
            <DialogDescription className="text-admin-text-muted">
              Configure URL pattern matching and access control
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmitRule}>
            <div className="space-y-4 py-4">
              {/* Pattern */}
              <div className="space-y-2">
                <Label className="text-admin-text">Pattern *</Label>
                <Input
                  type="text"
                  value={ruleForm.pattern}
                  onChange={(e) => setRuleForm({ ...ruleForm, pattern: e.target.value })}
                  className="bg-admin-bg border-admin-border text-admin-text font-mono"
                  placeholder={
                    ruleForm.pattern_type === 'ip'
                      ? '203.0.113.10'
                      : ruleForm.pattern_type === 'cidr'
                      ? '203.0.113.0/24'
                      : '/admin, /api/*, /user/\\d+'
                  }
                  required
                />
                <p className="text-xs text-admin-text-muted">
                  {ruleForm.pattern_type === 'ip'
                    ? 'Single client IP to match (TCP/UDP/Minecraft access control)'
                    : ruleForm.pattern_type === 'cidr'
                    ? 'IP subnet in CIDR format (e.g. 203.0.113.0/24)'
                    : 'URL path pattern to match (e.g., /admin, /api/*, /user/\\d+)'}
                </p>
              </div>

              {/* Pattern Type & Action */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label className="text-admin-text">Pattern Type *</Label>
                  <Combobox
                    value={ruleForm.pattern_type}
                    onValueChange={(value) => setRuleForm({ ...ruleForm, pattern_type: value })}
                    options={patternTypeOptions}
                    placeholder="Select pattern type"
                    searchPlaceholder="Search pattern type..."
                    emptyText="No pattern type found."
                    triggerClassName="h-10 bg-admin-bg border-admin-border text-admin-text"
                  />
                </div>

                <div className="space-y-2">
                  <Label className="text-admin-text">Action *</Label>
                  <Combobox
                    value={ruleForm.action}
                    onValueChange={(value) => setRuleForm({ ...ruleForm, action: value })}
                    options={actionOptions}
                    placeholder="Select action"
                    searchPlaceholder="Search action..."
                    emptyText="No action found."
                    triggerClassName="h-10 bg-admin-bg border-admin-border text-admin-text"
                  />
                </div>
              </div>

              {/* Priority */}
              <div className="space-y-2">
                <Label className="text-admin-text">Priority</Label>
                <Input
                  type="number"
                  value={ruleForm.priority}
                  onChange={(e) => setRuleForm({ ...ruleForm, priority: parseInt(e.target.value) })}
                  className="bg-admin-bg border-admin-border text-admin-text"
                  min="0"
                  max="1000"
                />
                <p className="text-xs text-admin-text-muted">
                  Higher priority rules are evaluated first
                </p>
              </div>

              {/* Response Code (only for block action) */}
              {ruleForm.action === 'block' && ruleForm.pattern_type !== 'ip' && ruleForm.pattern_type !== 'cidr' && (
                <div className="space-y-2">
                  <Label className="text-admin-text">Response Code</Label>
                  <Input
                    type="number"
                    value={ruleForm.response_code}
                    onChange={(e) => setRuleForm({ ...ruleForm, response_code: parseInt(e.target.value) })}
                    className="bg-admin-bg border-admin-border text-admin-text"
                    min="400"
                    max="599"
                  />
                  <p className="text-xs text-admin-text-muted">
                    HTTP status code to return (default: 403)
                  </p>
                </div>
              )}

              {/* Response Message (only for block action) */}
              {ruleForm.action === 'block' && ruleForm.pattern_type !== 'ip' && ruleForm.pattern_type !== 'cidr' && (
                <div className="space-y-2">
                  <Label className="text-admin-text">Response Message</Label>
                  <Textarea
                    value={ruleForm.response_message}
                    onChange={(e) => setRuleForm({ ...ruleForm, response_message: e.target.value })}
                    className="bg-admin-bg border-admin-border text-admin-text"
                    rows={2}
                    placeholder="Custom message to display (optional)"
                  />
                </div>
              )}

              {/* Allowed IPs */}
              <div className="space-y-2">
                <Label className="text-admin-text">Allowed IPs (optional)</Label>
                <Textarea
                  value={ruleForm.allowed_ips}
                  onChange={(e) => setRuleForm({ ...ruleForm, allowed_ips: e.target.value })}
                  className="bg-admin-bg border-admin-border text-admin-text font-mono text-sm"
                  rows={3}
                  placeholder="192.168.1.10, 10.0.0.0/24"
                  disabled={ruleForm.pattern_type === 'ip' || ruleForm.pattern_type === 'cidr'}
                />
                <p className="text-xs text-admin-text-muted">
                  {ruleForm.pattern_type === 'ip' || ruleForm.pattern_type === 'cidr'
                    ? 'Not used for IP/CIDR rules. Use Action + Pattern directly.'
                    : 'Only these IPs/CIDR ranges can access the matched URLs (comma or new line separated).'}
                </p>
              </div>

              {/* Description */}
              <div className="space-y-2">
                <Label className="text-admin-text">Description</Label>
                <Textarea
                  value={ruleForm.description}
                  onChange={(e) => setRuleForm({ ...ruleForm, description: e.target.value })}
                  className="bg-admin-bg border-admin-border text-admin-text"
                  rows={2}
                  placeholder="Optional description for this rule"
                />
              </div>

              {/* Active Toggle */}
              <div className="flex items-center justify-between p-4 bg-admin-bg rounded-lg border border-admin-border">
                <div>
                  <div className="text-sm font-medium text-admin-text">Rule is active</div>
                  <div className="text-xs text-admin-text-muted">Enable or disable this blocking rule</div>
                </div>
                <Checkbox
                  id="rule-active"
                  checked={ruleForm.is_active}
                  onCheckedChange={(checked) => setRuleForm({ ...ruleForm, is_active: checked === true })}
                  className="border-admin-border data-[state=checked]:bg-admin-primary"
                />
              </div>
            </div>
            <DialogFooter>
              <AdminButton
                type="button"
                variant="secondary"
                onClick={closeModal}
                disabled={submitting}
              >
                Cancel
              </AdminButton>
              <AdminButton type="submit" disabled={submitting}>
                {submitting ? 'Saving...' : editingRule ? 'Update Rule' : 'Create Rule'}
              </AdminButton>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Test Pattern Modal */}
      <Dialog open={showTestModal} onOpenChange={(open) => !open && setShowTestModal(false)}>
        <DialogContent className="bg-[#111113] border-admin-border max-w-2xl">
          <DialogHeader>
            <DialogTitle className="text-admin-text">Test URL Pattern</DialogTitle>
            <DialogDescription className="text-admin-text-muted">
              Test how your pattern matches against different URLs
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleTestPattern}>
            <div className="space-y-4 py-4">
              {/* Pattern */}
              <div className="space-y-2">
                <Label className="text-admin-text">Pattern *</Label>
                <Input
                  type="text"
                  value={testForm.pattern}
                  onChange={(e) => setTestForm({ ...testForm, pattern: e.target.value })}
                  className="bg-admin-bg border-admin-border text-admin-text font-mono"
                  placeholder="/admin, /api/*, /user/\d+"
                  required
                />
              </div>

              {/* Pattern Type */}
              <div className="space-y-2">
                <Label className="text-admin-text">Pattern Type *</Label>
                <Combobox
                  value={testForm.pattern_type}
                  onValueChange={(value) => setTestForm({ ...testForm, pattern_type: value })}
                  options={patternTypeSimpleOptions}
                  placeholder="Select pattern type"
                  searchPlaceholder="Search pattern type..."
                  emptyText="No pattern type found."
                  triggerClassName="h-10 bg-admin-bg border-admin-border text-admin-text"
                />
              </div>

              {/* Test Paths */}
              <div className="space-y-2">
                <Label className="text-admin-text">
                  {testForm.pattern_type === 'ip' || testForm.pattern_type === 'cidr'
                    ? 'Test Client IPs (one per line) *'
                    : 'Test Paths (one per line) *'}
                </Label>
                <Textarea
                  value={testForm.test_paths}
                  onChange={(e) => setTestForm({ ...testForm, test_paths: e.target.value })}
                  className="bg-admin-bg border-admin-border text-admin-text font-mono text-sm"
                  rows={6}
                  placeholder={
                    testForm.pattern_type === 'ip' || testForm.pattern_type === 'cidr'
                      ? '203.0.113.10&#10;203.0.113.22&#10;198.51.100.5'
                      : '/admin&#10;/admin/users&#10;/sogo&#10;/api/public'
                  }
                  required
                />
              </div>

              {/* Test Results */}
              {testResults && (
                <div className="space-y-2">
                  <Label className="text-admin-text">Results</Label>
                  <div className="bg-admin-bg rounded-lg p-4 space-y-2 border border-admin-border">
                    {testResults.results.map((result, idx) => (
                      <div
                        key={idx}
                        className="flex items-center justify-between py-2 px-3 bg-admin-surface2 rounded"
                      >
                        <span className="font-mono text-sm text-admin-text">{result.path}</span>
                        <AdminBadge variant={result.matches ? 'success' : 'danger'}>
                          {result.matches ? 'Matches' : 'No Match'}
                        </AdminBadge>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <DialogFooter>
              <AdminButton
                type="button"
                variant="secondary"
                onClick={() => setShowTestModal(false)}
                disabled={submitting}
              >
                Close
              </AdminButton>
              <AdminButton type="submit" disabled={submitting}>
                <Play className="w-4 h-4 mr-2" />
                {submitting ? 'Testing...' : 'Test Pattern'}
              </AdminButton>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
