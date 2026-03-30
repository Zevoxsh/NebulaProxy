import { useState, useEffect, useRef } from 'react';
import { Bell, X, Check, UserPlus, Globe, UserMinus, Users } from 'lucide-react';
import { teamAPI, notificationAPI } from '../../api/client';
import { useNavigate } from 'react-router-dom';
import { formatDistanceToNow } from 'date-fns';

export default function NotificationBell() {
  const [invitations, setInvitations] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [count, setCount] = useState(0);
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const dropdownRef = useRef(null);
  const navigate = useNavigate();

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
    const interval = setInterval(fetchAll, 30000); // Refresh every 30s
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (isOpen) {
      fetchAll();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  const getNotificationIcon = (actionType) => {
    switch (actionType) {
      case 'domain_added':
      case 'domain_removed':
        return Globe;
      case 'member_joined':
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
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="relative p-2 text-white/70 hover:text-white hover:bg-white/[0.05] rounded-lg transition-all duration-300"
      >
        <Bell className="w-5 h-5" strokeWidth={1.5} />
        {count > 0 && (
          <span className="absolute top-1 right-1 w-4 h-4 bg-[#EF4444] text-white text-[9px] font-medium rounded-full flex items-center justify-center">
            {count > 9 ? '9+' : count}
          </span>
        )}
      </button>

      {isOpen && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setIsOpen(false)} />
          <div className="absolute right-0 top-full mt-2 w-96 bg-[#161722] border border-white/[0.08] rounded-xl shadow-2xl z-50 animate-scale-in">
            <div className="p-4 border-b border-white/[0.08] flex items-center justify-between">
              <h3 className="text-sm font-normal text-white">Notifications</h3>
              <button
                onClick={() => setIsOpen(false)}
                className="p-1 text-white/60 hover:text-white hover:bg-white/[0.05] rounded transition-all"
              >
                <X className="w-4 h-4" strokeWidth={1.5} />
              </button>
            </div>

            <div className="max-h-96 overflow-y-auto">
              {/* Team Invitations */}
              {invitations.length > 0 && (
                <div className="border-b border-white/[0.05]">
                  <div className="p-2 bg-[#9D4EDD]/10">
                    <p className="text-xs font-medium text-[#C77DFF]">Team Invitations</p>
                  </div>
                  {invitations.map(invitation => (
                    <div key={invitation.id} className="p-4 border-b border-white/[0.05] hover:bg-white/[0.02]">
                      <div className="flex items-start gap-3 mb-3">
                        <div className="w-8 h-8 rounded-lg bg-[#9D4EDD]/10 flex items-center justify-center flex-shrink-0">
                          <UserPlus className="w-4 h-4 text-[#C77DFF]" strokeWidth={1.5} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs text-white/90 mb-1">
                            <span className="font-medium">{invitation.inviter_username}</span> invited you to join{' '}
                            <span className="font-medium">{invitation.team_name}</span>
                          </p>
                          <p className="text-xs text-white/40">
                            {formatDistanceToNow(new Date(invitation.created_at), { addSuffix: true })}
                          </p>
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleAcceptInvitation(invitation.id)}
                          className="flex-1 btn-primary text-xs px-3 py-1.5"
                        >
                          Accept
                        </button>
                        <button
                          onClick={() => handleRejectInvitation(invitation.id)}
                          className="flex-1 btn-secondary text-xs px-3 py-1.5"
                        >
                          Decline
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
                    <div className="p-2 bg-white/[0.02]">
                      <p className="text-xs font-medium text-white/50">Recent Activity</p>
                    </div>
                  )}
                  {notifications.map(notification => {
                    const Icon = getNotificationIcon(notification.action_type);
                    const isUnread = !notification.read_at;

                    return (
                      <div
                        key={notification.id}
                        className={`p-4 border-b border-white/[0.05] hover:bg-white/[0.02] ${isUnread ? 'bg-[#9D4EDD]/5' : ''}`}
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
                  })}
                </>
              )}

              {invitations.length === 0 && notifications.length === 0 && (
                <div className="p-8 text-center text-white/40">No notifications</div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
