import { useState, useEffect } from 'react';
import { Bell, X, Check, Users, Globe, UserMinus, UserPlus } from 'lucide-react';
import { notificationAPI } from '../api/client';
import { formatDistanceToNow } from 'date-fns';

export default function NotificationBell() {
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [showPanel, setShowPanel] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetchUnreadCount();
    // Refresh count every 30 seconds
    const interval = setInterval(fetchUnreadCount, 30000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (showPanel) {
      fetchNotifications();
    }
  }, [showPanel]);

  const fetchUnreadCount = async () => {
    try {
      const response = await notificationAPI.getCount();
      setUnreadCount(response.data.count);
    } catch (err) {
      console.error('Failed to fetch notification count:', err);
    }
  };

  const fetchNotifications = async () => {
    try {
      setLoading(true);
      const response = await notificationAPI.list({ limit: 20 });
      setNotifications(response.data.notifications);
    } catch (err) {
      console.error('Failed to fetch notifications:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleMarkAsRead = async (id) => {
    try {
      await notificationAPI.markAsRead(id);
      setNotifications(notifications.map(n => n.id === id ? { ...n, read_at: new Date().toISOString() } : n));
      fetchUnreadCount();
    } catch (err) {
      console.error('Failed to mark notification as read:', err);
    }
  };

  const handleMarkAllAsRead = async () => {
    try {
      await notificationAPI.markAllAsRead();
      setNotifications(notifications.map(n => ({ ...n, read_at: new Date().toISOString() })));
      fetchUnreadCount();
    } catch (err) {
      console.error('Failed to mark all as read:', err);
    }
  };

  const getNotificationIcon = (actionType) => {
    switch (actionType) {
      case 'domain_added':
      case 'domain_removed':
        return Globe;
      case 'member_joined':
      case 'member_added':
        return UserPlus;
      case 'member_removed':
        return UserMinus;
      default:
        return Users;
    }
  };

  const getNotificationColor = (actionType) => {
    switch (actionType) {
      case 'domain_added':
      case 'member_joined':
        return 'text-[#34D399]';
      case 'domain_removed':
      case 'member_removed':
        return 'text-[#F87171]';
      default:
        return 'text-[#C77DFF]';
    }
  };

  return (
    <div className="relative">
      {/* Bell Button */}
      <button
        onClick={() => setShowPanel(!showPanel)}
        className="relative p-2 text-white/70 hover:text-white hover:bg-white/[0.05] rounded-lg transition-all duration-300"
      >
        <Bell className="w-5 h-5" strokeWidth={1.5} />
        {unreadCount > 0 && (
          <span className="absolute top-1 right-1 w-4 h-4 bg-[#EF4444] text-white text-[9px] font-medium rounded-full flex items-center justify-center">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {/* Notification Panel */}
      {showPanel && (
        <>
          {/* Backdrop */}
          <div className="fixed inset-0 z-40" onClick={() => setShowPanel(false)} />

          {/* Panel */}
          <div className="absolute right-0 mt-2 w-96 bg-[#161722] border border-white/[0.08] rounded-xl shadow-2xl z-50 animate-scale-in">
            <div className="p-4 border-b border-white/[0.08] flex items-center justify-between">
              <h3 className="text-sm font-normal text-white">Notifications</h3>
              <div className="flex items-center gap-2">
                {unreadCount > 0 && (
                  <button
                    onClick={handleMarkAllAsRead}
                    className="text-xs text-[#C77DFF] hover:text-[#9D4EDD] transition-colors"
                  >
                    Mark all read
                  </button>
                )}
                <button
                  onClick={() => setShowPanel(false)}
                  className="p-1 text-white/60 hover:text-white hover:bg-white/[0.05] rounded transition-all"
                >
                  <X className="w-4 h-4" strokeWidth={1.5} />
                </button>
              </div>
            </div>

            <div className="max-h-96 overflow-y-auto">
              {loading ? (
                <div className="p-8 text-center text-white/40">Loading...</div>
              ) : notifications.length === 0 ? (
                <div className="p-8 text-center text-white/40">No notifications</div>
              ) : (
                notifications.map(notification => {
                  const Icon = getNotificationIcon(notification.action_type);
                  const isUnread = !notification.read_at;

                  return (
                    <div
                      key={notification.id}
                      className={`p-4 border-b border-white/[0.05] hover:bg-white/[0.02] transition-colors ${isUnread ? 'bg-[#9D4EDD]/5' : ''}`}
                    >
                      <div className="flex items-start gap-3">
                        <div className={`w-8 h-8 rounded-lg bg-white/[0.05] flex items-center justify-center flex-shrink-0 ${getNotificationColor(notification.action_type)}`}>
                          <Icon className="w-4 h-4" strokeWidth={1.5} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs text-white/90 leading-relaxed mb-1">{notification.message}</p>
                          <div className="flex items-center gap-2 text-xs text-white/40">
                            <span>{notification.team_name}</span>
                            <span>•</span>
                            <span>{formatDistanceToNow(new Date(notification.created_at), { addSuffix: true })}</span>
                          </div>
                        </div>
                        {isUnread && (
                          <button
                            onClick={() => handleMarkAsRead(notification.id)}
                            className="p-1 text-white/40 hover:text-[#34D399] hover:bg-[#10B981]/10 rounded transition-all flex-shrink-0"
                            title="Mark as read"
                          >
                            <Check className="w-4 h-4" strokeWidth={1.5} />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
