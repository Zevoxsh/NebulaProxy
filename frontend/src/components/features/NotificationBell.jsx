import { useState, useEffect, useRef } from 'react';
import { Bell, X, Check, Globe, UserPlus, UserMinus, Users, AlertTriangle, CheckCircle } from 'lucide-react';
import { teamAPI, notificationAPI } from '../../api/client';
import { formatDistanceToNow } from 'date-fns';

export default function NotificationBell() {
  const [invitations, setInvitations] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [count, setCount] = useState(0);
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef(null);

  const fetchAll = async () => {
    try {
      const [invRes, notifRes, countRes] = await Promise.all([
        teamAPI.getMyInvitations(),
        notificationAPI.list({ limit: 20 }),
        notificationAPI.getCount()
      ]);
      setInvitations(invRes.data.invitations || []);
      setNotifications(notifRes.data.notifications || []);
      setCount((invRes.data.invitations?.length || 0) + (countRes.data.count || 0));
    } catch (err) {
      console.error('Failed to fetch notifications:', err);
    }
  };

  useEffect(() => {
    fetchAll();
    const interval = setInterval(fetchAll, 30000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (isOpen) fetchAll();
  }, [isOpen]);

  const handleAcceptInvitation = async (invitationId) => {
    try {
      await teamAPI.acceptInvitation(invitationId);
      await fetchAll();
    } catch (err) {
      console.error('Failed to accept invitation:', err);
    }
  };

  const handleRejectInvitation = async (invitationId) => {
    try {
      await teamAPI.rejectInvitation(invitationId);
      await fetchAll();
    } catch (err) {
      console.error('Failed to reject invitation:', err);
    }
  };

  const handleMarkAsRead = async (id) => {
    try {
      await notificationAPI.markAsRead(id);
      setNotifications(notifications.map(n => n.id === id ? { ...n, read_at: new Date().toISOString() } : n));
      setCount(prev => Math.max(0, prev - 1));
    } catch (err) {
      console.error('Failed to mark as read:', err);
    }
  };

  const handleMarkAllAsRead = async () => {
    try {
      await notificationAPI.markAllAsRead();
      setNotifications(notifications.map(n => ({ ...n, read_at: new Date().toISOString() })));
      setCount(0);
    } catch (err) {
      console.error('Failed to mark all as read:', err);
    }
  };

  const getNotificationIcon = (actionType) => {
    switch (actionType) {
      case 'domain_down':    return AlertTriangle;
      case 'domain_up':      return CheckCircle;
      case 'domain_added':
      case 'domain_removed': return Globe;
      case 'member_joined':  return UserPlus;
      case 'member_removed': return UserMinus;
      default:               return Users;
    }
  };

  const getNotificationColor = (actionType) => {
    switch (actionType) {
      case 'domain_down':    return 'text-red-400';
      case 'domain_up':      return 'text-emerald-400';
      case 'domain_added':
      case 'member_joined':  return 'text-emerald-400';
      case 'domain_removed':
      case 'member_removed': return 'text-red-400';
      default:               return 'text-white/50';
    }
  };

  const hasAny = invitations.length > 0 || notifications.length > 0;

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="relative p-2 text-white/70 hover:text-white hover:bg-white/[0.05] rounded-lg transition-all duration-300"
      >
        <Bell className="w-5 h-5" strokeWidth={1.5} />
        {count > 0 && (
          <span className="absolute top-1 right-1 w-4 h-4 bg-red-500 text-white text-[9px] font-medium rounded-full flex items-center justify-center">
            {count > 9 ? '9+' : count}
          </span>
        )}
      </button>

      {isOpen && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setIsOpen(false)} />
          <div className="absolute right-0 top-full mt-2 w-80 bg-[#0f1014] border border-white/[0.08] rounded-xl shadow-2xl z-50 animate-scale-in">
            <div className="px-4 py-3 border-b border-white/[0.06] flex items-center justify-between">
              <h3 className="text-sm font-medium text-white">Notifications</h3>
              <div className="flex items-center gap-1">
                {count > 0 && (
                  <button
                    onClick={handleMarkAllAsRead}
                    className="text-xs text-white/40 hover:text-white/70 px-2 py-1 rounded transition-colors"
                  >
                    Tout lire
                  </button>
                )}
                <button
                  onClick={() => setIsOpen(false)}
                  className="p-1 text-white/40 hover:text-white hover:bg-white/[0.05] rounded transition-all"
                >
                  <X className="w-4 h-4" strokeWidth={1.5} />
                </button>
              </div>
            </div>

            <div className="max-h-[400px] overflow-y-auto">
              {/* Team Invitations */}
              {invitations.length > 0 && (
                <div className="border-b border-white/[0.06]">
                  <div className="px-4 py-2 bg-white/[0.02]">
                    <p className="text-[11px] font-medium text-white/50 uppercase tracking-widest">Invitations</p>
                  </div>
                  {invitations.map(invitation => (
                    <div key={invitation.id} className="px-4 py-3 border-b border-white/[0.04] hover:bg-white/[0.02]">
                      <div className="flex items-start gap-3 mb-3">
                        <div className="w-7 h-7 rounded-lg bg-white/[0.04] flex items-center justify-center flex-shrink-0">
                          <UserPlus className="w-3.5 h-3.5 text-white/50" strokeWidth={1.5} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs text-white/80 leading-relaxed">
                            <span className="font-medium text-white">{invitation.inviter_username}</span> vous invite dans{' '}
                            <span className="font-medium text-white">{invitation.team_name}</span>
                          </p>
                          <p className="text-[11px] text-white/30 mt-1">
                            {formatDistanceToNow(new Date(invitation.created_at), { addSuffix: true })}
                          </p>
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleAcceptInvitation(invitation.id)}
                          className="flex-1 btn-primary text-xs px-3 py-1.5"
                        >
                          Accepter
                        </button>
                        <button
                          onClick={() => handleRejectInvitation(invitation.id)}
                          className="flex-1 btn-secondary text-xs px-3 py-1.5"
                        >
                          Refuser
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Activity Notifications */}
              {notifications.length > 0 && (
                <>
                  {invitations.length > 0 && (
                    <div className="px-4 py-2 bg-white/[0.02]">
                      <p className="text-[11px] font-medium text-white/50 uppercase tracking-widest">Activité</p>
                    </div>
                  )}
                  {notifications.map(notification => {
                    const Icon = getNotificationIcon(notification.action_type);
                    const isUnread = !notification.read_at;
                    return (
                      <div
                        key={notification.id}
                        className={`px-4 py-3 border-b border-white/[0.04] hover:bg-white/[0.02] transition-colors ${
                          isUnread ? 'bg-white/[0.02]' : ''
                        }`}
                      >
                        <div className="flex items-start gap-3">
                          <div className={`w-7 h-7 rounded-lg bg-white/[0.04] flex items-center justify-center flex-shrink-0 ${getNotificationColor(notification.action_type)}`}>
                            <Icon className="w-3.5 h-3.5" strokeWidth={1.5} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-xs text-white/80 leading-relaxed">{notification.message}</p>
                            <p className="text-[11px] text-white/30 mt-1">
                              {formatDistanceToNow(new Date(notification.created_at), { addSuffix: true })}
                            </p>
                          </div>
                          {isUnread && (
                            <button
                              onClick={() => handleMarkAsRead(notification.id)}
                              className="p-1 text-white/30 hover:text-white/70 hover:bg-white/[0.05] rounded transition-all flex-shrink-0"
                              title="Marquer comme lu"
                            >
                              <Check className="w-3.5 h-3.5" strokeWidth={1.5} />
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </>
              )}

              {!hasAny && (
                <div className="py-12 text-center">
                  <Bell className="w-6 h-6 text-white/20 mx-auto mb-2" strokeWidth={1.5} />
                  <p className="text-xs text-white/30">Aucune notification</p>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
