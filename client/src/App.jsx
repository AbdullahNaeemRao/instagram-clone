import { useState, useEffect, useRef, useCallback, createContext, useContext } from 'react';
import { Routes, Route, useNavigate, Navigate, useParams } from 'react-router-dom';
import axios from 'axios';
import { Toaster, toast } from 'react-hot-toast';
import {
  Heart, MessageCircle, Send, PlusSquare, Search, LogOut,
  Home as HomeIcon, X, User, Compass, UserCircle, Trash2,
  Pin, ZoomIn, ZoomOut, Pencil, ChevronLeft, ChevronRight,
  Copy, Lock, Settings, Bookmark, Grid3X3, ArrowLeft,
  Image as ImageIcon, Check, CheckCheck, Reply, CornerUpLeft
} from 'lucide-react';
import Cropper from 'react-easy-crop';
import { io as socketIO } from 'socket.io-client';

const API = "http://localhost:8080/api";
const SocketContext = createContext(null);

function ProtectedRoute({ user, isAuthChecking, children }) {
  if (isAuthChecking) return <div className="p-10 text-center">Loading...</div>;
  return user ? children : <Navigate to="/login" />;
}

function getPrefersDarkMode() {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function usePrefersDarkMode() {
  const [prefersDarkMode, setPrefersDarkMode] = useState(getPrefersDarkMode);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return undefined;
    }

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = (event) => setPrefersDarkMode(event.matches);
    setPrefersDarkMode(mediaQuery.matches);

    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', handleChange);
      return () => mediaQuery.removeEventListener('change', handleChange);
    }

    mediaQuery.addListener(handleChange);
    return () => mediaQuery.removeListener(handleChange);
  }, []);

  return prefersDarkMode;
}

function timeAgo(date) {
  if (!date) return '';
  const seconds = Math.floor((new Date() - new Date(date)) / 1000);
  if (seconds < 60) return 'now';
  const m = Math.floor(seconds / 60);
  if (m < 60) return m + 'm';
  const h = Math.floor(m / 60);
  if (h < 24) return h + 'h';
  const d = Math.floor(h / 24);
  if (d < 7) return d + 'd';
  return Math.floor(d / 7) + 'w';
}

export default function App() {
  const [user, setUser] = useState(null);
  const [isUploadOpen, setIsUploadOpen] = useState(false);
  const [isActivityOpen, setIsActivityOpen] = useState(false);
  const [isAuthChecking, setIsAuthChecking] = useState(true);
  const prefersDarkMode = usePrefersDarkMode();
  const [hasSplashElapsed, setHasSplashElapsed] = useState(false);
  const [isSplashExiting, setIsSplashExiting] = useState(false);
  const [socket, setSocket] = useState(null);
  const [notifCounts, setNotifCounts] = useState({ messages: 0, requests: 0, activity: 0, notifications: 0 });
  const navigate = useNavigate();

  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined;
    }

    const exitTimeout = window.setTimeout(() => {
      setIsSplashExiting(true);
    }, 1250);

    const finishTimeout = window.setTimeout(() => {
      setHasSplashElapsed(true);
    }, 1900);

    return () => {
      window.clearTimeout(exitTimeout);
      window.clearTimeout(finishTimeout);
    };
  }, []);

  useEffect(() => {
    (async () => {
      const token = localStorage.getItem('token');
      const savedUser = localStorage.getItem('user');

      if (!token || !savedUser) {
        setIsAuthChecking(false);
        return;
      }

      try {
        const res = await axios.get(API + '/me', { headers: { Authorization: 'Bearer ' + token } });
        const mergedUser = { ...JSON.parse(savedUser), ...res.data };
        localStorage.setItem('user', JSON.stringify(mergedUser));
        setUser(mergedUser);
      } catch (err) {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        setUser(null);
        navigate('/login');
      } finally {
        setIsAuthChecking(false);
      }
    })();
  }, [navigate]);

  const fetchNotifCounts = useCallback(async () => {
    try {
      const token = localStorage.getItem('token');
      const res = await axios.get(API + '/notifications/count', { headers: { Authorization: 'Bearer ' + token } });
      setNotifCounts(prev => {
        if (
          prev.messages === res.data.messages &&
          prev.requests === res.data.requests &&
          prev.activity === res.data.activity &&
          prev.notifications === res.data.notifications
        ) return prev;
        return res.data;
      });
    } catch (err) { /* ignore */ }
  }, []);

  const socketRef = useRef(null);

  useEffect(() => {
    if (!user) {
      if (socketRef.current) { socketRef.current.disconnect(); socketRef.current = null; setSocket(null); }
      return;
    }
    const token = localStorage.getItem('token');
    if (!token || socketRef.current) return;
    const s = socketIO('http://localhost:8080', { auth: { token } });
    s.on('connect', () => console.log('Socket connected'));
    s.on('notification_update', () => fetchNotifCounts());
    socketRef.current = s;
    setSocket(s);
    return () => { s.disconnect(); socketRef.current = null; };
  }, [user, fetchNotifCounts]);

  useEffect(() => {
    if (!user) return;
    fetchNotifCounts();
    const iv = setInterval(fetchNotifCounts, 15000);
    return () => clearInterval(iv);
  }, [user, fetchNotifCounts]);

  const handleLogin = (userData, token) => {
    localStorage.setItem('token', token);
    localStorage.setItem('user', JSON.stringify(userData));
    setUser(userData);
    navigate('/');
  };

  const handleLogout = () => {
    if (socketRef.current) { socketRef.current.disconnect(); socketRef.current = null; }
    setSocket(null);
    localStorage.clear();
    setUser(null);
    window.setTimeout(() => navigate('/login', { replace: true }), 0);
  };

  const msgBadge = notifCounts.messages > 0;
  const notifBadge = notifCounts.notifications > 0;
  const msgLabel = notifCounts.messages > 9 ? '9+' : notifCounts.messages;
  const notifLabel = notifCounts.notifications > 9 ? '9+' : notifCounts.notifications;
  const showLaunchScreen = !hasSplashElapsed || isAuthChecking;
  const appThemeClass = prefersDarkMode ? 'app-theme-dark bg-[#0b1117] text-white' : 'app-theme-light bg-white text-[#111827]';

  if (showLaunchScreen) {
    return <LaunchScreen prefersDarkMode={prefersDarkMode} isExiting={!hasSplashElapsed && isSplashExiting} />;
  }

  return (
    <SocketContext.Provider value={socket}>
      <div data-testid="app-shell" data-theme={prefersDarkMode ? 'dark' : 'light'} className={`min-h-screen flex flex-col md:flex-row text-sm transition-colors ${appThemeClass}`}>
        <Toaster />

        {/* MOBILE HEADER */}
        {user && (
          <nav className="md:hidden sticky top-0 bg-white border-b border-gray-200 p-3 flex justify-between items-center z-40">
            <h1 className="text-xl font-bold font-serif cursor-pointer" onClick={() => navigate('/')}>Instagram</h1>
            <div className="flex gap-4 items-center">
              <PlusSquare onClick={() => setIsUploadOpen(true)} className="cursor-pointer hover:text-gray-600" />
              <div className="relative cursor-pointer" onClick={() => setIsActivityOpen(true)}>
                <Heart className="hover:text-gray-600" size={22} />
                {notifBadge && <span className="absolute -top-1.5 -right-1.5 bg-red-500 text-white text-[10px] font-bold min-w-[16px] h-4 rounded-full flex items-center justify-center px-0.5">{notifLabel}</span>}
              </div>
              <div className="relative cursor-pointer" onClick={() => navigate('/messages')}>
                <Send className="hover:text-gray-600" size={22} />
                {msgBadge && <span className="absolute -top-1.5 -right-1.5 bg-red-500 text-white text-[10px] font-bold w-4 h-4 rounded-full flex items-center justify-center">{msgLabel}</span>}
              </div>
              <LogOut onClick={handleLogout} className="cursor-pointer hover:text-red-500" size={22} />
            </div>
          </nav>
        )}

        {/* DESKTOP SIDEBAR */}
        {user && (
          <div className="hidden md:flex flex-col w-[244px] bg-white border-r border-gray-200 h-screen sticky top-0 p-3 pt-8 z-50">
            <h1 className="text-2xl font-bold font-serif mb-8 px-4 cursor-pointer" onClick={() => navigate('/')}>Instagram</h1>
            <div className="flex flex-col gap-2 flex-1">
              <NavItem icon={<HomeIcon size={24} />} label="Home" onClick={() => navigate('/')} />
              <NavItem icon={<Search size={24} />} label="Search" onClick={() => navigate('/search')} />
              <NavItem icon={<Compass size={24} />} label="Explore" onClick={() => navigate('/search')} />
              <NavItem
                icon={<div className="relative"><Send size={24} />{msgBadge && <span className="absolute -top-2 -right-2 bg-red-500 text-white text-[10px] font-bold min-w-[16px] h-4 rounded-full flex items-center justify-center px-0.5">{msgLabel}</span>}</div>}
                label="Messages"
                onClick={() => navigate('/messages')}
              />
              <NavItem icon={<PlusSquare size={24} />} label="Create" onClick={() => setIsUploadOpen(true)} />
              <NavItem
                icon={<div className="relative"><Heart size={24} />{notifBadge && <span className="absolute -top-2 -right-2 bg-red-500 text-white text-[10px] font-bold min-w-[16px] h-4 rounded-full flex items-center justify-center px-0.5">{notifLabel}</span>}</div>}
                label="Notifications"
                onClick={() => setIsActivityOpen(true)}
              />
              <NavItem icon={<UserCircle size={24} />} label="Profile" onClick={() => navigate('/u/' + user.username)} />
            </div>
            <div className="mt-auto">
              <NavItem icon={<LogOut size={24} className="text-red-500" />} label="Log out" onClick={handleLogout} />
            </div>
          </div>
        )}

        {isUploadOpen && <UploadModal onClose={() => setIsUploadOpen(false)} onSuccess={() => { setIsUploadOpen(false); window.location.reload(); }} />}
        {isActivityOpen && <ActivityModal onClose={() => { setIsActivityOpen(false); fetchNotifCounts(); }} />}

        <main className="flex-1 w-full mx-auto">
          <Routes>
            <Route path="/login" element={<LoginPage onLogin={handleLogin} currentUser={user} prefersDarkMode={prefersDarkMode} />} />
            <Route path="/" element={<ProtectedRoute user={user} isAuthChecking={isAuthChecking}><Feed /></ProtectedRoute>} />
            <Route path="/search" element={<ProtectedRoute user={user} isAuthChecking={isAuthChecking}><SearchPage currentUser={user} /></ProtectedRoute>} />
            <Route path="/u/:username" element={<ProtectedRoute user={user} isAuthChecking={isAuthChecking}><PublicProfile currentUser={user} /></ProtectedRoute>} />
            <Route path="/messages" element={<ProtectedRoute user={user} isAuthChecking={isAuthChecking}><ChatInbox currentUser={user} /></ProtectedRoute>} />
            <Route path="/messages/:conversationId" element={<ProtectedRoute user={user} isAuthChecking={isAuthChecking}><ChatView currentUser={user} /></ProtectedRoute>} />
          </Routes>
        </main>

        {/* MOBILE BOTTOM NAV */}
        {user && (
          <div className="md:hidden fixed bottom-0 w-full bg-white border-t border-gray-200 p-3 flex justify-around items-center z-40 h-12">
            <HomeIcon onClick={() => navigate('/')} size={24} className="cursor-pointer text-gray-700" />
            <Search onClick={() => navigate('/search')} size={24} className="cursor-pointer text-gray-700" />
            <div className="relative cursor-pointer" onClick={() => navigate('/messages')}>
              <Send size={24} className="text-gray-700" />
              {msgBadge && <span className="absolute -top-1.5 -right-1.5 bg-red-500 text-white text-[10px] font-bold w-4 h-4 rounded-full flex items-center justify-center">{msgLabel}</span>}
            </div>
            <PlusSquare onClick={() => setIsUploadOpen(true)} size={24} className="cursor-pointer text-gray-700" />
            <div onClick={() => navigate('/u/' + user.username)} className="cursor-pointer">
              <div className="w-6 h-6 rounded-full overflow-hidden border border-gray-200">
                {user.profile_pic ? <img src={user.profile_pic} className="w-full h-full object-cover" /> : <User className="p-0.5 bg-gray-200 w-full h-full text-gray-500" />}
              </div>
            </div>
          </div>
        )}
      </div>
    </SocketContext.Provider>
  );
}

/* ========== NAV ITEM ========== */
function NavItem({ icon, label, onClick }) {
  return (
    <div data-testid={`nav-item-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`} onClick={onClick} className="flex items-center gap-4 p-3 hover:bg-gray-50 rounded-lg cursor-pointer transition-colors group">
      <div className="group-hover:scale-105 transition-transform">{icon}</div>
      <span className="text-[16px] font-normal">{label}</span>
    </div>
  );
}

