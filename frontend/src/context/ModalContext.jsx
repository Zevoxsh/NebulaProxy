import { createContext, useContext, useState, useCallback } from 'react';
import { AlertTriangle, Info, AlertCircle } from 'lucide-react';

const ModalContext = createContext(null);

export function ModalProvider({ children }) {
  const [modal, setModal] = useState(null);

  const confirm = useCallback((message, {
    title = 'Confirmation',
    confirmLabel = 'Confirmer',
    cancelLabel = 'Annuler',
    danger = false,
  } = {}) => new Promise(resolve => {
    setModal({ type: 'confirm', message, title, confirmLabel, cancelLabel, danger, resolve });
  }), []);

  const showAlert = useCallback((message, {
    title = 'Information',
    label = 'OK',
    danger = false,
  } = {}) => new Promise(resolve => {
    setModal({ type: 'alert', message, title, label, danger, resolve });
  }), []);

  const close = useCallback((result) => {
    setModal(prev => { prev?.resolve(result); return null; });
  }, []);

  const Icon = modal?.danger ? AlertTriangle : (modal?.type === 'alert' ? AlertCircle : Info);
  const iconColor = modal?.danger ? 'text-red-400' : 'text-white/50';
  const iconBg = modal?.danger ? 'bg-red-500/10 border border-red-500/20' : 'bg-white/[0.05] border border-white/[0.08]';

  return (
    <ModalContext.Provider value={{ confirm, alert: showAlert }}>
      {children}

      {modal && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
          <div
            className="fixed inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => close(false)}
          />
          <div className="relative bg-[#111113] border border-[#27272a] rounded-xl shadow-2xl w-full max-w-sm animate-scale-in">
            <div className="p-6">
              <div className="flex items-start gap-4 mb-5">
                <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${iconBg}`}>
                  <Icon className={`w-4 h-4 ${iconColor}`} strokeWidth={1.5} />
                </div>
                <div className="flex-1 min-w-0 pt-0.5">
                  <p className="text-sm font-semibold text-white mb-1">{modal.title}</p>
                  <p className="text-sm text-white/50 leading-relaxed">{modal.message}</p>
                </div>
              </div>

              <div className="flex gap-2 justify-end">
                {modal.type === 'confirm' && (
                  <button
                    className="btn-secondary text-sm px-4 py-2"
                    onClick={() => close(false)}
                  >
                    {modal.cancelLabel}
                  </button>
                )}
                <button
                  className={`text-sm px-4 py-2 rounded-lg font-medium transition-colors ${
                    modal.danger
                      ? 'bg-red-500/15 hover:bg-red-500/25 text-red-400 border border-red-500/30'
                      : 'btn-primary'
                  }`}
                  onClick={() => close(modal.type === 'confirm' ? true : undefined)}
                  autoFocus
                >
                  {modal.type === 'confirm' ? modal.confirmLabel : modal.label}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </ModalContext.Provider>
  );
}

export const useModal = () => {
  const ctx = useContext(ModalContext);
  if (!ctx) throw new Error('useModal must be used inside ModalProvider');
  return ctx;
};
