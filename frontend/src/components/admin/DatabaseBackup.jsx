import React, { useState } from 'react';
import { AlertCircle, Download, Upload, Loader } from 'lucide-react';

/**
 * Database Backup Export/Import Component
 * Allows admins to export and import the entire database
 */
export default function DatabaseBackup() {
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState(null);
  const [error, setError] = useState(null);
  const [fileInput, setFileInput] = useState(null);

  const handleExport = async () => {
    try {
      setLoading(true);
      setError(null);
      setMessage(null);

      const response = await fetch('/api/admin/backups/export-json', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });

      if (!response.ok) {
        throw new Error(`Export failed: ${response.statusText}`);
      }

      const data = await response.json();
      
      // Create blob and download
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `nebula_backup_${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      setMessage('✅ Database exported successfully!');
    } catch (err) {
      setError(`Export failed: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleImport = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      setLoading(true);
      setError(null);
      setMessage(null);

      const fileContent = await file.text();
      const backupData = JSON.parse(fileContent);

      // Confirm before importing
      if (!window.confirm(`⚠️ This will replace ALL data in the database with the backup from "${file.name}". This cannot be undone!\n\nAre you absolutely sure?`)) {
        return;
      }

      const response = await fetch('/api/admin/backups/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          backupData: backupData,
          format: 'json'
        })
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.message || 'Import failed');
      }

      setMessage('✅ Database imported successfully! The page will reload...');
      setTimeout(() => window.location.reload(), 2000);
    } catch (err) {
      setError(`Import failed: ${err.message}`);
    } finally {
      setLoading(false);
      setFileInput(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* Export Section */}
      <div className="bg-slate-900 rounded-lg border border-slate-800 p-6">
        <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
          <Download className="w-5 h-5 text-blue-400" />
          Export Database
        </h3>
        <p className="text-slate-300 text-sm mb-4">
          Download a complete backup of your database as JSON. You can use this to restore your data later.
        </p>
        <button
          onClick={handleExport}
          disabled={loading}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-600 text-white rounded-lg transition flex items-center gap-2"
        >
          {loading ? (
            <>
              <Loader className="w-4 h-4 animate-spin" />
              Exporting...
            </>
          ) : (
            <>
              <Download className="w-4 h-4" />
              Download Backup
            </>
          )}
        </button>
      </div>

      {/* Import Section */}
      <div className="bg-slate-900 rounded-lg border border-slate-800 p-6">
        <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
          <Upload className="w-5 h-5 text-orange-400" />
          Import Database
        </h3>
        <p className="text-slate-300 text-sm mb-4">
          Restore a previously exported database backup. <strong>Warning:</strong> This will completely replace all current data.
        </p>
        <div className="mb-4">
          <input
            ref={(el) => setFileInput(el)}
            type="file"
            accept=".json"
            onChange={handleImport}
            disabled={loading}
            className="hidden"
          />
          <button
            onClick={() => fileInput?.click()}
            disabled={loading}
            className="px-4 py-2 bg-orange-600 hover:bg-orange-700 disabled:bg-slate-600 text-white rounded-lg transition flex items-center gap-2"
          >
            {loading ? (
              <>
                <Loader className="w-4 h-4 animate-spin" />
                Importing...
              </>
            ) : (
              <>
                <Upload className="w-4 h-4" />
                Choose Backup File
              </>
            )}
          </button>
        </div>
      </div>

      {/* Messages */}
      {message && (
        <div className="bg-green-900/30 border border-green-600 text-green-200 p-4 rounded-lg">
          {message}
        </div>
      )}

      {error && (
        <div className="bg-red-900/30 border border-red-600 text-red-200 p-4 rounded-lg flex gap-2">
          <AlertCircle className="w-5 h-5 flex-shrink-0" />
          <div>{error}</div>
        </div>
      )}

      {/* Warning */}
      <div className="bg-yellow-900/30 border border-yellow-600 text-yellow-200 p-4 rounded-lg flex gap-2">
        <AlertCircle className="w-5 h-5 flex-shrink-0" />
        <div>
          <strong>Important:</strong> Keep regular backups! The import function will completely replace your database data.
        </div>
      </div>
    </div>
  );
}