/* ========== ACTIVITY MODAL ========== */
function ActivityModal({ onClose }) {
  const navigate = useNavigate();
  const socket = useContext(SocketContext);
  const [requests, setRequests] = useState([]);
  const [activities, setActivities] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchNotifications = useCallback(async () => {
    try {
      setLoading(true);
      const token = localStorage.getItem('token');
      const res = await axios.get(API + '/notifications', { headers: { Authorization: 'Bearer ' + token } });
      setRequests(res.data.requests || []);
      setActivities(res.data.activities || []);
    } catch (e) { /* */ } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    (async () => {
      await fetchNotifications();
      try {
        const token = localStorage.getItem('token');
        await axios.put(API + '/notifications/read', {}, { headers: { Authorization: 'Bearer ' + token } });
        setActivities(prev => prev.map(item => ({ ...item, is_unread: false })));
      } catch (e) { /* */ }
    })();
  }, [fetchNotifications]);

  useEffect(() => {
    if (!socket) return;
    const handler = () => fetchNotifications();
    socket.on('notification_update', handler);
    return () => socket.off('notification_update', handler);
  }, [socket, fetchNotifications]);

  const handleAction = async (id, action) => {
    try {
      const token = localStorage.getItem('token');
      await axios.post(API + '/requests/' + id + '/' + action, {}, { headers: { Authorization: 'Bearer ' + token } });
      await fetchNotifications();
      toast.success(action === 'confirm' ? 'Confirmed' : 'Deleted');
    } catch (e) { toast.error('Failed'); }
  };

  const notificationCopy = (item) => {
    switch (item.type) {
      case 'follow':
        return 'started following you';
      case 'post_comment':
        return 'commented on your post';
      case 'comment_reply':
        return 'replied to your comment';
      case 'comment_like':
        return 'liked your comment';
      default:
        return 'interacted with you';
    }
  };

  return (
    <div data-testid="activity-modal" className="fixed inset-0 bg-black/50 z-[90] flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white w-full max-w-md rounded-xl overflow-hidden shadow-2xl h-[520px] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="p-3 border-b font-bold text-center flex justify-between items-center">
          <div className="w-6" />
          <span>Notifications</span>
          <X className="cursor-pointer" size={20} onClick={onClose} />
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-6">
          {loading ? (
            <p className="text-gray-500 text-center mt-10">Loading notifications...</p>
          ) : (
            <>
              <section>
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-bold">Follow Requests</h3>
                  <span className="text-xs text-gray-400">{requests.length}</span>
                </div>
                {requests.length === 0 ? (
                  <p className="text-gray-500 text-sm">No pending requests.</p>
                ) : requests.map(r => (
                  <div data-testid="follow-request-row" data-user-id={r.follower_id} data-username={r.username} key={r.follower_id} className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-3 cursor-pointer" onClick={() => { onClose(); navigate('/u/' + r.username); }}>
                      <div className="w-10 h-10 rounded-full bg-gray-200 overflow-hidden">
                        {r.profile_pic ? <img src={r.profile_pic} className="w-full h-full object-cover" /> : <User className="w-full h-full p-2 text-gray-400" />}
                      </div>
                      <div>
                        <span className="font-semibold">{r.username}</span>
                        <p className="text-xs text-gray-400">{timeAgo(r.created_at)}</p>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button data-testid="follow-request-confirm" onClick={() => handleAction(r.follower_id, 'confirm')} className="bg-blue-500 text-white px-3 py-1 rounded text-xs font-bold hover:bg-blue-600">Confirm</button>
                      <button data-testid="follow-request-delete" onClick={() => handleAction(r.follower_id, 'delete')} className="bg-gray-200 text-black px-3 py-1 rounded text-xs font-bold hover:bg-gray-300">Delete</button>
                    </div>
                  </div>
                ))}
              </section>

              <section>
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-bold">Activity</h3>
                  <span className="text-xs text-gray-400">{activities.length}</span>
                </div>
                {activities.length === 0 ? (
                  <p className="text-gray-500 text-sm">No activity yet.</p>
                ) : activities.map(item => (
                  <div
                    data-testid="activity-notification-row"
                    data-type={item.type}
                    data-username={item.actor_username}
                    data-comment-id={item.comment_id || ''}
                    key={`${item.type}-${item.actor_id}-${item.comment_id || item.post_id || item.event_at}`}
                    className="flex items-start gap-3 rounded-xl px-1 py-2 hover:bg-gray-50"
                  >
                    <div className="w-10 h-10 rounded-full bg-gray-200 overflow-hidden shrink-0 cursor-pointer" onClick={() => { onClose(); navigate('/u/' + item.actor_username); }}>
                      {item.actor_profile_pic ? <img src={item.actor_profile_pic} className="w-full h-full object-cover" /> : <User className="w-full h-full p-2 text-gray-400" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm leading-relaxed">
                        <span className="font-semibold cursor-pointer hover:text-gray-600" onClick={() => { onClose(); navigate('/u/' + item.actor_username); }}>{item.actor_username}</span>{' '}
                        {notificationCopy(item)}
                      </p>
                      {item.preview_text && <p className="mt-1 text-sm text-gray-500 line-clamp-2">{item.preview_text}</p>}
                      <p className="mt-1 text-[11px] uppercase tracking-[0.18em] text-gray-400">{timeAgo(item.event_at)}</p>
                    </div>
                    {item.is_unread && <span data-testid="activity-notification-unread" className="mt-2 h-2.5 w-2.5 rounded-full bg-blue-500" />}
                  </div>
                ))}
              </section>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/* ========== CHAT INBOX ========== */
function ChatInbox({ currentUser }) {
  const [conversations, setConversations] = useState([]);
  const [showNewMsg, setShowNewMsg] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const navigate = useNavigate();
  const socket = useContext(SocketContext);

  const fetchConversations = async () => {
    try {
      const token = localStorage.getItem('token');
      const res = await axios.get(API + '/conversations', { headers: { Authorization: 'Bearer ' + token } });
      setConversations(res.data);
    } catch (e) { /* */ }
  };

  useEffect(() => { fetchConversations(); }, []);

  useEffect(() => {
    if (!socket) return;
    const handler = () => fetchConversations();
    socket.on('inbox_update', handler);
    socket.on('notification_update', handler);
    return () => { socket.off('inbox_update', handler); socket.off('notification_update', handler); };
  }, [socket]);

  const startConversation = async (userId) => {
    try {
      const token = localStorage.getItem('token');
      const res = await axios.post(API + '/conversations', { userId }, { headers: { Authorization: 'Bearer ' + token } });
      setShowNewMsg(false);
      navigate('/messages/' + res.data.conversation_id);
    } catch (e) { toast.error('Failed'); }
  };

  useEffect(() => {
    if (!showNewMsg || searchQuery.length < 2) { setSearchResults([]); return; }
    const t = setTimeout(async () => {
      try {
        const token = localStorage.getItem('token');
        const res = await axios.get(API + '/search?q=' + searchQuery, { headers: { Authorization: 'Bearer ' + token } });
        setSearchResults(res.data);
      } catch (e) { /* */ }
    }, 300);
    return () => clearTimeout(t);
  }, [searchQuery, showNewMsg]);

  return (
    <div data-testid="chat-inbox" className="max-w-xl mx-auto h-[calc(100vh-60px)] md:h-screen flex flex-col bg-white">
      <div className="p-4 border-b border-gray-200 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <ArrowLeft size={24} className="cursor-pointer md:hidden" onClick={() => navigate('/')} />
          <h2 className="text-xl font-bold">{currentUser?.username}</h2>
        </div>
        <button data-testid="chat-new-message" onClick={() => setShowNewMsg(true)} className="text-sm font-semibold text-blue-500 hover:text-blue-700">New Message</button>
      </div>
      <div className="px-4 pt-4 pb-2 shrink-0">
        <h3 className="font-bold text-base">Messages</h3>
      </div>
      <div className="flex-1 overflow-y-auto">
        {conversations.length === 0 && (
          <div className="text-center text-gray-400 mt-20 px-6">
            <Send size={48} className="mx-auto mb-4 text-gray-300" />
            <h3 className="text-xl font-bold text-black mb-1">Your messages</h3>
            <p className="text-sm">Send a message to start a chat.</p>
            <button onClick={() => setShowNewMsg(true)} className="mt-4 bg-blue-500 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-blue-600">Send message</button>
          </div>
        )}
        {conversations.map(c => (
          <div data-testid="conversation-row" data-conversation-id={c.id} data-username={c.other_username} key={c.id} onClick={() => navigate('/messages/' + c.id)} className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50 cursor-pointer transition-colors">
            <div className="relative shrink-0">
              <div className="w-14 h-14 rounded-full bg-gray-200 overflow-hidden">
                {c.other_profile_pic ? <img src={c.other_profile_pic} className="w-full h-full object-cover" /> : <User className="w-full h-full p-3 text-gray-400" />}
              </div>
              {c.is_online && <div className="absolute bottom-0 right-0 w-3.5 h-3.5 bg-green-500 rounded-full border-2 border-white" />}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between">
                <span className={'font-semibold text-sm ' + (parseInt(c.unread_count) > 0 ? 'text-black' : 'text-gray-900')}>{c.other_username}</span>
                <span className="text-xs text-gray-400">{timeAgo(c.last_message_time)}</span>
              </div>
              <div className="flex items-center justify-between">
                <p className={'text-sm truncate max-w-[200px] ' + (parseInt(c.unread_count) > 0 ? 'text-black font-semibold' : 'text-gray-500')}>
                  {c.last_message_image && !c.last_message_text ? '\uD83D\uDCF7 Photo' : (c.last_message_text || 'Start a conversation')}
                </p>
                {parseInt(c.unread_count) > 0 && <div className="w-2 h-2 bg-blue-500 rounded-full shrink-0 ml-2" />}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* New Message Modal */}
      {showNewMsg && (
        <div data-testid="new-message-modal" className="fixed inset-0 bg-black/50 z-[80] flex items-center justify-center p-4" onClick={() => setShowNewMsg(false)}>
          <div className="bg-white w-full max-w-md rounded-xl overflow-hidden shadow-2xl h-[450px] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="p-3 border-b flex justify-between items-center">
              <div className="w-6" />
              <span className="font-bold">New Message</span>
              <X size={20} className="cursor-pointer" onClick={() => setShowNewMsg(false)} />
            </div>
            <div className="p-3 border-b flex items-center gap-2">
              <span className="font-semibold text-sm">To:</span>
              <input data-testid="new-message-search-input" type="text" placeholder="Search..." className="flex-1 outline-none text-sm" value={searchQuery} onChange={e => setSearchQuery(e.target.value)} autoFocus />
            </div>
            <div className="flex-1 overflow-y-auto">
              {searchResults.map(u => (
                <div data-testid="new-message-result" data-user-id={u.id} data-username={u.username} key={u.id} onClick={() => startConversation(u.id)} className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50 cursor-pointer">
                  <div className="w-11 h-11 rounded-full bg-gray-200 overflow-hidden">
                    {u.profile_pic ? <img src={u.profile_pic} className="w-full h-full object-cover" /> : <User className="w-full h-full p-2 text-gray-400" />}
                  </div>
                  <span className="font-semibold text-sm">{u.username}</span>
                </div>
              ))}
              {searchQuery.length >= 2 && searchResults.length === 0 && <p className="text-center text-gray-400 text-sm mt-8">No accounts found.</p>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ========== CHAT VIEW ========== */
function ChatView({ currentUser }) {
  const { conversationId } = useParams();
  const [messages, setMessages] = useState([]);
  const [newText, setNewText] = useState('');
  const [otherUser, setOtherUser] = useState(null);
  const [isTyping, setIsTyping] = useState(false);
  const [isOnline, setIsOnline] = useState(false);
  const [lastActive, setLastActive] = useState(null);
  const [replyTo, setReplyTo] = useState(null); // { id, text, username, sender_id }
  const [editingMsg, setEditingMsg] = useState(null); // { id, text }
  const [showOriginal, setShowOriginal] = useState(null); // message id to show original text
  const endRef = useRef(null);
  const fileRef = useRef(null);
  const inputRef = useRef(null);
  const typingTimer = useRef(null);
  const navigate = useNavigate();
  const socket = useContext(SocketContext);

  const EDIT_DELETE_LIMIT = 12 * 60 * 60 * 1000; // 12 hours

  const canEditOrDelete = (msg) => {
    return (Date.now() - new Date(msg.created_at).getTime()) < EDIT_DELETE_LIMIT;
  };

  const lastActiveText = (ts) => {
    if (!ts) return '';
    const seconds = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
    if (seconds < 60) return 'Active just now';
    const m = Math.floor(seconds / 60);
    if (m < 60) return `Active ${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `Active ${h}h ago`;
    const d = Math.floor(h / 24);
    if (d < 7) return `Active ${d}d ago`;
    return `Active ${Math.floor(d / 7)}w ago`;
  };

  const scrollBottom = () => endRef.current?.scrollIntoView({ behavior: 'smooth' });

  const fetchMessages = async () => {
    try {
      const token = localStorage.getItem('token');
      const res = await axios.get(API + '/conversations/' + conversationId + '/messages', { headers: { Authorization: 'Bearer ' + token } });
      setMessages(res.data);
    } catch (e) { /* */ }
  };

  useEffect(() => {
    (async () => {
      try {
        const token = localStorage.getItem('token');
        const convRes = await axios.get(API + '/conversations', { headers: { Authorization: 'Bearer ' + token } });
        const conv = convRes.data.find(c => c.id === parseInt(conversationId));
        if (conv) {
          setOtherUser({ id: conv.other_user_id, username: conv.other_username, profile_pic: conv.other_profile_pic });
          setIsOnline(conv.is_online);
          setLastActive(conv.other_last_active || null);
        }
      } catch (e) { /* */ }
      await fetchMessages();
    })();
  }, [conversationId]);

  useEffect(() => { scrollBottom(); }, [messages, isTyping]);

  useEffect(() => {
    if (!socket) return;
    socket.emit('join_chat', conversationId);

    const onNewMsg = (data) => {
      if (data.conversationId === parseInt(conversationId)) {
        setMessages(prev => prev.find(m => m.id === data.message.id) ? prev : [...prev, data.message]);
        const token = localStorage.getItem('token');
        axios.put(API + '/conversations/' + conversationId + '/read', {}, { headers: { Authorization: 'Bearer ' + token } }).catch(() => {});
      }
    };
    const onDeleted = (data) => {
      if (data.conversationId === parseInt(conversationId)) setMessages(prev => prev.filter(m => m.id !== data.messageId));
    };
    const onEdited = (data) => {
      if (data.conversationId === parseInt(conversationId)) {
        setMessages(prev => prev.map(m => m.id === data.message.id ? { ...m, text: data.message.text, edited_at: data.message.edited_at, original_text: data.message.original_text } : m));
      }
    };
    const onTyp = (data) => {
      if (data.conversationId === parseInt(conversationId) && data.userId !== currentUser?.id) setIsTyping(true);
    };
    const onStopTyp = (data) => {
      if (data.conversationId === parseInt(conversationId) && data.userId !== currentUser?.id) setIsTyping(false);
    };
    const onOn = (data) => { if (otherUser && data.userId === parseInt(otherUser.id)) { setIsOnline(true); setLastActive(null); } };
    const onOff = (data) => { if (otherUser && data.userId === parseInt(otherUser.id)) { setIsOnline(false); setLastActive(data.last_active || new Date().toISOString()); } };

    socket.on('new_message', onNewMsg);
    socket.on('message_deleted', onDeleted);
    socket.on('message_edited', onEdited);
    socket.on('user_typing', onTyp);
    socket.on('user_stop_typing', onStopTyp);
    socket.on('user_online', onOn);
    socket.on('user_offline', onOff);

    return () => {
      socket.emit('leave_chat', conversationId);
      socket.off('new_message', onNewMsg);
      socket.off('message_deleted', onDeleted);
      socket.off('message_edited', onEdited);
      socket.off('user_typing', onTyp);
      socket.off('user_stop_typing', onStopTyp);
      socket.off('user_online', onOn);
      socket.off('user_offline', onOff);
    };
  }, [socket, conversationId, otherUser]);

  const sendMessage = async (e) => {
    e?.preventDefault();
    if (!newText.trim()) return;

    // If we are editing a message
    if (editingMsg) {
      try {
        const token = localStorage.getItem('token');
        const res = await axios.put(API + '/messages/' + editingMsg.id, { text: newText }, { headers: { Authorization: 'Bearer ' + token } });
        setMessages(prev => prev.map(m => m.id === editingMsg.id ? { ...m, text: res.data.text, edited_at: res.data.edited_at, original_text: res.data.original_text } : m));
        setEditingMsg(null);
        setNewText('');
      } catch (e) { toast.error(e.response?.data?.error || 'Failed to edit'); }
      return;
    }

    try {
      const token = localStorage.getItem('token');
      const body = { text: newText };
      if (replyTo) body.reply_to_id = replyTo.id;
      await axios.post(API + '/conversations/' + conversationId + '/messages', body, { headers: { Authorization: 'Bearer ' + token } });
      setNewText('');
      setReplyTo(null);
      if (socket) socket.emit('stop_typing', { conversationId });
    } catch (e) { toast.error('Failed to send'); }
  };

  const sendImage = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const fd = new FormData();
    fd.append('image', file);
    fd.append('text', '');
    if (replyTo) fd.append('reply_to_id', replyTo.id);
    try {
      const token = localStorage.getItem('token');
      await axios.post(API + '/conversations/' + conversationId + '/messages', fd, { headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'multipart/form-data' } });
      setReplyTo(null);
    } catch (e) { toast.error('Failed to send image'); }
    e.target.value = '';
  };

  const deleteMessage = async (msgId) => {
    if (!confirm('Delete this message?')) return;
    try {
      const token = localStorage.getItem('token');
      await axios.delete(API + '/messages/' + msgId, { headers: { Authorization: 'Bearer ' + token } });
      setMessages(prev => prev.filter(m => m.id !== msgId));
    } catch (e) { toast.error(e.response?.data?.error || 'Failed to delete'); }
  };

  const startEdit = (msg) => {
    setEditingMsg({ id: msg.id, text: msg.text });
    setNewText(msg.text);
    setReplyTo(null);
    inputRef.current?.focus();
  };

  const cancelEdit = () => {
    setEditingMsg(null);
    setNewText('');
  };

  const startReply = (msg) => {
    setReplyTo({ id: msg.id, text: msg.text, username: msg.username, sender_id: msg.sender_id });
    setEditingMsg(null);
    setNewText('');
    inputRef.current?.focus();
  };

  const handleTypingInput = (val) => {
    setNewText(val);
    if (!socket || editingMsg) return;
    socket.emit('typing', { conversationId });
    clearTimeout(typingTimer.current);
    typingTimer.current = setTimeout(() => socket.emit('stop_typing', { conversationId }), 2000);
  };

  return (
    <div data-testid="chat-view" className="max-w-xl mx-auto h-[calc(100vh-60px)] md:h-screen flex flex-col bg-white">
      {/* Header */}
      <div className="p-3 border-b border-gray-200 flex items-center gap-3 shrink-0 bg-white">
        <ArrowLeft size={24} className="cursor-pointer" onClick={() => navigate('/messages')} />
        {otherUser && (
          <div data-testid="chat-header-profile" className="flex items-center gap-3 cursor-pointer" onClick={() => navigate('/u/' + otherUser.username)}>
            <div className="relative">
              <div className="w-10 h-10 rounded-full bg-gray-200 overflow-hidden">
                {otherUser.profile_pic ? <img src={otherUser.profile_pic} className="w-full h-full object-cover" /> : <User className="w-full h-full p-2 text-gray-400" />}
              </div>
              {isOnline && <div className="absolute bottom-0 right-0 w-2.5 h-2.5 bg-green-500 rounded-full border-2 border-white" />}
            </div>
            <div>
              <p className="font-bold text-sm leading-tight">{otherUser.username}</p>
              <p className="text-xs text-gray-400">{isOnline ? 'Active now' : lastActiveText(lastActive)}</p>
            </div>
          </div>
        )}
      </div>

      {/* Messages */}
      <div data-testid="chat-messages" className="chat-thread-surface flex-1 overflow-y-auto p-4 space-y-1">
        {messages.length === 0 && otherUser && (
          <div className="text-center mt-20">
            <div className="w-20 h-20 rounded-full bg-gray-200 overflow-hidden mx-auto mb-3">
              {otherUser.profile_pic ? <img src={otherUser.profile_pic} className="w-full h-full object-cover" /> : <User className="w-full h-full p-4 text-gray-400" />}
            </div>
            <p className="font-bold">{otherUser.username}</p>
            <p className="text-sm text-gray-400 mt-1">Start your conversation</p>
          </div>
        )}
        {messages.map((msg, idx) => {
          const isMine = parseInt(msg.sender_id) === parseInt(currentUser?.id);
          const showTime = idx === 0 || (new Date(msg.created_at) - new Date(messages[idx - 1]?.created_at)) > 300000;
          const withinLimit = canEditOrDelete(msg);
          return (
            <div data-testid="chat-message-row" data-message-id={msg.id} data-is-mine={isMine ? 'true' : 'false'} key={msg.id}>
              {showTime && (
                <p className="text-center text-xs text-gray-400 my-3">
                  {new Date(msg.created_at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                </p>
              )}
              <div className={'flex group ' + (isMine ? 'justify-end' : 'justify-start')}>
                <div className={'max-w-[70%] relative ' + (isMine ? 'order-1' : '')}>
                  {/* Reply preview */}
                  {msg.reply_to_id && msg.reply_text && (
                    <div
                      className={'text-xs px-3 py-1.5 rounded-t-2xl border-l-2 mb-0.5 cursor-pointer ' + (isMine ? 'bg-blue-600 border-blue-300 text-white/80' : 'bg-gray-100 border-gray-400 text-gray-600')}
                      onClick={() => {
                        const el = document.getElementById('msg-' + msg.reply_to_id);
                        if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); el.classList.add('ring-2', 'ring-blue-400'); setTimeout(() => el.classList.remove('ring-2', 'ring-blue-400'), 1500); }
                      }}
                    >
                      <span className="font-semibold">{msg.reply_username}</span>
                      <p className="truncate max-w-[200px]">{msg.reply_text}</p>
                    </div>
                  )}
                  {msg.image_url && (
                    <img
                      data-testid="chat-message-image"
                      src={msg.image_url}
                      id={'msg-' + msg.id}
                      className={'max-w-full rounded-2xl mb-1 cursor-pointer border transition-all ' + (isMine ? 'border-blue-200' : 'border-gray-200')}
                      onClick={() => window.open(msg.image_url, '_blank')}
                    />
                  )}
                  {msg.text && (
                    <div data-testid="chat-message-text" id={'msg-' + msg.id} className={'px-4 py-2.5 rounded-3xl text-sm leading-relaxed transition-all ' + (isMine ? 'bg-blue-500 text-white' : 'bg-gray-200 text-black')}>
                      {msg.text}
                    </div>
                  )}
                  <div className={'flex items-center gap-1 mt-0.5 flex-wrap ' + (isMine ? 'justify-end' : 'justify-start')}>
                    <span className="text-[10px] text-gray-400">{new Date(msg.created_at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}</span>
                    {msg.edited_at && (
                      <span
                        className="text-[10px] text-gray-400 cursor-pointer hover:underline"
                        onClick={() => setShowOriginal(showOriginal === msg.id ? null : msg.id)}
                      >
                        · edited
                      </span>
                    )}
                    {isMine && (msg.is_read ? <CheckCheck size={12} className="text-blue-500" /> : <Check size={12} className="text-gray-400" />)}
                  </div>
                  {/* Show original text popup */}
                  {showOriginal === msg.id && msg.original_text && (
                    <div className={'absolute z-10 p-2 rounded-lg shadow-lg border text-xs max-w-[250px] ' + (isMine ? 'right-0 bg-white text-gray-700 border-gray-200' : 'left-0 bg-white text-gray-700 border-gray-200')} style={{ top: '100%', marginTop: 4 }}>
                      <p className="font-semibold text-gray-500 mb-1">Original message:</p>
                      <p className="text-gray-800">{msg.original_text}</p>
                    </div>
                  )}
                  {/* Action buttons on hover (left side for own, right side for other's) */}
                  {isMine && (
                    <div className={'absolute top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-0.5 -left-[68px]'}>
                      {withinLimit && msg.text && (
                        <button data-testid="chat-message-edit" onClick={() => startEdit(msg)} className="p-1 hover:bg-gray-100 rounded-full" title="Edit">
                          <Pencil size={14} className="text-gray-400 hover:text-blue-500" />
                        </button>
                      )}
                      {withinLimit && (
                        <button data-testid="chat-message-delete" onClick={() => deleteMessage(msg.id)} className="p-1 hover:bg-gray-100 rounded-full" title="Delete">
                          <Trash2 size={14} className="text-gray-400 hover:text-red-500" />
                        </button>
                      )}
                      <button data-testid="chat-message-reply" onClick={() => startReply(msg)} className="p-1 hover:bg-gray-100 rounded-full" title="Reply">
                        <CornerUpLeft size={14} className="text-gray-400 hover:text-green-500" />
                      </button>
                    </div>
                  )}
                  {!isMine && (
                    <div className={'absolute top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity -right-8'}>
                      <button data-testid="chat-message-reply" onClick={() => startReply(msg)} className="p-1 hover:bg-gray-100 rounded-full" title="Reply">
                        <CornerUpLeft size={14} className="text-gray-400 hover:text-green-500" />
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
        {isTyping && (
          <div className="flex justify-start">
            <div className="bg-gray-200 px-4 py-3 rounded-3xl">
              <div className="flex gap-1">
                <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
            </div>
          </div>
        )}
        <div ref={endRef} />
      </div>

      {/* Reply / Edit banner above input */}
      {(replyTo || editingMsg) && (
        <div data-testid={replyTo ? 'chat-reply-banner' : 'chat-edit-banner'} className="chat-detail-surface px-4 py-2 border-t border-gray-100 flex items-center justify-between shrink-0">
          <div className="flex-1 min-w-0">
            {replyTo && (
              <div className="flex items-center gap-2">
                <CornerUpLeft size={16} className="text-blue-500 shrink-0" />
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-blue-500">Replying to {parseInt(replyTo.sender_id) === parseInt(currentUser?.id) ? 'yourself' : replyTo.username}</p>
                  <p className="text-xs text-gray-500 truncate">{replyTo.text || '📷 Photo'}</p>
                </div>
              </div>
            )}
            {editingMsg && (
              <div className="flex items-center gap-2">
                <Pencil size={16} className="text-blue-500 shrink-0" />
                <p className="text-xs font-semibold text-blue-500">Editing message</p>
              </div>
            )}
          </div>
          <button onClick={() => { setReplyTo(null); cancelEdit(); }} className="text-gray-400 hover:text-gray-600 shrink-0 ml-2">
            <X size={18} />
          </button>
        </div>
      )}

      {/* Input */}
      <div className="p-3 border-t border-gray-200 bg-white shrink-0">
        <form onSubmit={sendMessage} className="flex items-center gap-2 bg-gray-100 rounded-full px-4 py-1">
          {!editingMsg && (
            <button data-testid="chat-image-trigger" type="button" onClick={() => fileRef.current?.click()} className="shrink-0 text-gray-500 hover:text-gray-700">
              <ImageIcon size={24} />
            </button>
          )}
          <input
            data-testid="chat-input"
            ref={inputRef}
            type="text"
            placeholder={editingMsg ? "Edit message..." : "Message..."}
            className="flex-1 bg-transparent outline-none text-sm py-2"
            value={newText}
            onChange={e => handleTypingInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Escape') { setReplyTo(null); cancelEdit(); } }}
          />
          {newText.trim() && <button data-testid="chat-send-button" type="submit" className="text-blue-500 font-bold text-sm hover:text-blue-700 shrink-0">{editingMsg ? 'Save' : 'Send'}</button>}
        </form>
        <input data-testid="chat-image-input" ref={fileRef} type="file" className="hidden" accept="image/*" onChange={sendImage} />
      </div>
    </div>
  );
}

/* ========== IMAGE CAROUSEL ========== */
function ImageCarousel({ images }) {
  const [current, setCurrent] = useState(0);
  const imgs = images || [];
  if (imgs.length === 0) return <div className="bg-gray-100 w-full h-full flex items-center justify-center text-gray-400">No Image</div>;
  if (imgs.length === 1) return <img src={imgs[0]} className="w-full h-full object-contain bg-black" />;
  return (
    <div className="relative w-full h-full group bg-black">
      <div className="absolute inset-0 flex items-center justify-center">
        <img src={imgs[current]} className="max-w-full max-h-full object-contain" />
      </div>
      <button className="absolute top-1/2 left-2 -translate-y-1/2 bg-white/90 rounded-full p-1.5 cursor-pointer opacity-70 hover:opacity-100 shadow-md z-20 hover:scale-110 transition-all" onClick={e => { e.stopPropagation(); setCurrent(c => c === 0 ? imgs.length - 1 : c - 1); }}>
        <ChevronLeft size={16} />
      </button>
      <button className="absolute top-1/2 right-2 -translate-y-1/2 bg-white/90 rounded-full p-1.5 cursor-pointer opacity-70 hover:opacity-100 shadow-md z-20 hover:scale-110 transition-all" onClick={e => { e.stopPropagation(); setCurrent(c => c === imgs.length - 1 ? 0 : c + 1); }}>
        <ChevronRight size={16} />
      </button>
      <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex gap-1.5 z-20">
        {imgs.map((_, i) => <div key={i} className={'w-1.5 h-1.5 rounded-full transition-colors ' + (i === current ? 'bg-white' : 'bg-white/40')} />)}
      </div>
      <div className="absolute top-3 right-3 bg-black/60 text-white text-[10px] px-2 py-0.5 rounded-full z-20 font-bold backdrop-blur-sm">
        {current + 1}/{imgs.length}
      </div>
    </div>
  );
}

/* ========== IMAGE CROPPER ========== */
const createImage = (url) => new Promise((resolve, reject) => { const i = new Image(); i.onload = () => resolve(i); i.onerror = reject; i.src = url; });
async function getCroppedImg(src, crop) { const img = await createImage(src); const c = document.createElement('canvas'); const ctx = c.getContext('2d'); c.width = crop.width; c.height = crop.height; ctx.drawImage(img, crop.x, crop.y, crop.width, crop.height, 0, 0, crop.width, crop.height); return new Promise(r => c.toBlob(b => r(b), 'image/jpeg')); }

function ImageCropper({ imageSrc, onCropComplete, onCancel }) {
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState(null);
  const onCropDone = useCallback((_, px) => setCroppedAreaPixels(px), []);
  const handleSave = async () => { try { const blob = await getCroppedImg(imageSrc, croppedAreaPixels); onCropComplete(blob); } catch (e) { console.error(e); } };
  return (
    <div className="fixed inset-0 bg-black/60 z-[100] flex flex-col items-center justify-center p-4">
      <div className="bg-white w-full max-w-sm rounded-xl overflow-hidden flex flex-col h-[400px]">
        <div className="flex justify-between items-center p-3 border-b text-sm font-semibold">
          <button onClick={onCancel} className="text-red-500">Cancel</button>
          <span>Crop</span>
          <button onClick={handleSave} className="text-blue-500">Done</button>
        </div>
        <div className="relative flex-1 bg-gray-100 w-full">
          <Cropper image={imageSrc} crop={crop} zoom={zoom} aspect={1} cropShape="round" showGrid={false} onCropChange={setCrop} onZoomChange={setZoom} onCropComplete={onCropDone} />
        </div>
        <div className="p-3 flex items-center justify-center gap-4 bg-white">
          <ZoomOut size={16} className="text-gray-500" />
          <input type="range" value={zoom} min={1} max={3} step={0.1} onChange={e => setZoom(e.target.value)} className="w-full max-w-[150px] accent-black" />
          <ZoomIn size={16} className="text-gray-500" />
        </div>
      </div>
    </div>
  );
}

/* ========== PROFILE PHOTO MENU ========== */
function ProfilePhotoMenu({ onClose, onUploadClick, onRemoveClick }) {
  return (
    <div className="fixed inset-0 bg-black/65 z-[90] flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white w-[300px] rounded-xl overflow-hidden text-center divide-y divide-gray-200 shadow-xl" onClick={e => e.stopPropagation()}>
        <div className="p-6">
          <div className="w-14 h-14 mx-auto bg-gray-100 rounded-full mb-3 flex items-center justify-center"><User className="text-gray-400 w-7 h-7" /></div>
          <h2 className="text-lg font-bold">Sync Profile Photo</h2>
        </div>
        <button className="w-full p-3 text-blue-500 font-bold text-sm active:bg-gray-100" onClick={onUploadClick}>Upload Photo</button>
        <button className="w-full p-3 text-red-500 font-bold text-sm active:bg-gray-100" onClick={onRemoveClick}>Remove Current Photo</button>
        <button className="w-full p-3 text-sm active:bg-gray-100" onClick={onClose}>Cancel</button>
      </div>
    </div>
  );
}

/* ========== FEED ========== */
function Feed() {
  const PAGE_SIZE = 24;
  const [posts, setPosts] = useState([]);
  const [groupedStories, setGroupedStories] = useState({});
  const [selectedStoryGroup, setSelectedStoryGroup] = useState(null);
  const [selectedPost, setSelectedPost] = useState(null);
  const [isStoryUploadOpen, setIsStoryUploadOpen] = useState(false);
  const [isFeedLoading, setIsFeedLoading] = useState(false);
  const [hasMorePosts, setHasMorePosts] = useState(true);
  const [feedSeed, setFeedSeed] = useState(() => String(Date.now()));
  const [feedOffset, setFeedOffset] = useState(0);
  const currentUser = JSON.parse(localStorage.getItem('user'));

  const fetchStories = async () => {
    try {
      const token = localStorage.getItem('token');
      const storiesRes = await axios.get(API + '/stories', { headers: { Authorization: 'Bearer ' + token } });
      const groups = {};
      storiesRes.data.forEach(s => { if (!groups[s.username]) groups[s.username] = []; groups[s.username].push(s); });
      setGroupedStories(groups);
    } catch (e) { console.error(e); }
  };

  const fetchPosts = async ({ append = false, offset = 0, seed = feedSeed } = {}) => {
    try {
      setIsFeedLoading(true);
      const token = localStorage.getItem('token');
      const postsRes = await axios.get(API + '/posts', {
        headers: { Authorization: 'Bearer ' + token },
        params: { limit: PAGE_SIZE, offset, seed },
      });
      const nextPosts = postsRes.data || [];
      setPosts(prev => append ? [...prev, ...nextPosts.filter(post => !prev.some(existing => existing.id === post.id))] : nextPosts);
      setHasMorePosts(nextPosts.length === PAGE_SIZE);
      setFeedOffset(offset + nextPosts.length);
    } catch (e) {
      console.error(e);
    } finally {
      setIsFeedLoading(false);
    }
  };

  const refreshFeed = async () => {
    const nextSeed = String(Date.now());
    setFeedSeed(nextSeed);
    setFeedOffset(0);
    await fetchPosts({ append: false, offset: 0, seed: nextSeed });
  };

  const loadMorePosts = async () => {
    if (isFeedLoading || !hasMorePosts) return;
    await fetchPosts({ append: true, offset: feedOffset, seed: feedSeed });
  };

  const handleRecommendationSignal = () => {
    refreshFeed();
  };

  const handleInterestChange = (postId, feedback) => {
    if (feedback === 'not_interested') {
      setPosts(prev => prev.filter(post => post.id !== postId));
      setSelectedPost(current => current && current.id === postId ? null : current);
    }
  };

  useEffect(() => {
    fetchStories();
    refreshFeed();
  }, []);
  const myStories = currentUser && groupedStories[currentUser.username] ? groupedStories[currentUser.username] : [];

  return (
    <div data-testid="home-feed" className="pt-8 px-0 max-w-[470px] mx-auto w-full">
      <div className="flex gap-4 py-4 overflow-x-auto scrollbar-hide mb-2">
        <div className="flex flex-col items-center min-w-[66px] cursor-pointer relative">
          <div data-testid="story-bubble-own" className="w-[66px] h-[66px] rounded-full p-[2px] bg-gradient-to-tr from-yellow-400 to-fuchsia-600" onClick={() => myStories.length > 0 ? setSelectedStoryGroup(myStories) : setIsStoryUploadOpen(true)}>
            <div className="w-full h-full bg-white rounded-full p-[2px]">
              {currentUser?.profile_pic
                ? <img src={currentUser.profile_pic} className="w-full h-full object-cover rounded-full" />
                : <div className="w-full h-full bg-gray-100 rounded-full flex items-center justify-center"><User size={20} className="text-gray-400" /></div>}
            </div>
          </div>
              {myStories.length === 0 && (
            <div className="absolute bottom-4 right-0 bg-blue-500 text-white rounded-full p-0.5 border-2 border-white cursor-pointer" onClick={e => { e.stopPropagation(); setIsStoryUploadOpen(true); }}>
              <PlusSquare size={10} fill="white" className="text-blue-500" />
            </div>
          )}
          <span className="text-xs mt-1 truncate w-16 text-center text-gray-500">Your story</span>
        </div>
        {Object.keys(groupedStories).filter(u => u !== currentUser?.username).map(username => {
          const us = groupedStories[username];
          return (
            <div data-testid="story-bubble" data-username={username} key={username} className="flex flex-col items-center min-w-[66px] cursor-pointer" onClick={() => setSelectedStoryGroup(us)}>
              <div className="w-[66px] h-[66px] rounded-full p-[2px] bg-gradient-to-tr from-yellow-400 to-fuchsia-600">
                <div className="w-full h-full bg-white rounded-full p-[2px]">
                  {us[0].profile_pic ? <img src={us[0].profile_pic} className="w-full h-full object-cover rounded-full" /> : <User className="w-full h-full bg-gray-100 rounded-full" />}
                </div>
              </div>
              <span className="text-xs mt-1 truncate w-16 text-center">{username}</span>
            </div>
          );
        })}
      </div>
      <div className="flex items-center justify-between px-1 mb-3">
        <span className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">Recommended for you</span>
        <button data-testid="home-feed-refresh" type="button" onClick={refreshFeed} className="text-xs font-semibold text-blue-600 hover:text-blue-700">Refresh</button>
      </div>
      {posts.map(post => (
        <PostCard
          key={post.id}
          post={post}
          onImageClick={setSelectedPost}
          onInterestChange={handleInterestChange}
          onRecommendationSignal={handleRecommendationSignal}
        />
      ))}
      {!isFeedLoading && hasMorePosts && (
        <button
          type="button"
          onClick={loadMorePosts}
          className="w-full py-3 text-sm font-semibold text-blue-600 hover:text-blue-700"
        >
          Load more posts
        </button>
      )}
      {selectedPost && (
        <PostModal
          post={selectedPost}
          onClose={() => setSelectedPost(null)}
          onInterestChange={handleInterestChange}
          onRecommendationSignal={handleRecommendationSignal}
        />
      )}
      {selectedStoryGroup && <StoryViewer stories={selectedStoryGroup} onClose={() => setSelectedStoryGroup(null)} />}
      {isStoryUploadOpen && <UploadStoryModal onClose={() => setIsStoryUploadOpen(false)} onSuccess={fetchStories} />}
    </div>
  );
}

/* ========== STORY VIEWER ========== */
function StoryViewer({ stories, onClose }) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [progress, setProgress] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [storyLikeCount, setStoryLikeCount] = useState(0);
  const [storyCommentCount, setStoryCommentCount] = useState(0);
  const [storyLiked, setStoryLiked] = useState(false);
  const [storyComments, setStoryComments] = useState([]);
  const [storyCommentText, setStoryCommentText] = useState('');
  const navigate = useNavigate();
  const currentUser = JSON.parse(localStorage.getItem('user'));

  useEffect(() => { if (!stories || stories.length === 0) onClose(); }, [stories, onClose]);
  if (!stories || stories.length === 0) return null;
  const story = stories[currentIndex];
  if (!story) { onClose(); return null; }
  const isMyStory = currentUser && parseInt(currentUser.id) === parseInt(story.user_id);

  const loadInteractions = async () => {
    try {
      const token = localStorage.getItem('token');
      const res = await axios.get(API + '/stories/' + story.id + '/interactions', { headers: { Authorization: 'Bearer ' + token } });
      setStoryLikeCount(parseInt(res.data.like_count || 0));
      setStoryCommentCount(parseInt(res.data.comment_count || 0));
      setStoryLiked(Boolean(res.data.is_liked));
      setStoryComments(res.data.comments || []);
    } catch (e) { /* */ }
  };

  useEffect(() => { setProgress(0); }, [currentIndex]);
  useEffect(() => {
    setStoryCommentText('');
    loadInteractions();
  }, [story.id]);
  useEffect(() => {
    let iv;
    if (!isPaused) {
      iv = setInterval(() => {
        setProgress(prev => {
          if (prev >= 100) {
            if (currentIndex < stories.length - 1) { setCurrentIndex(c => c + 1); return 0; }
            else { onClose(); return 100; }
          }
          return prev + 1;
        });
      }, 50);
    }
    return () => clearInterval(iv);
  }, [isPaused, currentIndex, stories.length, onClose]);

  const goNext = (e) => { e.stopPropagation(); if (currentIndex < stories.length - 1) setCurrentIndex(c => c + 1); else onClose(); };
  const goPrev = (e) => { e.stopPropagation(); if (currentIndex > 0) setCurrentIndex(c => c - 1); };
  const deleteStory = async (e) => {
    e.stopPropagation(); if (!confirm('Delete this story?')) return;
    try { const token = localStorage.getItem('token'); await axios.delete(API + '/stories/' + story.id, { headers: { Authorization: 'Bearer ' + token } }); onClose(); window.location.reload(); } catch (e) { /* */ }
  };
  const toggleStoryLike = async (e) => {
    e.stopPropagation();
    try {
      const token = localStorage.getItem('token');
      const res = await axios.post(API + '/stories/' + story.id + '/like', {}, { headers: { Authorization: 'Bearer ' + token } });
      setStoryLiked(res.data.is_liked);
      setStoryLikeCount(parseInt(res.data.like_count || 0));
    } catch (e) { /* */ }
  };
  const postStoryComment = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!storyCommentText.trim()) return;
    try {
      const token = localStorage.getItem('token');
      const res = await axios.post(API + '/stories/' + story.id + '/comments', { text: storyCommentText }, { headers: { Authorization: 'Bearer ' + token } });
      setStoryComments(prev => [...prev, res.data.comment]);
      setStoryCommentCount(prev => prev + 1);
      setStoryCommentText('');
    } catch (e) { /* */ }
  };

  return (
    <div data-testid="story-viewer" className="fixed inset-0 bg-[#1a1a1a] z-[70] flex flex-col items-center justify-center" onMouseDown={() => setIsPaused(true)} onMouseUp={() => setIsPaused(false)}>
      <div className="absolute top-4 w-[90%] max-w-md h-0.5 bg-gray-600 flex gap-1 z-20">
        {stories.map((_, idx) => (
          <div key={idx} className="h-full flex-1 bg-gray-500 rounded overflow-hidden">
            <div className="h-full bg-white transition-all duration-100 linear" style={{ width: idx === currentIndex ? progress + '%' : idx < currentIndex ? '100%' : '0%' }} />
          </div>
        ))}
      </div>
      <div data-testid="story-viewer-profile" className="absolute top-8 left-4 flex items-center gap-2 text-white z-20 cursor-pointer" onClick={() => { onClose(); navigate('/u/' + story.username); }}>
        {story.profile_pic ? <img src={story.profile_pic} className="w-8 h-8 rounded-full border border-white/20" /> : <div className="w-8 h-8 rounded-full bg-gray-500 flex items-center justify-center"><User size={16} className="text-white" /></div>}
        <span className="font-semibold text-sm">{story.username}</span>
      </div>
      <X className="absolute top-6 right-4 text-white cursor-pointer hover:opacity-80 z-20" size={24} onClick={onClose} />
      {isMyStory && <div data-testid="story-delete" onClick={deleteStory} className="absolute bottom-6 right-6 z-50 p-2 bg-black/20 rounded-full cursor-pointer hover:bg-white/10"><Trash2 className="text-white w-5 h-5" /></div>}
      <div className="absolute inset-0 flex z-10">
        <div className="w-1/2 h-full cursor-pointer" onClick={goPrev} />
        <div className="w-1/2 h-full cursor-pointer" onClick={goNext} />
      </div>
      <img src={story.image_url} className="h-[85vh] w-auto max-w-full object-contain rounded-lg z-0" />
      <div data-testid="story-comments-panel" className="absolute bottom-24 left-1/2 z-20 w-[90%] max-w-md -translate-x-1/2 space-y-2">
        <div className="rounded-2xl bg-black/35 px-4 py-3 text-white backdrop-blur-sm">
          <div className="mb-2 flex items-center gap-4 text-xs font-semibold uppercase tracking-[0.18em] text-white/70">
            <span data-testid="story-like-count">{storyLikeCount} likes</span>
            <span data-testid="story-comment-count">{storyCommentCount} comments</span>
          </div>
          <div className="max-h-32 space-y-2 overflow-y-auto pr-1">
            {storyComments.length === 0 && <p className="text-xs text-white/60">No comments yet.</p>}
            {storyComments.map(comment => (
              <div data-testid="story-comment-row" data-comment-id={comment.id} key={comment.id} className="text-sm leading-tight">
                <span className="mr-2 font-semibold">{comment.username}</span>
                <span>{comment.text}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="absolute bottom-6 left-1/2 z-20 flex w-[90%] max-w-md -translate-x-1/2 items-center gap-3">
        <button data-testid="story-like-button" type="button" onClick={toggleStoryLike} className="rounded-full bg-black/35 p-3 text-white backdrop-blur-sm">
          <Heart size={20} className={storyLiked ? 'fill-red-500 text-red-500' : 'text-white'} />
        </button>
        <form data-testid="story-comment-form" onSubmit={postStoryComment} className="flex flex-1 items-center gap-2 rounded-full bg-black/35 px-4 py-2 backdrop-blur-sm" onClick={e => e.stopPropagation()}>
          <MessageCircle size={18} className="text-white/70" />
          <input
            data-testid="story-comment-input"
            type="text"
            placeholder="Reply to story..."
            className="flex-1 bg-transparent text-sm text-white outline-none placeholder:text-white/55"
            value={storyCommentText}
            onChange={e => setStoryCommentText(e.target.value)}
            onClick={e => e.stopPropagation()}
          />
          {storyCommentText.trim() && <button data-testid="story-comment-submit" type="submit" className="text-sm font-semibold text-blue-300">Send</button>}
        </form>
      </div>
    </div>
  );
}

function buildCommentThread(comments) {
  const nodes = new Map();
  (comments || []).forEach(comment => {
    nodes.set(comment.id, { ...comment, replies: [] });
  });

  const roots = [];
  (comments || []).forEach(comment => {
    const node = nodes.get(comment.id);
    if (comment.parent_comment_id && nodes.has(comment.parent_comment_id)) {
      nodes.get(comment.parent_comment_id).replies.push(node);
    } else {
      roots.push(node);
    }
  });

  return roots;
}

/* ========== COMMENT ITEM ========== */
function CommentItem({ comment, currentUserId, isPostOwner, onDelete, onReply, onPin, onEdit, depth = 0 }) {
  const navigate = useNavigate();
  const [liked, setLiked] = useState(comment.is_liked);
  const [count, setCount] = useState(parseInt(comment.like_count || 0));
  const [isEditing, setIsEditing] = useState(false);
  const [editText, setEditText] = useState(comment.text);
  const [displayText, setDisplayText] = useState(comment.text);
  const openProfile = () => navigate('/u/' + comment.username);
  const toggle = async () => { try { const token = localStorage.getItem('token'); await axios.post(API + '/comments/' + comment.id + '/like', {}, { headers: { Authorization: 'Bearer ' + token } }); setLiked(!liked); setCount(prev => !liked ? prev + 1 : prev - 1); } catch (e) { /* */ } };
  const canDelete = parseInt(currentUserId) === parseInt(comment.user_id) || isPostOwner;
  const canEdit = parseInt(currentUserId) === parseInt(comment.user_id) || isPostOwner;
  const handleSaveEdit = async () => {
    if (!editText.trim()) return;
    try {
      const token = localStorage.getItem('token');
      const res = await axios.put(API + '/comments/' + comment.id, { text: editText }, { headers: { Authorization: 'Bearer ' + token } });
      setDisplayText(res.data.text); setIsEditing(false);
      if (onEdit) onEdit(comment.id, res.data.text);
      toast.success('Comment updated');
    } catch (e) { toast.error('Failed to edit'); }
  };
  return (
    <div
      data-testid="comment-item"
      data-comment-id={comment.id}
      data-parent-comment-id={comment.parent_comment_id || ''}
      data-depth={depth}
      className={(depth > 0 ? 'ml-7 border-l border-gray-100 pl-3 ' : '') + 'flex flex-col'}
    >
      <div className={'flex justify-between items-start text-[14px] group py-1.5 ' + (comment.is_pinned ? 'bg-gray-50 -mx-2 px-2 rounded' : '')}>
      <div className="flex items-start gap-3 flex-1">
        <div className="w-8 h-8 rounded-full bg-gray-200 overflow-hidden shrink-0 cursor-pointer" onClick={openProfile}>
          {comment.profile_pic ? <img src={comment.profile_pic} className="w-full h-full object-cover" /> : <User className="p-1 text-gray-400" />}
        </div>
        <div className="flex-1">
          {isEditing ? (
            <div className="flex flex-col gap-1.5">
              <input type="text" value={editText} onChange={e => setEditText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') handleSaveEdit(); if (e.key === 'Escape') { setIsEditing(false); setEditText(displayText); } }} className="w-full text-sm border border-gray-300 rounded px-2 py-1 outline-none focus:border-gray-400" autoFocus />
              <div className="flex gap-2 text-xs">
                <button className="text-blue-500 font-bold" onClick={handleSaveEdit}>Save</button>
                <button className="text-gray-500 font-bold" onClick={() => { setIsEditing(false); setEditText(displayText); }}>Cancel</button>
              </div>
            </div>
          ) : (
            <p className="leading-tight">
              <span className="font-semibold mr-2 cursor-pointer hover:text-gray-600" onClick={openProfile}>{comment.username}</span>
              {comment.parent_username && <span className="text-gray-400 mr-2">replying to @{comment.parent_username}</span>}
              {displayText}
            </p>
          )}
          <div className="flex gap-3 mt-1 items-center text-[12px] text-gray-500 font-normal">
            {comment.created_at && <span>{new Date(comment.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>}
            {count > 0 && <span>{count} likes</span>}
            <span data-testid="comment-reply-button" className="cursor-pointer hover:text-gray-900" onClick={() => onReply(comment)}>Reply</span>
            {comment.is_pinned && <span className="flex items-center gap-0.5 text-gray-400"><Pin size={10} className="fill-gray-400" /></span>}
            <div className="hidden group-hover:flex gap-2 ml-1">
              {isPostOwner && <Pin size={12} className={'cursor-pointer ' + (comment.is_pinned ? 'text-black fill-black' : 'text-gray-400 hover:text-gray-600')} onClick={() => onPin(comment.id)} />}
              {canEdit && !isEditing && <Pencil size={12} onClick={() => setIsEditing(true)} className="cursor-pointer text-gray-400 hover:text-blue-500" />}
              {canDelete && <Trash2 size={12} onClick={() => onDelete(comment.id)} className="cursor-pointer text-gray-400 hover:text-red-500" />}
            </div>
          </div>
        </div>
      </div>
      <div className="flex flex-col items-center justify-center ml-2 pt-1 gap-1 w-4">
        <Heart data-testid="comment-like-button" size={12} className={'cursor-pointer ' + (liked ? 'fill-red-500 text-red-500' : 'text-gray-400 hover:text-gray-600')} onClick={toggle} />
        {comment.liked_by_author && (
          <div className="mt-1 relative w-3.5 h-3.5" title="Liked by author">
            <img src={comment.author_pic || 'https://via.placeholder.com/20'} className="w-full h-full rounded-full border border-gray-100" />
            <Heart size={5} className="absolute -bottom-0.5 -right-0.5 text-red-500 fill-red-500 bg-white rounded-full p-[0.5px]" />
          </div>
        )}
      </div>
    </div>
      {Array.isArray(comment.replies) && comment.replies.length > 0 && (
        <div className="space-y-1">
          {comment.replies.map(reply => (
            <CommentItem
              key={reply.id}
              comment={reply}
              currentUserId={currentUserId}
              isPostOwner={isPostOwner}
              onDelete={onDelete}
              onReply={onReply}
              onPin={onPin}
              onEdit={onEdit}
              depth={depth + 1}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/* ========== POST MODAL ========== */
function PostModal({ post, onClose, onInterestChange, onRecommendationSignal }) {
  const navigate = useNavigate();
  const [comments, setComments] = useState([]);
  const [newComment, setNewComment] = useState('');
  const [replyTarget, setReplyTarget] = useState(null);
  const [liked, setLiked] = useState(post.is_liked);
  const [likeCount, setLikeCount] = useState(parseInt(post.like_count || 0));
  const [commentCount, setCommentCount] = useState(parseInt(post.comment_count || 0));
  const [saved, setSaved] = useState(post.is_saved);
  const [interestFeedback, setInterestFeedback] = useState(post.interest_feedback || 'none');
  const [isEditing, setIsEditing] = useState(false);
  const [editCaption, setEditCaption] = useState(post.caption || '');
  const [displayCaption, setDisplayCaption] = useState(post.caption || '');
  const currentUser = JSON.parse(localStorage.getItem('user'));
  const isMyPost = parseInt(currentUser?.id) === parseInt(post.user_id);
  const inputRef = useRef(null);
  const images = Array.isArray(post.images) ? post.images : (post.image_url ? [post.image_url] : []);
  const threadedComments = buildCommentThread(comments);

  const fetchComments = async () => {
    try {
      const token = localStorage.getItem('token');
      const res = await axios.get(API + '/posts/' + post.id + '/comments', { headers: { Authorization: 'Bearer ' + token } });
      setComments(res.data);
      setCommentCount(res.data.length);
    } catch (e) { /* */ }
  };
  useEffect(() => { fetchComments(); }, [post.id]);
  const triggerRecommendationRefresh = () => {
    return;
  };
  const handleUpdatePost = async () => { try { const token = localStorage.getItem('token'); await axios.put(API + '/posts/' + post.id, { caption: editCaption }, { headers: { Authorization: 'Bearer ' + token } }); setDisplayCaption(editCaption); setIsEditing(false); toast.success('Updated'); } catch (e) { toast.error('Error'); } };
  const postComment = async (e) => {
    e.preventDefault();
    if (!newComment.trim()) return;
    try {
      const token = localStorage.getItem('token');
      await axios.post(API + '/posts/' + post.id + '/comments', {
        text: newComment,
        parent_comment_id: replyTarget?.id || null,
      }, { headers: { Authorization: 'Bearer ' + token } });
      await fetchComments();
      setNewComment('');
      setReplyTarget(null);
      triggerRecommendationRefresh();
    } catch (e) { /* */ }
  };
  const deleteComment = async (cid) => {
    if (!confirm('Delete?')) return;
    try {
      const token = localStorage.getItem('token');
      await axios.delete(API + '/comments/' + cid, { headers: { Authorization: 'Bearer ' + token } });
      await fetchComments();
      if (replyTarget?.id === cid) setReplyTarget(null);
    } catch (e) { /* */ }
  };
  const togglePin = async (cid) => { try { const token = localStorage.getItem('token'); await axios.put(API + '/comments/' + cid + '/pin', {}, { headers: { Authorization: 'Bearer ' + token } }); fetchComments(); } catch (e) { /* */ } };
  const toggleLike = async () => { try { const token = localStorage.getItem('token'); const res = await axios.post(API + '/posts/' + post.id + '/like', {}, { headers: { Authorization: 'Bearer ' + token } }); setLiked(res.data.status === 'liked'); setLikeCount(prev => res.data.status === 'liked' ? prev + 1 : prev - 1); triggerRecommendationRefresh(); } catch (e) { /* */ } };
  const toggleSave = async () => { try { const token = localStorage.getItem('token'); const res = await axios.post(API + '/posts/' + post.id + '/save', {}, { headers: { Authorization: 'Bearer ' + token } }); setSaved(res.data.status === 'saved'); toast.success(res.data.status === 'saved' ? 'Post saved' : 'Post unsaved'); triggerRecommendationRefresh(); } catch (e) { /* */ } };
  const deletePost = async () => { if (!confirm('Delete?')) return; try { const token = localStorage.getItem('token'); await axios.delete(API + '/posts/' + post.id, { headers: { Authorization: 'Bearer ' + token } }); onClose(); window.location.reload(); } catch (e) { /* */ } };
  const handleReply = (comment) => { setReplyTarget({ id: comment.id, username: comment.username, text: comment.text }); inputRef.current?.focus(); };
  const updateInterest = async (feedback) => {
    try {
      const token = localStorage.getItem('token');
      const nextFeedback = interestFeedback === feedback ? 'none' : feedback;
      const res = await axios.post(API + '/posts/' + post.id + '/interest', { feedback: nextFeedback }, { headers: { Authorization: 'Bearer ' + token } });
      setInterestFeedback(res.data.feedback);
      if (res.data.feedback === 'not_interested') {
        toast.success('We will show fewer posts like this.');
      } else if (res.data.feedback === 'interested') {
        toast.success('We will show more posts like this.');
      } else {
        toast.success('Preference cleared.');
      }
      if (onInterestChange) onInterestChange(post.id, res.data.feedback);
      triggerRecommendationRefresh();
      if (res.data.feedback === 'not_interested') onClose();
    } catch (e) {
      toast.error('Could not update preference');
    }
  };

  return (
    <div data-testid="post-modal" className="fixed inset-0 bg-black/60 z-[60] flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white w-full max-w-4xl h-[90vh] md:h-[80vh] rounded-r-lg overflow-hidden flex flex-col md:flex-row shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="w-full md:w-[55%] bg-black h-1/2 md:h-full shrink-0 relative">
          <ImageCarousel images={images} />
        </div>
        <div className="w-full md:w-[45%] flex flex-col h-1/2 md:h-full bg-white relative">
          <div className="p-3 border-b flex items-center justify-between sticky top-0 bg-white z-10 shrink-0">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-gray-200 overflow-hidden border border-gray-100">
                {post.profile_pic ? <img src={post.profile_pic} className="w-full h-full object-cover" /> : <User className="p-1 text-gray-400" />}
              </div>
              <span className="font-bold text-sm hover:opacity-70 cursor-pointer" onClick={() => { onClose(); navigate('/u/' + post.username); }}>{post.username}</span>
            </div>
            {isMyPost && (
              <div className="flex gap-3 text-gray-900">
                {!isEditing && <Pencil data-testid="post-modal-edit" size={18} className="cursor-pointer" onClick={() => setIsEditing(true)} />}
                <Trash2 data-testid="post-modal-delete" size={18} className="cursor-pointer hover:text-red-500" onClick={deletePost} />
              </div>
            )}
          </div>
          <div className="flex-1 overflow-y-auto p-4 scrollbar-thin scrollbar-thumb-gray-200">
            <div className="flex items-start gap-3 pb-4 border-b border-gray-100 mb-4">
              <div className="w-8 h-8 rounded-full bg-gray-200 overflow-hidden shrink-0">
                {post.profile_pic ? <img src={post.profile_pic} className="w-full h-full object-cover" /> : <User className="p-1 text-gray-400" />}
              </div>
              <div className="flex-1">
                {isEditing ? (
                  <div className="flex flex-col gap-2">
                    <textarea data-testid="post-modal-edit-caption" className="w-full p-2 border border-gray-300 rounded text-sm focus:outline-none resize-none" rows="2" value={editCaption} onChange={e => setEditCaption(e.target.value)} />
                    <div className="flex gap-2 justify-end">
                      <button data-testid="post-modal-edit-cancel" className="text-xs text-gray-500 font-bold" onClick={() => { setIsEditing(false); setEditCaption(displayCaption); }}>Cancel</button>
                      <button data-testid="post-modal-edit-save" className="text-xs text-blue-500 font-bold" onClick={handleUpdatePost}>Save</button>
                    </div>
                  </div>
                ) : (
                  <p className="leading-tight text-[14px]"><span className="font-bold mr-2 text-sm">{post.username}</span>{displayCaption}</p>
                )}
                <p className="text-[12px] text-gray-400 mt-2 font-normal">{new Date(post.created_at).toLocaleDateString(undefined, { month: 'long', day: 'numeric' })}</p>
              </div>
            </div>
            <div className="space-y-2">
              {threadedComments.map(c => (
                <CommentItem key={c.id} comment={c} currentUserId={currentUser?.id} isPostOwner={isMyPost} onDelete={deleteComment} onReply={handleReply} onPin={togglePin} onEdit={(id, text) => setComments(prev => prev.map(cm => cm.id === id ? { ...cm, text } : cm))} />
              ))}
            </div>
          </div>
          <div className="border-t p-3 bg-white sticky bottom-0 shrink-0">
            <div className="flex gap-4 mb-2">
              <div className="flex items-center gap-1.5">
                <Heart size={24} className={'cursor-pointer ' + (liked ? 'fill-red-500 text-red-500' : 'text-black hover:text-gray-500')} onClick={toggleLike} />
                <span className="text-sm font-semibold text-gray-700">{likeCount}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <MessageCircle size={24} className="cursor-pointer hover:text-gray-500" onClick={() => inputRef.current?.focus()} />
                <span className="text-sm font-semibold text-gray-700">{commentCount}</span>
              </div>
              <Send size={24} className="hover:text-gray-500" />
              <Bookmark size={24} className={'cursor-pointer hover:opacity-60 ml-auto ' + (saved ? 'fill-black text-black' : 'text-black')} onClick={toggleSave} />
            </div>
            {!isMyPost && (
              <div className="flex gap-2 mb-2">
                <button
                  data-testid="post-modal-interested"
                  type="button"
                  onClick={() => updateInterest('interested')}
                  className={'px-3 py-1 rounded-full text-xs font-semibold border transition-colors ' + (interestFeedback === 'interested' ? 'bg-green-50 border-green-500 text-green-700' : 'border-gray-300 text-gray-600 hover:border-gray-500')}
                >
                  Interested
                </button>
                <button
                  data-testid="post-modal-not-interested"
                  type="button"
                  onClick={() => updateInterest('not_interested')}
                  className={'px-3 py-1 rounded-full text-xs font-semibold border transition-colors ' + (interestFeedback === 'not_interested' ? 'bg-red-50 border-red-500 text-red-700' : 'border-gray-300 text-gray-600 hover:border-gray-500')}
                >
                  Not interested
                </button>
              </div>
            )}
            <p className="font-bold text-sm mb-2">{likeCount} likes</p>
            {replyTarget && (
              <div data-testid="post-modal-comment-reply-banner" className="mb-2 flex items-center justify-between rounded-xl bg-gray-50 px-3 py-2 text-xs text-gray-600">
                <div className="min-w-0">
                  <p className="font-semibold text-gray-700">Replying to @{replyTarget.username}</p>
                  <p className="truncate">{replyTarget.text}</p>
                </div>
                <button type="button" className="ml-3 text-gray-400 hover:text-gray-600" onClick={() => setReplyTarget(null)}>
                  <X size={14} />
                </button>
              </div>
            )}
            <form onSubmit={postComment} className="flex gap-2 items-center">
              <input data-testid="post-modal-comment-input" ref={inputRef} type="text" placeholder={replyTarget ? `Reply to @${replyTarget.username}...` : 'Add a comment...'} className="flex-1 text-sm outline-none h-10" value={newComment} onChange={e => setNewComment(e.target.value)} />
              <button data-testid="post-modal-comment-submit" className="text-blue-500 text-sm font-bold disabled:opacity-50 hover:text-blue-700" disabled={!newComment}>Post</button>
            </form>
          </div>
        </div>
      </div>
      <X data-testid="post-modal-close" className="absolute top-4 right-4 text-white cursor-pointer hover:opacity-80" size={28} onClick={onClose} />
    </div>
  );
}

/* ========== POST CARD ========== */
function PostCard({ post, onImageClick, onInterestChange, onRecommendationSignal }) {
  const navigate = useNavigate();
  const [liked, setLiked] = useState(post.is_liked);
  const [likeCount, setLikeCount] = useState(parseInt(post.like_count || 0));
  const [saved, setSaved] = useState(post.is_saved);
  const [commentCount, setCommentCount] = useState(parseInt(post.comment_count || 0));
  const [interestFeedback, setInterestFeedback] = useState(post.interest_feedback || 'none');
  const [showComments, setShowComments] = useState(false);
  const [comments, setComments] = useState([]);
  const [newComment, setNewComment] = useState('');
  const [replyTarget, setReplyTarget] = useState(null);
  const currentUser = JSON.parse(localStorage.getItem('user'));
  const isMyPost = parseInt(currentUser?.id) === parseInt(post.user_id);
  const inputRef = useRef(null);
  const images = Array.isArray(post.images) && post.images.length > 0 ? post.images : (post.image_url ? [post.image_url] : []);
  const threadedComments = buildCommentThread(comments);

  const loadComments = async () => {
    try {
      const token = localStorage.getItem('token');
      const res = await axios.get(API + '/posts/' + post.id + '/comments', { headers: { Authorization: 'Bearer ' + token } });
      setComments(res.data);
      setCommentCount(res.data.length);
    } catch (e) { /* */ }
  };

  const triggerRecommendationRefresh = () => {
    return;
  };

  const toggleLike = async () => {
    try {
      const token = localStorage.getItem('token');
      const res = await axios.post(API + '/posts/' + post.id + '/like', {}, { headers: { Authorization: 'Bearer ' + token } });
      setLiked(res.data.status === 'liked');
      setLikeCount(prev => res.data.status === 'liked' ? prev + 1 : prev - 1);
      triggerRecommendationRefresh();
    } catch (e) { /* */ }
  };
  const toggleSave = async () => {
    try {
      const token = localStorage.getItem('token');
      const res = await axios.post(API + '/posts/' + post.id + '/save', {}, { headers: { Authorization: 'Bearer ' + token } });
      setSaved(res.data.status === 'saved');
      toast.success(res.data.status === 'saved' ? 'Post saved' : 'Post unsaved');
      triggerRecommendationRefresh();
    } catch (e) { /* */ }
  };
  const toggleComments = async () => { if (!showComments) { await loadComments(); } setShowComments(!showComments); };
  const postComment = async (e) => {
    e.preventDefault();
    if (!newComment.trim()) return;
    try {
      const token = localStorage.getItem('token');
      await axios.post(API + '/posts/' + post.id + '/comments', {
        text: newComment,
        parent_comment_id: replyTarget?.id || null,
      }, { headers: { Authorization: 'Bearer ' + token } });
      await loadComments();
      setNewComment('');
      setReplyTarget(null);
      triggerRecommendationRefresh();
    } catch (e) { /* */ }
  };
  const deleteComment = async (cid) => {
    if (!confirm('Delete?')) return;
    try {
      const token = localStorage.getItem('token');
      await axios.delete(API + '/comments/' + cid, { headers: { Authorization: 'Bearer ' + token } });
      await loadComments();
      if (replyTarget?.id === cid) setReplyTarget(null);
    } catch (e) { /* */ }
  };
  const togglePin = async (cid) => { try { const token = localStorage.getItem('token'); await axios.put(API + '/comments/' + cid + '/pin', {}, { headers: { Authorization: 'Bearer ' + token } }); await loadComments(); } catch (e) { /* */ } };
  const handleReply = (comment) => { setReplyTarget({ id: comment.id, username: comment.username, text: comment.text }); setShowComments(true); inputRef.current?.focus(); };
  const updateInterest = async (feedback) => {
    try {
      const token = localStorage.getItem('token');
      const nextFeedback = interestFeedback === feedback ? 'none' : feedback;
      const res = await axios.post(API + '/posts/' + post.id + '/interest', { feedback: nextFeedback }, { headers: { Authorization: 'Bearer ' + token } });
      setInterestFeedback(res.data.feedback);
      if (res.data.feedback === 'not_interested') {
        toast.success('We will show fewer posts like this.');
      } else if (res.data.feedback === 'interested') {
        toast.success('We will show more posts like this.');
      } else {
        toast.success('Preference cleared.');
      }
      if (onInterestChange) onInterestChange(post.id, res.data.feedback);
      triggerRecommendationRefresh();
    } catch (e) {
      toast.error('Could not update preference');
    }
  };

  return (
    <div data-testid="feed-post-card" data-post-id={post.id} data-post-username={post.username} data-post-category={post.category || ''} className="mb-4 border-b border-gray-200 bg-white pb-4">
      <div className="flex items-center p-2 gap-2 mb-1" onClick={() => navigate('/u/' + post.username)}>
        <div className="w-8 h-8 rounded-full bg-gray-200 overflow-hidden cursor-pointer border border-gray-100">
          {post.profile_pic ? <img src={post.profile_pic} className="w-full h-full object-cover" /> : <User className="w-full h-full p-1 text-gray-500 bg-gray-100" />}
        </div>
        <span className="font-semibold text-sm cursor-pointer hover:opacity-70">{post.username}</span>
        <span className="text-gray-400 text-xs ml-auto">{new Date(post.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>
      </div>
      <div data-testid="feed-post-open" className="w-full aspect-[4/5] bg-black border border-gray-100 rounded-sm overflow-hidden cursor-pointer" onClick={() => onImageClick && onImageClick(post)}>
        <ImageCarousel images={images} />
      </div>
      <div className="pt-3">
        <div className="flex gap-4 items-center mb-2">
          <div className="flex items-center gap-1.5">
            <Heart data-testid="feed-post-like" size={24} className={'cursor-pointer hover:opacity-60 transition-opacity ' + (liked ? 'fill-red-500 text-red-500' : 'text-black')} onClick={toggleLike} />
            <span className="text-sm font-semibold text-gray-700">{likeCount}</span>
          </div>
          <div data-testid="feed-post-comments-toggle" className="flex items-center gap-1.5 cursor-pointer hover:opacity-60" onClick={toggleComments}>
            <MessageCircle size={24} />
            <span className="text-sm font-semibold text-gray-700">{commentCount}</span>
          </div>
          <Send size={24} className="hover:opacity-60" />
          <Bookmark data-testid="feed-post-save" size={24} className={'cursor-pointer hover:opacity-60 ml-auto ' + (saved ? 'fill-black text-black' : 'text-black')} onClick={toggleSave} />
        </div>
        {!isMyPost && (
          <div className="flex gap-2 mb-2">
            <button
              data-testid="feed-post-interested"
              type="button"
              onClick={() => updateInterest('interested')}
              className={'px-3 py-1 rounded-full text-xs font-semibold border transition-colors ' + (interestFeedback === 'interested' ? 'bg-green-50 border-green-500 text-green-700' : 'border-gray-300 text-gray-600 hover:border-gray-500')}
            >
              Interested
            </button>
            <button
              data-testid="feed-post-not-interested"
              type="button"
              onClick={() => updateInterest('not_interested')}
              className={'px-3 py-1 rounded-full text-xs font-semibold border transition-colors ' + (interestFeedback === 'not_interested' ? 'bg-red-50 border-red-500 text-red-700' : 'border-gray-300 text-gray-600 hover:border-gray-500')}
            >
              Not interested
            </button>
          </div>
        )}
        <p className="font-bold text-sm mb-1">{likeCount} likes</p>
        <p className="text-sm leading-tight mb-1"><span className="font-bold mr-2">{post.username}</span>{post.caption}</p>
        {commentCount > 0 && <p className="text-gray-500 text-sm cursor-pointer mb-2" onClick={toggleComments}>View all {commentCount} comments</p>}
        {showComments && (
          <div className="mt-2">
            <div className="max-h-60 overflow-y-auto space-y-1 mb-2 pr-1">
              {threadedComments.map(c => (
                <CommentItem key={c.id} comment={c} currentUserId={currentUser?.id} isPostOwner={isMyPost} onDelete={deleteComment} onReply={handleReply} onPin={togglePin} onEdit={(id, text) => setComments(prev => prev.map(cm => cm.id === id ? { ...cm, text } : cm))} />
              ))}
            </div>
            {replyTarget && (
              <div data-testid="feed-post-comment-reply-banner" className="mb-2 flex items-center justify-between rounded-xl bg-gray-50 px-3 py-2 text-xs text-gray-600">
                <div className="min-w-0">
                  <p className="font-semibold text-gray-700">Replying to @{replyTarget.username}</p>
                  <p className="truncate">{replyTarget.text}</p>
                </div>
                <button type="button" className="ml-3 text-gray-400 hover:text-gray-600" onClick={() => setReplyTarget(null)}>
                  <X size={14} />
                </button>
              </div>
            )}
            <form onSubmit={postComment} className="flex gap-2">
              <input data-testid="feed-post-comment-input" ref={inputRef} type="text" placeholder={replyTarget ? `Reply to @${replyTarget.username}...` : 'Add a comment...'} className="flex-1 text-sm outline-none border-b border-transparent focus:border-gray-300" value={newComment} onChange={e => setNewComment(e.target.value)} />
              <button data-testid="feed-post-comment-submit" className="text-blue-500 text-sm font-bold disabled:opacity-50 hover:text-blue-700" disabled={!newComment}>Post</button>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}

/* ========== UPLOAD MODAL ========== */
function UploadModal({ onClose, onSuccess }) {
  const [caption, setCaption] = useState('');
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(false);
  const handleUpload = async (e) => {
    e.preventDefault();
    if (files.length === 0) return toast.error('Select images');
    if (files.length > 10) return toast.error('Max 10 images');
    const fd = new FormData();
    for (let i = 0; i < files.length; i++) fd.append('images', files[i]);
    fd.append('caption', caption);
    try {
      setLoading(true);
      const token = localStorage.getItem('token');
      await axios.post(API + '/posts', fd, { headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'multipart/form-data' } });
      toast.success('Shared');
      onSuccess();
    } catch (e) { toast.error('Failed'); } finally { setLoading(false); }
  };
  return (
    <div data-testid="upload-modal" className="fixed inset-0 bg-black/60 z-[60] flex items-center justify-center p-4">
      <div className="bg-white rounded-xl w-full max-w-sm overflow-hidden animate-in fade-in zoom-in duration-200">
        <div className="border-b p-2 flex justify-between items-center">
          <button onClick={onClose} className="text-gray-500 p-2"><X size={20} /></button>
          <span className="font-bold text-sm">Create new post</span>
          <button data-testid="upload-submit" onClick={handleUpload} className="text-blue-500 font-bold text-sm p-2 hover:text-blue-700" disabled={loading}>{loading ? 'Sharing...' : 'Share'}</button>
        </div>
        <div className="p-4 space-y-4">
          <div className="flex flex-col items-center justify-center border border-gray-200 rounded-lg p-10 bg-gray-50">
            <input data-testid="upload-file-input" type="file" multiple onChange={e => setFiles(e.target.files)} className="w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100" accept="image/*" />
            <span className="text-xs text-gray-400 mt-2">{files.length} selected (Max 10)</span>
          </div>
          <textarea data-testid="upload-caption-input" placeholder="Write a caption..." className="w-full p-2 text-sm outline-none resize-none h-24" onChange={e => setCaption(e.target.value)} />
        </div>
      </div>
    </div>
  );
}

/* ========== UPLOAD STORY MODAL ========== */
function UploadStoryModal({ onClose, onSuccess }) {
  const [file, setFile] = useState(null);
  const [loading, setLoading] = useState(false);
  const handleUpload = async (e) => {
    e.preventDefault(); if (!file) return;
    const fd = new FormData(); fd.append('image', file);
    try { setLoading(true); const token = localStorage.getItem('token'); await axios.post(API + '/stories', fd, { headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'multipart/form-data' } }); toast.success('Added to story'); onSuccess(); onClose(); } catch (e) { /* */ } finally { setLoading(false); }
  };
  return (
    <div data-testid="story-upload-modal" className="fixed inset-0 bg-black/65 z-[80] flex items-center justify-center p-4">
      <div className="bg-white rounded-xl w-full max-w-sm p-4">
        <div className="flex justify-between mb-4 items-center">
          <h2 className="font-bold text-md">Add to Story</h2>
          <X className="cursor-pointer" onClick={onClose} size={20} />
        </div>
        <form onSubmit={handleUpload} className="space-y-4">
          <input data-testid="story-upload-input" type="file" onChange={e => setFile(e.target.files[0])} accept="image/*" className="w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100" />
          <button data-testid="story-upload-submit" disabled={loading} className="w-full bg-[#0095f6] text-white py-2 rounded-lg font-bold text-sm hover:bg-[#1877f2]">{loading ? 'Uploading...' : 'Share'}</button>
        </form>
      </div>
    </div>
  );
}

/* ========== SETTINGS MODAL ========== */
function SettingsModal({ onClose, isPrivate, followerCount, onTogglePrivacy, onManageFollowers }) {
  return (
    <div data-testid="settings-modal" className="fixed inset-0 bg-black/50 z-[90] flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl w-full max-w-sm overflow-hidden shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="p-4 border-b flex justify-between items-center">
          <div className="w-6" />
          <span className="font-bold text-base">Settings</span>
          <X className="cursor-pointer hover:text-gray-500" size={20} onClick={onClose} />
        </div>
        <div className="p-4 space-y-4">
          <div className="flex items-center justify-between p-3 rounded-lg hover:bg-gray-50">
            <div className="flex items-center gap-3">
              <Lock size={20} className={isPrivate ? 'text-black' : 'text-gray-400'} />
              <div>
                <p className="font-semibold text-sm">Private Account</p>
                <p className="text-xs text-gray-500">Only approved followers can see your posts</p>
              </div>
            </div>
            <button data-testid="settings-private-toggle" onClick={onTogglePrivacy} className={'relative w-11 h-6 rounded-full transition-colors ' + (isPrivate ? 'bg-blue-500' : 'bg-gray-300')}>
              <div className={'absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ' + (isPrivate ? 'translate-x-[22px]' : 'translate-x-0.5')} />
            </button>
          </div>
          {isPrivate && (
            <button data-testid="settings-manage-followers" type="button" onClick={onManageFollowers} className="flex w-full items-center justify-between rounded-lg p-3 text-left hover:bg-gray-50">
              <div className="flex items-center gap-3">
                <UserCircle size={20} className="text-gray-600" />
                <div>
                  <p className="font-semibold text-sm">Manage Followers</p>
                  <p className="text-xs text-gray-500">Remove followers from your private account</p>
                </div>
              </div>
              <span className="text-xs font-semibold text-gray-400">{followerCount || 0}</span>
            </button>
          )}
        </div>
        <div className="border-t p-3">
          <button onClick={onClose} className="w-full text-center text-sm text-gray-500 py-2 hover:text-gray-700">Done</button>
        </div>
      </div>
    </div>
  );
}

/* ========== USER LIST MODAL ========== */
function UserListModal({ userId, type, onClose, isOwnProfile, onFollowerRemoved, onFollowingRemoved }) {
  const [users, setUsers] = useState([]);
  const navigate = useNavigate();
  useEffect(() => {
    (async () => {
      const token = localStorage.getItem('token');
      const res = await axios.get(API + '/users/' + userId + '/' + type, { headers: { Authorization: 'Bearer ' + token } });
      setUsers(res.data);
    })();
  }, [userId, type]);
  const removeFollower = async (e, fid) => {
    e.stopPropagation();
    if (!confirm('Remove this follower?')) return;
    try {
      const token = localStorage.getItem('token');
      await axios.delete(API + '/followers/' + fid, { headers: { Authorization: 'Bearer ' + token } });
      setUsers(prev => prev.filter(u => u.id !== fid));
      if (onFollowerRemoved) onFollowerRemoved();
      toast.success('Follower removed');
    } catch (e) { toast.error('Failed to remove'); }
  };
  const unfollowUser = async (e, followingId) => {
    e.stopPropagation();
    if (!confirm('Unfollow this account?')) return;
    try {
      const token = localStorage.getItem('token');
      const res = await axios.post(API + '/follow/' + followingId, {}, { headers: { Authorization: 'Bearer ' + token } });
      if (res.data.status === 'none') {
        setUsers(prev => prev.filter(u => u.id !== followingId));
        if (onFollowingRemoved) onFollowingRemoved();
        toast.success('Unfollowed');
      }
    } catch (e) { toast.error('Failed to unfollow'); }
  };
  return (
    <div data-testid={`user-list-modal-${type}`} className="fixed inset-0 bg-black/50 z-[80] flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl w-full max-w-sm max-h-[400px] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="p-3 border-b flex justify-between items-center font-bold text-center border-gray-200">
          <div className="w-6" />
          <span className="capitalize">{type}</span>
          <X className="cursor-pointer" size={20} onClick={onClose} />
        </div>
        <div className="flex-1 overflow-y-auto p-2">
          {users.map(u => (
            <div data-testid="user-list-row" data-user-id={u.id} data-username={u.username} key={u.id} className="flex items-center justify-between p-2 hover:bg-gray-50 rounded-lg cursor-pointer" onClick={() => { onClose(); navigate('/u/' + u.username); }}>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-gray-200 overflow-hidden">
                  {u.profile_pic ? <img src={u.profile_pic} className="w-full h-full object-cover" /> : <User className="w-full h-full p-2 text-gray-400" />}
                </div>
                <span className="font-semibold text-sm">{u.username}</span>
              </div>
              {isOwnProfile && type === 'followers' && (
                <button data-testid="user-list-remove-follower" onClick={e => removeFollower(e, u.id)} className="bg-gray-100 px-4 py-1.5 rounded-lg text-xs font-semibold hover:bg-gray-200">Remove</button>
              )}
              {isOwnProfile && type === 'following' && (
                <button data-testid="user-list-unfollow-following" onClick={e => unfollowUser(e, u.id)} className="bg-gray-100 px-4 py-1.5 rounded-lg text-xs font-semibold hover:bg-gray-200">Unfollow</button>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function PreferenceGridSection({ title, description, posts, emptyMessage, onOpen, onReset }) {
  return (
    <section data-testid={`preferences-section-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`} className="space-y-3">
      <div>
        <h3 className="text-sm font-bold uppercase tracking-[0.18em] text-gray-700">{title}</h3>
        <p className="text-sm text-gray-500 mt-1">{description}</p>
      </div>
      {posts.length === 0 ? (
        <div className="border border-dashed border-gray-300 rounded-2xl py-12 text-center text-sm text-gray-400">{emptyMessage}</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {posts.map(post => {
            const image = post.images && post.images.length > 0 ? post.images[0] : post.image_url;
            return (
              <div data-testid="preference-post-card" data-post-id={post.id} data-post-category={post.category || ''} key={post.id} className="rounded-2xl overflow-hidden border border-gray-200 bg-white">
                <button data-testid="preference-post-open" type="button" onClick={() => onOpen(post)} className="block w-full aspect-square bg-gray-100 overflow-hidden">
                  <img src={image} className="w-full h-full object-cover" />
                </button>
                <div className="p-3 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-sm truncate">{post.username}</span>
                    <span className="text-[11px] uppercase tracking-[0.18em] text-gray-400">{post.category}</span>
                  </div>
                  <p className="text-sm text-gray-600 line-clamp-3">{post.caption}</p>
                  <button
                    data-testid="preference-reset"
                    type="button"
                    onClick={() => onReset(post.id)}
                    className="w-full rounded-xl border border-gray-300 px-3 py-2 text-xs font-semibold text-gray-700 hover:border-gray-500"
                  >
                    Reset to neutral
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function LikedMediaGrid({ posts, onOpen, onUnlike }) {
  if (posts.length === 0) {
    return <div className="border border-dashed border-gray-300 rounded-2xl py-12 text-center text-sm text-gray-400">Posts you like will show up here so you can review or remove them later.</div>;
  }

  return (
    <div data-testid="profile-liked-grid" className="grid grid-cols-1 md:grid-cols-2 gap-4 py-6">
      {posts.map(post => {
        const image = post.images && post.images.length > 0 ? post.images[0] : post.image_url;
        return (
          <article data-testid="profile-liked-card" data-post-id={post.id} key={post.id} className="overflow-hidden rounded-2xl border border-gray-200 bg-white">
            <button data-testid="profile-liked-open" type="button" onClick={() => onOpen(post)} className="block w-full aspect-square bg-gray-100 overflow-hidden">
              <img src={image} className="w-full h-full object-cover" />
            </button>
            <div className="space-y-3 p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{post.username}</p>
                  <p className="text-xs uppercase tracking-[0.18em] text-gray-400">{post.category || 'Post'}</p>
                </div>
                <span className="shrink-0 text-xs text-gray-400">{post.liked_at ? timeAgo(post.liked_at) : ''}</span>
              </div>
              <p className="line-clamp-3 text-sm leading-relaxed text-gray-600">{post.caption || 'No caption'}</p>
              <div className="flex items-center justify-between text-xs text-gray-500">
                <span>{post.like_count} likes</span>
                <span>{post.comment_count} comments</span>
              </div>
              <button
                data-testid="profile-liked-remove"
                type="button"
                onClick={() => onUnlike(post.id)}
                className="w-full rounded-xl border border-gray-300 px-3 py-2 text-xs font-semibold text-gray-700 hover:border-gray-500"
              >
                Remove like
              </button>
            </div>
          </article>
        );
      })}
    </div>
  );
}

function CommentedMediaList({ posts, onOpen, onDeleteComment }) {
  if (posts.length === 0) {
    return <div className="border border-dashed border-gray-300 rounded-2xl py-12 text-center text-sm text-gray-400">Posts you comment on will appear here with the exact comments you left.</div>;
  }

  return (
    <div data-testid="profile-commented-list" className="space-y-4 py-6">
      {posts.map(post => {
        const image = post.images && post.images.length > 0 ? post.images[0] : post.image_url;
        const comments = Array.isArray(post.my_comments) ? post.my_comments : [];
        return (
          <article data-testid="profile-commented-card" data-post-id={post.id} key={post.id} className="overflow-hidden rounded-2xl border border-gray-200 bg-white">
            <div className="flex flex-col md:flex-row">
              <button
                data-testid="profile-commented-open"
                type="button"
                onClick={() => onOpen(post)}
                className="aspect-square w-full bg-gray-100 md:w-52 md:shrink-0"
              >
                <img src={image} className="h-full w-full object-cover" />
              </button>
              <div className="flex-1 space-y-4 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">{post.username}</p>
                    <p className="text-xs uppercase tracking-[0.18em] text-gray-400">{post.category || 'Post'}</p>
                  </div>
                  <div className="text-right text-xs text-gray-400">
                    <p>{post.my_comment_count} {post.my_comment_count === 1 ? 'comment' : 'comments'}</p>
                    <p>{post.latest_comment_at ? timeAgo(post.latest_comment_at) : ''}</p>
                  </div>
                </div>
                <p className="line-clamp-2 text-sm text-gray-600">{post.caption || 'No caption'}</p>
                <div className="space-y-2">
                  {comments.map(comment => (
                    <div
                      data-testid="profile-commented-comment"
                      data-comment-id={comment.id}
                      key={comment.id}
                      className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm leading-relaxed text-gray-700">{comment.text}</p>
                          <p className="mt-1 text-[11px] uppercase tracking-[0.18em] text-gray-400">{comment.created_at ? timeAgo(comment.created_at) : ''}</p>
                        </div>
                        <button
                          data-testid="profile-commented-delete-comment"
                          type="button"
                          onClick={() => onDeleteComment(comment.id)}
                          className="shrink-0 rounded-lg border border-gray-300 p-2 text-gray-500 hover:border-red-400 hover:text-red-500"
                          title="Delete comment"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </article>
        );
      })}
    </div>
  );
}

/* ========== PUBLIC PROFILE ========== */
function PublicProfile({ currentUser }) {
  const { username } = useParams();
  const [profileData, setProfileData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selectedPost, setSelectedPost] = useState(null);
  const [showUserList, setShowUserList] = useState(null);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [imageToCrop, setImageToCrop] = useState(null);
  const fileInputRef = useRef(null);
  const [activeTab, setActiveTab] = useState('posts');
  const [savedPosts, setSavedPosts] = useState([]);
  const [likedPosts, setLikedPosts] = useState([]);
  const [commentedPosts, setCommentedPosts] = useState([]);
  const [preferencePosts, setPreferencePosts] = useState({ interested: [], not_interested: [] });
  const [preferencesLoading, setPreferencesLoading] = useState(false);
  const [activityLoading, setActivityLoading] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const navigate = useNavigate();
  const isMe = currentUser.username === profileData?.user?.username;

  useEffect(() => {
    (async () => {
      setLoading(true); setActiveTab('posts');
      try { const token = localStorage.getItem('token'); const res = await axios.get(API + '/users/' + username, { headers: { Authorization: 'Bearer ' + token } }); setProfileData(res.data); } catch (e) { /* */ }
      finally { setLoading(false); }
    })();
  }, [username]);

  useEffect(() => {
    if (activeTab !== 'saved') return;
    (async () => { try { const token = localStorage.getItem('token'); const res = await axios.get(API + '/saved', { headers: { Authorization: 'Bearer ' + token } }); setSavedPosts(res.data); } catch (e) { /* */ } })();
  }, [activeTab]);

  const fetchInteractionPosts = async (type) => {
    if (!isMe) return;
    try {
      setActivityLoading(true);
      const token = localStorage.getItem('token');
      const res = await axios.get(API + `/me/interactions/${type}`, { headers: { Authorization: 'Bearer ' + token } });
      if (type === 'liked') {
        setLikedPosts(res.data);
      } else {
        setCommentedPosts(res.data);
      }
    } catch (e) {
      toast.error(`Could not load ${type} posts`);
    } finally {
      setActivityLoading(false);
    }
  };

  useEffect(() => {
    if (!isMe || !['liked', 'commented'].includes(activeTab)) return;
    fetchInteractionPosts(activeTab);
  }, [activeTab, isMe, username]);

  const fetchPreferencePosts = async () => {
    if (!isMe) return;
    try {
      setPreferencesLoading(true);
      const token = localStorage.getItem('token');
      const [interestedRes, notInterestedRes] = await Promise.all([
        axios.get(API + '/me/interest-feedback?feedback=interested', { headers: { Authorization: 'Bearer ' + token } }),
        axios.get(API + '/me/interest-feedback?feedback=not_interested', { headers: { Authorization: 'Bearer ' + token } }),
      ]);
      setPreferencePosts({
        interested: interestedRes.data,
        not_interested: notInterestedRes.data,
      });
    } catch (e) {
      toast.error('Could not load preferences');
    } finally {
      setPreferencesLoading(false);
    }
  };

  useEffect(() => {
    if (activeTab !== 'preferences' || !isMe) return;
    fetchPreferencePosts();
  }, [activeTab, isMe, username]);

  const onFileSelect = (e) => { if (e.target.files?.length > 0) { const r = new FileReader(); r.readAsDataURL(e.target.files[0]); r.onload = () => { setImageToCrop(r.result); setIsMenuOpen(false); }; } };
  const onCropComplete = async (blob) => { setImageToCrop(null); const fd = new FormData(); fd.append('image', blob); try { const token = localStorage.getItem('token'); const res = await axios.put(API + '/users/avatar', fd, { headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'multipart/form-data' } }); updateLocalUser(res.data.profile_pic); toast.success('Updated'); } catch (e) { toast.error('Error'); } };
  const onRemovePhoto = async () => { if (!confirm('Remove?')) return; try { const token = localStorage.getItem('token'); await axios.delete(API + '/users/avatar', { headers: { Authorization: 'Bearer ' + token } }); updateLocalUser(null); setIsMenuOpen(false); toast.success('Removed'); } catch (e) { toast.error('Error'); } };
  const updateLocalUser = (newPic) => { setProfileData(prev => ({ ...prev, user: { ...prev.user, profile_pic: newPic } })); const su = JSON.parse(localStorage.getItem('user')); su.profile_pic = newPic; localStorage.setItem('user', JSON.stringify(su)); window.location.reload(); };

  const toggleFollow = async () => {
    try {
      const token = localStorage.getItem('token');
      const prevStatus = profileData.user.follow_status;
      const res = await axios.post(API + '/follow/' + profileData.user.id, {}, { headers: { Authorization: 'Bearer ' + token } });
      const newStatus = res.data.status;
      let delta = 0;
      if (prevStatus === 'accepted' && newStatus === 'none') delta = -1;
      else if (prevStatus !== 'accepted' && newStatus === 'accepted') delta = 1;
      setProfileData(prev => ({
        ...prev,
        user: { ...prev.user, follow_status: newStatus, followers_count: parseInt(prev.user.followers_count) + delta },
        ...(newStatus === 'none' && prev.user.is_private ? { restricted: true, posts: [] } : {})
      }));
      toast.success(newStatus === 'pending' ? 'Requested' : newStatus === 'accepted' ? 'Followed' : 'Unfollowed');
    } catch (e) { toast.error('Error'); }
  };

  const togglePrivacy = async () => {
    try { const token = localStorage.getItem('token'); const res = await axios.put(API + '/users/privacy', {}, { headers: { Authorization: 'Bearer ' + token } }); setProfileData(prev => ({ ...prev, user: { ...prev.user, is_private: res.data.is_private } })); toast.success(res.data.is_private ? 'Account is now Private' : 'Account is now Public'); } catch (e) { /* */ }
  };

  const startChat = async () => {
    try { const token = localStorage.getItem('token'); const res = await axios.post(API + '/conversations', { userId: profileData.user.id }, { headers: { Authorization: 'Bearer ' + token } }); navigate('/messages/' + res.data.conversation_id); } catch (e) { toast.error('Could not start chat'); }
  };

  const resetPreference = async (postId) => {
    try {
      const token = localStorage.getItem('token');
      await axios.post(API + '/posts/' + postId + '/interest', { feedback: 'none' }, { headers: { Authorization: 'Bearer ' + token } });
      setPreferencePosts(prev => ({
        interested: prev.interested.filter(post => post.id !== postId),
        not_interested: prev.not_interested.filter(post => post.id !== postId),
      }));
      if (selectedPost?.id === postId) setSelectedPost(null);
      toast.success('Preference reset to neutral');
    } catch (e) {
      toast.error('Could not reset preference');
    }
  };

  const removeLikedPost = async (postId) => {
    try {
      const token = localStorage.getItem('token');
      const res = await axios.post(API + '/posts/' + postId + '/like', {}, { headers: { Authorization: 'Bearer ' + token } });
      if (res.data.status === 'unliked') {
        setLikedPosts(prev => prev.filter(post => post.id !== postId));
        if (selectedPost?.id === postId) setSelectedPost(null);
        toast.success('Like removed');
      }
    } catch (e) {
      toast.error('Could not remove like');
    }
  };

  const removeCommentFootprint = async (commentId) => {
    if (!confirm('Delete this comment from your activity?')) return;
    try {
      const token = localStorage.getItem('token');
      await axios.delete(API + '/comments/' + commentId, { headers: { Authorization: 'Bearer ' + token } });
      if (selectedPost) {
        setSelectedPost(null);
      }
      await fetchInteractionPosts('commented');
      toast.success('Comment deleted');
    } catch (e) {
      toast.error('Could not delete comment');
    }
  };

  if (loading) return <div className="p-10 text-center text-sm">Loading...</div>;
  if (!profileData) return <div className="p-10 text-center text-red-500 text-sm">User not found</div>;

  return (
    <div data-testid="profile-page" className="pb-10 pt-8 px-8 max-w-4xl mx-auto">
      {imageToCrop && <ImageCropper imageSrc={imageToCrop} onCropComplete={onCropComplete} onCancel={() => setImageToCrop(null)} />}
      {isMenuOpen && <ProfilePhotoMenu onClose={() => setIsMenuOpen(false)} onUploadClick={() => fileInputRef.current.click()} onRemoveClick={onRemovePhoto} />}
      <input type="file" ref={fileInputRef} className="hidden" onChange={onFileSelect} accept="image/*" />

      <div className="flex flex-col md:flex-row items-start md:items-center gap-8 md:gap-24 border-b border-gray-200 pb-12 mb-12 ml-4">
        <div className="relative group w-20 h-20 md:w-[150px] md:h-[150px] rounded-full bg-gray-100 overflow-hidden ring-1 ring-gray-200 p-1 cursor-pointer mx-auto md:mx-0" onClick={() => isMe && setIsMenuOpen(true)}>
          {profileData.user.profile_pic ? <img src={profileData.user.profile_pic} className="w-full h-full object-cover rounded-full aspect-square" /> : <User className="w-full h-full p-2 text-gray-300 aspect-square" />}
        </div>
        <div className="flex-1 space-y-5">
          <div className="flex flex-col md:flex-row items-center gap-4">
            <h2 className="text-xl font-normal">{profileData.user.username}</h2>
            {!isMe ? (
              <div className="flex gap-2">
                <button
                  data-testid="profile-follow-button"
                  onClick={() => { if (profileData.user.follow_status === 'accepted') { if (confirm('Unfollow @' + profileData.user.username + '?')) toggleFollow(); } else toggleFollow(); }}
                  className={'px-6 py-1.5 rounded-lg text-sm font-semibold ' + (profileData.user.follow_status === 'accepted' ? 'bg-gray-100 text-black hover:bg-gray-200' : profileData.user.follow_status === 'pending' ? 'bg-gray-100 text-gray-500 hover:bg-gray-200' : 'bg-[#0095f6] text-white hover:bg-[#1877f2]')}
                >
                  {profileData.user.follow_status === 'accepted' ? 'Following' : profileData.user.follow_status === 'pending' ? 'Requested' : 'Follow'}
                </button>
                <button data-testid="profile-message-button" onClick={startChat} className="bg-gray-100 px-4 py-1.5 rounded-lg text-sm font-semibold hover:bg-gray-200">Message</button>
              </div>
            ) : (
              <div className="flex gap-2">
                <button data-testid="profile-edit-button" className="bg-gray-100 px-4 py-1.5 rounded-lg text-sm font-semibold hover:bg-gray-200" onClick={() => setIsMenuOpen(true)}>Edit Profile</button>
                {profileData.user.is_private && (
                  <button data-testid="profile-manage-followers-button" className="bg-gray-100 px-4 py-1.5 rounded-lg text-sm font-semibold hover:bg-gray-200" onClick={() => setShowUserList('followers')}>Manage followers</button>
                )}
                <button data-testid="profile-settings-button" className="text-gray-700 p-1.5" onClick={() => setShowSettings(true)} title="Settings">
                  <Settings size={20} className={profileData.user.is_private ? 'fill-black' : ''} />
                </button>
              </div>
            )}
          </div>
          <div className="flex gap-10 text-[16px]">
            <span><b>{profileData.posts.length}</b> posts</span>
            <span data-testid="profile-followers-button" className="cursor-pointer" onClick={() => setShowUserList('followers')}><b>{profileData.user.followers_count}</b> followers</span>
            <span data-testid="profile-following-button" className="cursor-pointer" onClick={() => setShowUserList('following')}><b>{profileData.user.following_count}</b> following</span>
          </div>
          <div className="text-sm font-semibold">{profileData.user.username}</div>
        </div>
      </div>

      {profileData.restricted ? (
          <div data-testid="profile-restricted" className="border-t border-gray-200 pt-16 text-center">
          <div className="w-16 h-16 border-2 border-black rounded-full flex items-center justify-center mx-auto mb-4"><Lock size={32} /></div>
          <h3 className="font-bold text-sm mb-1">This Account is Private</h3>
          <p className="text-sm text-gray-500">Follow to see their photos and videos.</p>
        </div>
      ) : (
        <>
          <div className="flex border-t border-gray-200">
            <button onClick={() => setActiveTab('posts')} className={'flex-1 flex items-center justify-center gap-2 py-3 text-xs font-semibold tracking-widest uppercase transition-colors ' + (activeTab === 'posts' ? 'border-t border-black text-black -mt-px' : 'text-gray-400 hover:text-gray-600')}>
              <Grid3X3 size={12} /> Posts
            </button>
            {isMe && (
              <button data-testid="profile-tab-saved" onClick={() => setActiveTab('saved')} className={'flex-1 flex items-center justify-center gap-2 py-3 text-xs font-semibold tracking-widest uppercase transition-colors ' + (activeTab === 'saved' ? 'border-t border-black text-black -mt-px' : 'text-gray-400 hover:text-gray-600')}>
                <Bookmark size={12} /> Saved
              </button>
            )}
            {isMe && (
              <button data-testid="profile-tab-liked" onClick={() => setActiveTab('liked')} className={'flex-1 flex items-center justify-center gap-2 py-3 text-xs font-semibold tracking-widest uppercase transition-colors ' + (activeTab === 'liked' ? 'border-t border-black text-black -mt-px' : 'text-gray-400 hover:text-gray-600')}>
                <Heart size={12} /> Liked
              </button>
            )}
            {isMe && (
              <button data-testid="profile-tab-commented" onClick={() => setActiveTab('commented')} className={'flex-1 flex items-center justify-center gap-2 py-3 text-xs font-semibold tracking-widest uppercase transition-colors ' + (activeTab === 'commented' ? 'border-t border-black text-black -mt-px' : 'text-gray-400 hover:text-gray-600')}>
                <MessageCircle size={12} /> Commented
              </button>
            )}
            {isMe && (
              <button data-testid="profile-tab-preferences" onClick={() => setActiveTab('preferences')} className={'flex-1 flex items-center justify-center gap-2 py-3 text-xs font-semibold tracking-widest uppercase transition-colors ' + (activeTab === 'preferences' ? 'border-t border-black text-black -mt-px' : 'text-gray-400 hover:text-gray-600')}>
                <Check size={12} /> Preferences
              </button>
            )}
          </div>

          {activeTab === 'posts' && (
            <div data-testid="profile-posts-grid" className="grid grid-cols-3 gap-1 md:gap-4">
              {profileData.posts.map(post => (
                <div data-testid="profile-post-tile" data-post-id={post.id} key={post.id} onClick={() => setSelectedPost(post)} className="aspect-square bg-gray-100 overflow-hidden relative cursor-pointer hover:opacity-90 group">
                  <img src={post.images && post.images.length > 0 ? post.images[0] : post.image_url} className="w-full h-full object-cover" />
                  {post.images && post.images.length > 1 && <div className="absolute top-2 right-2"><Copy size={16} className="text-white drop-shadow-md" /></div>}
                  <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-6 text-white font-bold text-sm">
                    <span className="flex items-center gap-1"><Heart size={18} className="fill-white" /> {post.like_count}</span>
                    <span className="flex items-center gap-1"><MessageCircle size={18} className="fill-white" /> {post.comment_count}</span>
                  </div>
                </div>
              ))}
              {profileData.posts.length === 0 && <div className="col-span-3 py-16 text-center text-gray-400 text-sm">No posts yet.</div>}
            </div>
          )}

          {activeTab === 'saved' && isMe && (
            <div data-testid="profile-saved-grid" className="grid grid-cols-3 gap-1 md:gap-4">
              {savedPosts.map(post => (
                <div data-testid="profile-saved-tile" data-post-id={post.id} key={post.id} onClick={() => setSelectedPost(post)} className="aspect-square bg-gray-100 overflow-hidden relative cursor-pointer hover:opacity-90 group">
                  <img src={post.images && post.images.length > 0 ? post.images[0] : post.image_url} className="w-full h-full object-cover" />
                  {post.images && post.images.length > 1 && <div className="absolute top-2 right-2"><Copy size={16} className="text-white drop-shadow-md" /></div>}
                  <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-6 text-white font-bold text-sm">
                    <span className="flex items-center gap-1"><Heart size={18} className="fill-white" /> {post.like_count}</span>
                    <span className="flex items-center gap-1"><MessageCircle size={18} className="fill-white" /> {post.comment_count}</span>
                  </div>
                </div>
              ))}
              {savedPosts.length === 0 && <div className="col-span-3 py-16 text-center text-gray-400 text-sm">Only you can see what you've saved.</div>}
            </div>
          )}

          {activeTab === 'liked' && isMe && (
            activityLoading ? (
              <div className="py-16 text-center text-gray-400 text-sm">Loading liked posts...</div>
            ) : (
              <LikedMediaGrid posts={likedPosts} onOpen={setSelectedPost} onUnlike={removeLikedPost} />
            )
          )}

          {activeTab === 'commented' && isMe && (
            activityLoading ? (
              <div className="py-16 text-center text-gray-400 text-sm">Loading commented posts...</div>
            ) : (
              <CommentedMediaList posts={commentedPosts} onOpen={setSelectedPost} onDeleteComment={removeCommentFootprint} />
            )
          )}

          {activeTab === 'preferences' && isMe && (
            <div className="space-y-10 py-6">
              {preferencesLoading ? (
                <div className="py-16 text-center text-gray-400 text-sm">Loading preferences...</div>
              ) : (
                <>
                  <PreferenceGridSection
                    title="Interested"
                    description="Posts you explicitly boosted. These raise the chance of similar posts appearing, but they do not take over the whole feed."
                    posts={preferencePosts.interested}
                    emptyMessage="You have not marked any posts as interested yet."
                    onOpen={setSelectedPost}
                    onReset={resetPreference}
                  />
                  <PreferenceGridSection
                    title="Not Interested"
                    description="Posts you asked to see less often. Reset any accidental click back to neutral here."
                    posts={preferencePosts.not_interested}
                    emptyMessage="You have not hidden any posts yet."
                    onOpen={setSelectedPost}
                    onReset={resetPreference}
                  />
                </>
              )}
            </div>
          )}
        </>
      )}

      {selectedPost && <PostModal post={selectedPost} onClose={() => { setSelectedPost(null); if (activeTab === 'preferences' && isMe) fetchPreferencePosts(); if (activeTab === 'liked' && isMe) fetchInteractionPosts('liked'); if (activeTab === 'commented' && isMe) fetchInteractionPosts('commented'); }} onInterestChange={() => { if (activeTab === 'preferences' && isMe) fetchPreferencePosts(); }} />}
      {showUserList && <UserListModal userId={profileData.user.id} type={showUserList} onClose={() => setShowUserList(null)} isOwnProfile={isMe} onFollowerRemoved={() => setProfileData(prev => ({ ...prev, user: { ...prev.user, followers_count: Math.max(0, parseInt(prev.user.followers_count) - 1) } }))} onFollowingRemoved={() => setProfileData(prev => ({ ...prev, user: { ...prev.user, following_count: Math.max(0, parseInt(prev.user.following_count) - 1) } }))} />}
      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} isPrivate={profileData.user.is_private} followerCount={profileData.user.followers_count} onTogglePrivacy={() => togglePrivacy()} onManageFollowers={() => { setShowSettings(false); setShowUserList('followers'); }} />}
    </div>
  );
}

/* ========== SEARCH PAGE ========== */
function SearchPage({ currentUser }) {
  const PAGE_SIZE = 30;
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const navigate = useNavigate();
  const [explorePosts, setExplorePosts] = useState([]);
  const [selectedPost, setSelectedPost] = useState(null);
  const [exploreLoading, setExploreLoading] = useState(false);
  const [hasMoreExplore, setHasMoreExplore] = useState(true);
  const [exploreSeed, setExploreSeed] = useState(() => String(Date.now()));
  const [exploreOffset, setExploreOffset] = useState(0);

  const fetchExplore = async ({ append = false, offset = 0, seed = exploreSeed } = {}) => {
    try {
      setExploreLoading(true);
      const token = localStorage.getItem('token');
      const res = await axios.get(API + '/explore', {
        headers: { Authorization: 'Bearer ' + token },
        params: { limit: PAGE_SIZE, offset, seed },
      });
      const nextPosts = res.data || [];
      setExplorePosts(prev => append ? [...prev, ...nextPosts.filter(post => !prev.some(existing => existing.id === post.id))] : nextPosts);
      setHasMoreExplore(nextPosts.length === PAGE_SIZE);
      setExploreOffset(offset + nextPosts.length);
    } catch (e) { /* */ } finally { setExploreLoading(false); }
  };

  const refreshExplore = async () => {
    const nextSeed = String(Date.now());
    setExploreSeed(nextSeed);
    setExploreOffset(0);
    await fetchExplore({ append: false, offset: 0, seed: nextSeed });
  };

  const loadMoreExplore = async () => {
    if (exploreLoading || !hasMoreExplore) return;
    await fetchExplore({ append: true, offset: exploreOffset, seed: exploreSeed });
  };

  const handleInterestChange = (postId, feedback) => {
    if (feedback === 'not_interested') {
      setExplorePosts(prev => prev.filter(post => post.id !== postId));
      setSelectedPost(current => current && current.id === postId ? null : current);
    }
  };

  const handleRecommendationSignal = () => {
    refreshExplore();
  };

  useEffect(() => { refreshExplore(); }, []);

  useEffect(() => {
    const t = setTimeout(async () => {
      if (query.length < 2) { setResults([]); return; }
      try { const token = localStorage.getItem('token'); const res = await axios.get(API + '/search?q=' + query, { headers: { Authorization: 'Bearer ' + token } }); setResults(res.data); } catch (e) { /* */ }
    }, 300);
    return () => clearTimeout(t);
  }, [query]);

  return (
    <div data-testid="search-page" className="p-4 pt-8 max-w-4xl mx-auto">
      <div className="relative mb-6 max-w-lg mx-auto">
        <input data-testid="search-input" type="text" autoFocus placeholder="Search" className="w-full bg-gray-100 p-2.5 pl-10 rounded-lg outline-none text-sm placeholder-gray-500" value={query} onChange={e => setQuery(e.target.value)} />
        <Search className="absolute left-3 top-2.5 text-gray-400" size={18} />
      </div>
      {query.length >= 2 ? (
        <div data-testid="search-results" className="space-y-2 max-w-lg mx-auto">
          {results.map(u => (
            <div data-testid="search-result-row" data-user-id={u.id} data-username={u.username} key={u.id} className="flex items-center justify-between cursor-pointer hover:bg-gray-50 p-2 rounded-lg" onClick={() => navigate('/u/' + u.username)}>
              <div className="flex items-center gap-3">
                <div className="w-11 h-11 rounded-full bg-gray-200 overflow-hidden">
                  {u.profile_pic ? <img src={u.profile_pic} className="w-full h-full object-cover" /> : <User className="w-full h-full p-2 text-gray-400" />}
                </div>
                <div><p className="font-semibold text-sm">{u.username}</p></div>
              </div>
            </div>
          ))}
          {results.length === 0 && <p className="text-gray-400 text-center text-sm mt-10">No users found.</p>}
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-bold text-base">Explore</h2>
            <button data-testid="explore-refresh" type="button" onClick={refreshExplore} className="text-xs font-semibold text-blue-600 hover:text-blue-700">Refresh</button>
          </div>
          <div data-testid="explore-grid" className="grid grid-cols-3 gap-1 md:gap-3">
            {explorePosts.map(post => {
              const img = Array.isArray(post.images) && post.images.length > 0 ? post.images[0] : post.image_url;
              return (
                <div data-testid="explore-post-tile" data-post-id={post.id} data-post-username={post.username} data-post-category={post.category || ''} key={post.id} onClick={() => setSelectedPost(post)} className="aspect-square bg-gray-100 overflow-hidden relative cursor-pointer hover:opacity-90 group">
                  <img src={img} className="w-full h-full object-cover" />
                  {post.images && post.images.length > 1 && <div className="absolute top-2 right-2"><Copy size={16} className="text-white drop-shadow-md" /></div>}
                  <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-6 text-white font-bold text-sm">
                    <span className="flex items-center gap-1"><Heart size={18} className="fill-white" /> {post.like_count}</span>
                    <span className="flex items-center gap-1"><MessageCircle size={18} className="fill-white" /> {post.comment_count}</span>
                  </div>
                </div>
              );
            })}
          </div>
          {!exploreLoading && hasMoreExplore && (
            <button
              type="button"
              onClick={loadMoreExplore}
              className="w-full py-4 text-sm font-semibold text-blue-600 hover:text-blue-700"
            >
              Load more
            </button>
          )}
          {explorePosts.length === 0 && <p className="text-gray-400 text-center text-sm mt-10">No posts to explore yet.</p>}
        </>
      )}
      {selectedPost && (
        <PostModal
          post={selectedPost}
          onClose={() => setSelectedPost(null)}
          onInterestChange={handleInterestChange}
          onRecommendationSignal={handleRecommendationSignal}
        />
      )}
    </div>
  );
}

function InstagramGlyph({ size = 92, darkMode = false, className = '' }) {
  const gradientId = `insta-glyph-${size}-${darkMode ? 'dark' : 'light'}`;

  return (
    <svg width={size} height={size} viewBox="0 0 96 96" className={className} fill="none" aria-hidden="true">
      <defs>
        <linearGradient id={gradientId} x1="16" y1="84" x2="82" y2="12" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#FFD600" />
          <stop offset="34%" stopColor="#FF7A00" />
          <stop offset="68%" stopColor="#FF0069" />
          <stop offset="100%" stopColor="#6A00FF" />
        </linearGradient>
      </defs>
      <rect x="18" y="18" width="60" height="60" rx="18" stroke={`url(#${gradientId})`} strokeWidth="7" />
      <circle cx="48" cy="48" r="16" stroke={`url(#${gradientId})`} strokeWidth="7" />
      <circle cx="68.5" cy="27.5" r="4.5" fill={`url(#${gradientId})`} />
    </svg>
  );
}

function MetaMark({ darkMode = false }) {
  const gradientId = `meta-mark-${darkMode ? 'dark' : 'light'}`;

  return (
    <div className="flex items-center gap-2" aria-hidden="true">
      <svg width="26" height="16" viewBox="0 0 52 32" fill="none">
        <defs>
          <linearGradient id={gradientId} x1="2" y1="16" x2="50" y2="16" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#FF7A00" />
            <stop offset="100%" stopColor="#FF00A8" />
          </linearGradient>
        </defs>
        <path
          d="M4 23.5C4 16.2 9.4 9.6 15.6 9.6C20.4 9.6 23.6 13.2 26 17.3C28.4 13.2 31.6 9.6 36.4 9.6C42.6 9.6 48 16.2 48 23.5"
          stroke={`url(#${gradientId})`}
          strokeWidth="4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <span className="text-[1.05rem] font-semibold tracking-tight text-[#ff2d92]">Meta</span>
    </div>
  );
}

function LaunchScreen({ prefersDarkMode, isExiting }) {
  return (
    <div
      data-testid="launch-screen"
      className={`auth-launch-screen flex min-h-screen flex-col ${prefersDarkMode ? 'bg-black text-white' : 'bg-white text-[#111827]'} ${isExiting ? 'auth-launch-screen-exit' : ''}`}
    >
      <div className="flex flex-1 items-center justify-center">
        <div className="auth-launch-logo flex items-center justify-center">
          <InstagramGlyph size={96} darkMode={prefersDarkMode} />
        </div>
      </div>
      <div className="auth-launch-meta flex flex-col items-center gap-2 pb-12 text-center">
        <span className={`text-lg ${prefersDarkMode ? 'text-white/45' : 'text-[#667085]'}`}>from</span>
        <MetaMark darkMode={prefersDarkMode} />
      </div>
    </div>
  );
}

function AuthShowcasePanel({ prefersDarkMode }) {
  const shellClass = prefersDarkMode
    ? 'border-white/10 bg-[#0e141a] text-white'
    : 'border-[#dbe4ea] bg-[#f6fafc] text-[#111827]';
  const mutedClass = prefersDarkMode ? 'text-white/70' : 'text-[#526071]';
  const frameClass = prefersDarkMode ? 'bg-[#0f1a22]' : 'bg-white';

  return (
    <div className={`relative hidden overflow-hidden border-r lg:flex ${shellClass}`}>
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[#6dff83] to-transparent opacity-80" />
      <div className="relative flex h-full w-full flex-col px-10 py-12 xl:px-16">
        <div className="mb-12">
          <InstagramGlyph size={72} darkMode={prefersDarkMode} />
        </div>
        <div className="max-w-[560px]">
          <h1 className="text-[3.35rem] font-light leading-[1.08] tracking-[-0.04em] xl:text-[4.15rem]">
            See everyday moments from
          </h1>
          <p className={`mt-8 text-[3.2rem] font-light leading-none tracking-[-0.04em] xl:text-[4rem] ${mutedClass}`}>
            your <span className="auth-gradient-text font-normal">close friends.</span>
          </p>
        </div>

        <div className="relative mt-auto flex min-h-[340px] items-end justify-center pb-8">
          <div className="absolute left-[12%] top-14 text-4xl auth-float-soft">💗</div>
          <div className="absolute right-[18%] top-8 rounded-full bg-[#32d74b] px-3 py-1 text-sm font-semibold text-white shadow-lg auth-float-soft" style={{ animationDelay: '0.6s' }}>
            ★ close friends
          </div>
          <div className={`absolute left-[24%] top-8 h-60 w-44 -rotate-[10deg] rounded-[2rem] border p-4 shadow-2xl ${frameClass} ${prefersDarkMode ? 'border-white/10' : 'border-[#e6eef5]'}`}>
            <div className="h-full rounded-[1.5rem] bg-[radial-gradient(circle_at_20%_20%,#ffd36d_0%,#f4ab46_28%,#7c5536_100%)]" />
            <div className="absolute left-4 top-4 flex gap-1 rounded-full bg-white/90 px-3 py-1 text-xs shadow-sm">
              <span>🫶</span>
              <span>📸</span>
              <span>🥹</span>
            </div>
          </div>
          <div className={`relative z-10 h-72 w-52 rounded-[2.25rem] border p-4 shadow-[0_30px_60px_rgba(0,0,0,0.2)] ${frameClass} ${prefersDarkMode ? 'border-white/10' : 'border-[#e6eef5]'}`}>
            <div className="h-full rounded-[1.8rem] bg-[linear-gradient(145deg,#f8e4b8_0%,#d59a4f_40%,#5f3f2c_100%)]" />
            <div className="absolute left-5 right-5 bottom-4 rounded-full border border-white/80 bg-white/20 py-2 text-center text-xs text-white backdrop-blur-sm" />
            <Heart size={22} className="absolute bottom-5 right-5 text-white" />
          </div>
          <div className={`absolute right-[16%] top-16 h-56 w-44 rotate-[10deg] rounded-[2rem] border p-4 shadow-2xl ${frameClass} ${prefersDarkMode ? 'border-white/10' : 'border-[#e6eef5]'}`}>
            <div className="h-full rounded-[1.5rem] bg-[radial-gradient(circle_at_65%_15%,#ffcb84_0%,#f19652_24%,#3f9d7d_68%,#0f172a_100%)]" />
            <div className="absolute right-3 top-5 flex h-10 w-10 items-center justify-center rounded-full bg-white/90 shadow-md">
              <InstagramGlyph size={26} darkMode={false} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function AuthFacebookButton({ prefersDarkMode, isRegister }) {
  return (
    <button
      type="button"
      onClick={() => toast('Facebook login is not enabled in this demo.')}
      className={`flex w-full items-center justify-center gap-3 rounded-full border px-5 py-4 text-base font-medium transition-colors ${
        prefersDarkMode
          ? 'border-[#33495f] bg-[#15232d] text-white hover:border-[#4c6b89]'
          : 'border-[#d0dae2] bg-white text-[#1f2937] hover:border-[#9cb2c4]'
      }`}
    >
      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[#1877f2] text-sm font-bold text-white">f</span>
      {isRegister ? 'Continue with Facebook' : 'Log in with Facebook'}
    </button>
  );
}

function LoginPage({ onLogin, currentUser, prefersDarkMode }) {
  const [isRegister, setIsRegister] = useState(false);
  const [formData, setFormData] = useState({ identifier: '', email: '', password: '', username: '' });

  if (currentUser) {
    return <Navigate to="/" replace />;
  }

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      const endpoint = isRegister ? '/register' : '/login';
      const payload = isRegister
        ? { username: formData.username, email: formData.email, password: formData.password }
        : { identifier: formData.identifier, password: formData.password };
      const res = await axios.post(API + endpoint, payload);
      if (res.data.success) {
        toast.success('Welcome!');
        if (!isRegister) onLogin(res.data.user, res.data.token);
        else {
          setFormData({ identifier: '', email: formData.email, password: '', username: formData.username });
          setIsRegister(false);
        }
      }
    } catch (e) { toast.error('Error'); }
  };
  const pageClass = prefersDarkMode ? 'bg-[#0b1117] text-white' : 'bg-[#f5f7fb] text-[#111827]';
  const rightPanelClass = prefersDarkMode ? 'border-white/10 bg-[#13212b]' : 'border-[#d9e1e8] bg-white';
  const inputClass = prefersDarkMode
    ? 'border-[#345067] bg-[#15232d] text-white placeholder:text-[#91a6b7] focus:border-[#4b6e8d]'
    : 'border-[#d3dce4] bg-[#f7fafc] text-[#111827] placeholder:text-[#6b7280] focus:border-[#7b97b0]';
  const headingClass = prefersDarkMode ? 'text-white' : 'text-[#111827]';
  const mutedClass = prefersDarkMode ? 'text-[#9bb0c0]' : 'text-[#607182]';
  const formReady = isRegister
    ? formData.email && formData.password && formData.username
    : formData.identifier && formData.password;

  return (
    <div className={`min-h-screen ${pageClass}`}>
      <div className="grid min-h-screen lg:grid-cols-[1.06fr_0.94fr]">
        <AuthShowcasePanel prefersDarkMode={prefersDarkMode} />

        <div className="flex items-center justify-center px-5 py-10 sm:px-8 lg:px-12">
          <div className={`w-full max-w-[520px] rounded-[2rem] border p-6 shadow-[0_24px_80px_rgba(0,0,0,0.08)] sm:p-8 lg:p-10 ${rightPanelClass}`}>
            <div className="mb-10 flex items-center justify-between lg:hidden">
              <InstagramGlyph size={58} darkMode={prefersDarkMode} />
              <span className={`text-sm font-medium ${mutedClass}`}>Instagram</span>
            </div>

            <div className="space-y-3">
              <p className={`text-sm font-semibold uppercase tracking-[0.24em] ${mutedClass}`}>
                {isRegister ? 'Create your account' : 'Log into Instagram'}
              </p>
              <h2 className={`text-[2rem] font-light leading-tight tracking-[-0.04em] sm:text-[2.35rem] ${headingClass}`}>
                {isRegister ? 'Start sharing your moments.' : 'Welcome back.'}
              </h2>
              <p className={`max-w-md text-sm leading-6 ${mutedClass}`}>
                {isRegister
                  ? 'Create a profile in seconds and start building your feed.'
                  : 'See stories, explore posts, and pick up right where you left off.'}
              </p>
            </div>

            <form data-testid="login-form" onSubmit={handleSubmit} className="mt-8 space-y-4">
              {isRegister && (
                <input
                  data-testid="register-username-input"
                  type="text"
                  placeholder="Choose a username"
                  value={formData.username}
                  className={`w-full rounded-[1.4rem] border px-6 py-5 text-lg outline-none transition-colors ${inputClass}`}
                  onChange={e => setFormData({ ...formData, username: e.target.value })}
                />
              )}
              <input
                data-testid="login-email-input"
                type="text"
                placeholder="Mobile number, username or email"
                value={isRegister ? formData.email : formData.identifier}
                className={`w-full rounded-[1.4rem] border px-6 py-5 text-lg outline-none transition-colors ${inputClass}`}
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                onChange={e => setFormData(isRegister
                  ? { ...formData, email: e.target.value }
                  : { ...formData, identifier: e.target.value })}
              />
              <input
                data-testid="login-password-input"
                type="password"
                placeholder="Password"
                value={formData.password}
                className={`w-full rounded-[1.4rem] border px-6 py-5 text-lg outline-none transition-colors ${inputClass}`}
                onChange={e => setFormData({ ...formData, password: e.target.value })}
              />
              <button
                data-testid="login-submit"
                className={`mt-2 w-full rounded-full px-6 py-5 text-lg font-semibold transition-all ${
                  formReady
                    ? 'bg-[#184a83] text-white hover:bg-[#245c9c]'
                    : 'cursor-not-allowed bg-[#184a83]/45 text-white/60'
                }`}
                disabled={!formReady}
              >
                {isRegister ? 'Create account' : 'Log in'}
              </button>
            </form>

            <button type="button" onClick={() => toast('Password recovery is not configured in this demo.')} className={`mt-8 w-full text-center text-lg font-medium ${prefersDarkMode ? 'text-white/85 hover:text-white' : 'text-[#1f2937] hover:text-black'}`}>
              Forgot password?
            </button>

            <div className={`my-10 h-px w-full ${prefersDarkMode ? 'bg-white/10' : 'bg-[#e3eaf0]'}`} />

            <div className="space-y-4">
              <AuthFacebookButton prefersDarkMode={prefersDarkMode} isRegister={isRegister} />
              <button
                data-testid="auth-mode-toggle"
                type="button"
                onClick={() => setIsRegister(!isRegister)}
                className={`w-full rounded-full border px-5 py-4 text-base font-medium transition-colors ${
                  prefersDarkMode
                    ? 'border-[#3e8bff] text-[#58a2ff] hover:bg-[#0f2740]'
                    : 'border-[#3e8bff] text-[#1877f2] hover:bg-[#eef6ff]'
                }`}
              >
                {isRegister ? 'Back to login' : 'Create new account'}
              </button>
            </div>

            <div className={`mt-10 flex flex-col items-center gap-3 text-center text-sm ${mutedClass}`}>
              <span>{isRegister ? 'Already have an account?' : "Don't have an account?"}</span>
              <div className="flex items-center gap-2">
                <MetaMark darkMode={prefersDarkMode} />
                <span>Instagram from Meta</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
