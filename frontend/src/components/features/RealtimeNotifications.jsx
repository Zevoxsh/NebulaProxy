import { useState, useEffect } from 'react';
import { Bell, X, AlertCircle, CheckCircle, Info, AlertTriangle } from 'lucide-react';
import { useWebSocket } from '../../hooks/useWebSocket';

export function RealtimeNotifications() {
  const [notifications, setNotifications] = useState([]);
  const [isOpen, setIsOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);

  const { isConnected, lastMessage } = useWebSocket('/ws/notifications', {
    onMessage: (data) => {
      if (data.type === 'notification') {
        addNotification(data.payload);
      }
    }
  });

  const addNotification = (notification) => {
    const newNotif = {
      id: Date.now(),
      ...notification,
      read: false,
      timestamp: new Date().toISOString()
    };

    setNotifications(prev => [newNotif, ...prev].slice(0, 50)); // Keep max 50
    setUnreadCount(prev => prev + 1);

    // Auto-dismiss after 5 seconds for info notifications
    if (notification.severity === 'info') {
      setTimeout(() => {
        dismissNotification(newNotif.id);
      }, 5000);
    }
  };

  const dismissNotification = (id) => {
    setNotifications(prev => prev.filter(n => n.id !== id));
  };

  const markAsRead = (id) => {
    setNotifications(prev =>
      prev.map(n => n.id === id ? { ...n, read: true } : n)
    );
    setUnreadCount(prev => Math.max(0, prev - 1));
  };

  const markAllAsRead = () => {
    setNotifications(prev => prev.map(n => ({ ...n, read: true })));
    setUnreadCount(0);
  };

  const getIcon = (severity) => {
    switch (severity) {
      case 'error':
        return <AlertCircle className="w-5 h-5 text-red-400" />;
      case 'warning':
        return <AlertTriangle className="w-5 h-5 text-yellow-400" />;
      case 'success':
        return <CheckCircle className="w-5 h-5 text-green-400" />;
      default:
        return <Info className="w-5 h-5 text-blue-400" />;
    }
  };

  const getSeverityColor = (severity) => {
    switch (severity) {
      case 'error':
        return 'bg-red-500/10 border-red-500/30';
      case 'warning':
        return 'bg-yellow-500/10 border-yellow-500/30';
      case 'success':
        return 'bg-green-500/10 border-green-500/30';
      default:
        return 'bg-blue-500/10 border-blue-500/30';
    }
  };

  return (
    <div className="relative">
      {/* Bell Icon */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="relative admin-icon-button"
      >
        <Bell className="w-5 h-5" />
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 text-white text-xs font-bold rounded-full flex items-center justify-center">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
        {isConnected && (
          <span className="absolute bottom-0 right-0 w-2 h-2 bg-green-500 rounded-full" />
        )}
      </button>

      {/* Dropdown */}
      {isOpen && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setIsOpen(false)}
          />
          <div className="absolute right-0 mt-2 w-96 bg-[#1a1f2e] border border-[#2d3748] rounded-lg shadow-xl z-50 max-h-[600px] flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b border-[#2d3748]">
              <div>
                <h3 className="font-semibold text-white">Notifications</h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  {isConnected ? 'Live updates enabled' : 'Connecting...'}
                </p>
              </div>
              {unreadCount > 0 && (
                <button
                  onClick={markAllAsRead}
                  className="text-xs text-blue-400 hover:text-blue-300"
                >
                  Mark all read
                </button>
              )}
            </div>

            {/* Notifications List */}
            <div className="flex-1 overflow-y-auto">
              {notifications.length === 0 ? (
                <div className="p-8 text-center text-slate-500">
                  <Bell className="w-12 h-12 mx-auto mb-3 opacity-20" />
                  <p className="text-sm">No notifications yet</p>
                </div>
              ) : (
                <div className="divide-y divide-[#2d3748]">
                  {notifications.map((notif) => (
                    <div
                      key={notif.id}
                      className={`
                        p-4 hover:bg-slate-800/30 transition-colors cursor-pointer
                        ${!notif.read ? 'bg-slate-800/20' : ''}
                      `}
                      onClick={() => markAsRead(notif.id)}
                    >
                      <div className="flex items-start gap-3">
                        {getIcon(notif.severity)}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-start justify-between gap-2">
                            <p className="text-sm font-medium text-slate-200">
                              {notif.title}
                            </p>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                dismissNotification(notif.id);
                              }}
                              className="text-slate-500 hover:text-slate-300"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          </div>
                          <p className="text-xs text-slate-400 mt-1">
                            {notif.message}
                          </p>
                          <p className="text-xs text-slate-600 mt-2">
                            {new Date(notif.timestamp).toLocaleTimeString()}
                          </p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
