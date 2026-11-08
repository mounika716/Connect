import { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { io } from 'socket.io-client';
import './App.css';

const API = import.meta.env.VITE_API_URL || 'http://localhost:5000';
const socket = io(API, { autoConnect: false, maxHttpBufferSize: 1e8 });

const ICE_SERVERS = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' }
  ]
};

const QUICK_EMOJI = ['❤️', '👍', '😂', '😮', '😢', '🙏'];
const COMPOSER_EMOJI = [
  '😀','😁','😂','🤣','😃','😄','😅','😆','😉','😊','😋','😎','😍','😘','🥰','😗','😙','😚','🙂','🤗',
  '🤩','🤔','🤨','😐','😑','😶','🙄','😏','😣','😥','😮','🤐','😯','😪','😫','🥱','😴','😌','😛','😜',
  '😝','🤤','😒','😓','😔','😕','🙃','🤑','😲','🙁','😖','😞','😟','😤','😢','😭','😦','😧','😨','😩',
  '🤯','😬','😰','😱','🥵','🥶','😳','🤪','😵','🥴','😠','😡','🤬','😷','🤒','🤕','🤢','🤮','🤧','😇',
  '🥳','🥺','🤠','🤡','🤥','🤫','🤭','🧐','🤓','😈','👿','👹','👺','💀','👻','👽','🤖','💩','😺','😸',
  '❤️','🧡','💛','💚','💙','💜','🖤','🤍','🤎','💔','❣️','💕','💞','💓','💗','💖','💘','💝','💟','👍',
  '👎','👌','✌️','🤞','🤟','🤘','🤙','👈','👉','👆','👇','☝️','✋','🤚','🖐️','🖖','👋','🤝','🙏','💪',
  '🎉','🎊','🔥','✨','⭐','🌟','💫','⚡','💥','💯','✅','❌','❓','❗','💤','💢','💬','👀','🙈','🙉'
];

const compressImage = (file, maxWidth = 900, quality = 0.7) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onerror = reject;
  reader.onload = (e) => {
    const img = new Image();
    img.onerror = reject;
    img.onload = () => {
      const canvas = document.createElement('canvas');
      let { width, height } = img;
      if (width > maxWidth) { height = Math.round((height * maxWidth) / width); width = maxWidth; }
      canvas.width = width; canvas.height = height;
      canvas.getContext('2d').drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
});

const blobToDataURL = (blob) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onerror = reject;
  reader.onload = () => resolve(reader.result);
  reader.readAsDataURL(blob);
});

const fmtTime = (ts) => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const fmtSecs = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
const isTemp = (id) => !id || String(id).startsWith('tmp');

export default function App() {
  const [user, setUser] = useState(() => JSON.parse(localStorage.getItem('chatUser') || 'null'));
  const [isLogin, setIsLogin] = useState(true);
  const [uInput, setUInput] = useState('');
  const [pInput, setPInput] = useState('');
  const [authErr, setAuthErr] = useState('');

  const [convos, setConvos] = useState([]);
  const [targetId, setTargetId] = useState('');
  const [targetName, setTargetName] = useState('');
  const [targetPic, setTargetPic] = useState('');
  const [targetOnline, setTargetOnline] = useState(false);
  const [targetLastSeen, setTargetLastSeen] = useState(null);
  const [newChatId, setNewChatId] = useState('');
  const [message, setMessage] = useState('');
  const [chat, setChat] = useState([]);
  const [typing, setTyping] = useState(false);

  // LAYOUT
  const [sidebarWidth, setSidebarWidth] = useState(300);
  const [resizing, setResizing] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(
    () => localStorage.getItem('sidebarCollapsed') === 'true'
  );
  const [isMobile, setIsMobile] = useState(() => window.innerWidth <= 768);

  const [showSettings, setShowSettings] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showWallpaperModal, setShowWallpaperModal] = useState(false);
  const [showStatusModal, setShowStatusModal] = useState(false);
  const [statuses, setStatuses] = useState([]);
  const [viewingStatus, setViewingStatus] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const [msgMenu, setMsgMenu] = useState(null);
  const [editTarget, setEditTarget] = useState(null);
  const [editText, setEditText] = useState('');
  const [editSaving, setEditSaving] = useState(false);
  const [lightbox, setLightbox] = useState(null);
  const [singleDelete, setSingleDelete] = useState(null);

  const [replyTo, setReplyTo] = useState(null);
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [emojiPickerFor, setEmojiPickerFor] = useState(null);
  const [showComposerEmoji, setShowComposerEmoji] = useState(false);
  const [blockedUsers, setBlockedUsers] = useState([]);
  const [iAmBlocked, setIAmBlocked] = useState(false);
  const [toast, setToast] = useState('');
  const [installPrompt, setInstallPrompt] = useState(null);
  const [showInstallBanner, setShowInstallBanner] = useState(false);

  const [darkMode, setDarkMode] = useState(() => localStorage.getItem('darkMode') === 'true');
  const [wallpapers, setWallpapers] = useState(() => JSON.parse(localStorage.getItem('wallpapers') || '{}'));

  const [editName, setEditName] = useState(user?.username || '');
  const [editPic, setEditPic] = useState(user?.profilePic || '');
  const [statusText, setStatusText] = useState('');
  const [statusPic, setStatusPic] = useState('');

  const [call, setCall] = useState(null);
  const [localStream, setLocalStream] = useState(null);
  const [remoteStream, setRemoteStream] = useState(null);
  const [muted, setMuted] = useState(false);
  const [cameraOff, setCameraOff] = useState(false);
  const [callError, setCallError] = useState('');

  const [recording, setRecording] = useState(false);
  const [recTime, setRecTime] = useState(0);
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const recTimerRef = useRef(null);

  const peerRef = useRef(null);
  const localStreamRef = useRef(null);
  const pendingCandidatesRef = useRef([]);
  const callTimeoutRef = useRef(null);
  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const callPeerIdRef = useRef(null);
  const callRef = useRef(null);
  const lockRef = useRef(false);
  const messageInputRef = useRef(null);

  const chatEnd = useRef(null);
  const typingTimer = useRef(null);
  const imgInputRef = useRef(null);
  const chatImgRef = useRef(null);
  const statusImgRef = useRef(null);
  const menuRef = useRef(null);
  const messagesRef = useRef(null);
  const composerEmojiRef = useRef(null);

  useEffect(() => { callRef.current = call; }, [call]);

  // Persist sidebar state
  useEffect(() => {
    localStorage.setItem('sidebarCollapsed', sidebarCollapsed);
  }, [sidebarCollapsed]);

  // Mobile detection
  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth <= 768);
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);

  // Ctrl/Cmd+B to toggle sidebar
  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        setSidebarCollapsed(s => !s);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    document.body.classList.toggle('dark', darkMode);
    localStorage.setItem('darkMode', darkMode);
  }, [darkMode]);

  useEffect(() => {
    const handler = (e) => {
      e.preventDefault();
      setInstallPrompt(e);
      setShowInstallBanner(true);
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  useEffect(() => {
    if (user && 'Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission().catch(() => {});
    }
  }, [user]);

  useEffect(() => {
    if (localVideoRef.current && localStream) {
      localVideoRef.current.srcObject = localStream;
      localVideoRef.current.play().catch(() => {});
    }
  }, [localStream, call?.type, call?.status]);

  useEffect(() => {
    if (remoteVideoRef.current && remoteStream) {
      remoteVideoRef.current.srcObject = remoteStream;
      remoteVideoRef.current.play().catch(() => {});
    }
  }, [remoteStream, call?.type, call?.status]);

  useEffect(() => {
    const handler = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setShowMenu(false);
      if (!e.target.closest('.msg-more') && !e.target.closest('.msg-menu-fixed') && !e.target.closest('.emoji-picker')) {
        setMsgMenu(null);
        setEmojiPickerFor(null);
      }
      if (composerEmojiRef.current && !composerEmojiRef.current.contains(e.target) && !e.target.closest('.composer-emoji-btn')) {
        setShowComposerEmoji(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  useEffect(() => {
    const el = messagesRef.current;
    if (!el) return;
    const onScroll = () => { setMsgMenu(null); setEmojiPickerFor(null); };
    el.addEventListener('scroll', onScroll);
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    const move = (e) => { if (resizing && !isMobile) setSidebarWidth(Math.min(Math.max(e.clientX, 260), 600)); };
    const up = () => setResizing(false);
    if (resizing) {
      window.addEventListener('mousemove', move);
      window.addEventListener('mouseup', up);
    }
    return () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
  }, [resizing, isMobile]);

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(''), 3000);
  };

  const fetchConvos = async () => {
    if (!user) return;
    try {
      const { data } = await axios.get(`${API}/api/conversations/${user.uniqueId}`);
      setConvos(data);
    } catch (e) { console.error(e); }
  };

  const fetchStatuses = async () => {
    try {
      const { data } = await axios.get(`${API}/api/status`);
      setStatuses(data);
    } catch {}
  };

  const fetchBlocked = async () => {
    if (!user) return;
    try {
      const { data } = await axios.get(`${API}/api/users/${user.uniqueId}/blocked`);
      setBlockedUsers(data);
    } catch {}
  };

  const markRead = async () => {
    if (!user || !targetId) return;
    try { await axios.post(`${API}/api/messages/read`, { readerId: user.uniqueId, senderId: targetId }); } catch {}
  };

  useEffect(() => {
    socket.connect();
    if (user) {
      socket.emit('register_user', user.uniqueId);
      fetchConvos();
      fetchStatuses();
      fetchBlocked();
    }
    return () => socket.disconnect();
  }, [user]);

  useEffect(() => { chatEnd.current?.scrollIntoView({ behavior: 'smooth' }); }, [chat, typing]);

  useEffect(() => {
    if (targetId && user && chat.length > 0) markRead();
  }, [targetId, user, chat.length]);

  useEffect(() => {
    const onMsg = (data) => {
      const isMe = data.senderId === user?.uniqueId;
      if (!isMe && document.hidden && 'Notification' in window && Notification.permission === 'granted') {
        const preview = data.messageType === 'image' ? '📷 Photo'
                      : data.messageType === 'audio' ? '🎤 Voice message'
                      : data.message;
        new Notification(data.senderUsername || 'New message', {
          body: preview, icon: '/icon-192.png', tag: 'msg-' + data.senderId
        });
      }
      setChat((prev) => {
        const idx = prev.findIndex(m =>
          String(m._id) === String(data._id) ||
          (m.senderId === data.senderId && m.message === data.message &&
           Math.abs(new Date(m.timestamp) - new Date(data.timestamp)) < 3000)
        );
        if (idx >= 0) {
          const copy = [...prev];
          copy[idx] = { ...data, type: isMe ? 'sent' : 'received' };
          return copy;
        }
        return [...prev, { ...data, type: isMe ? 'sent' : 'received' }];
      });
      fetchConvos();
    };
    const onEdit = (data) => {
      setChat((prev) => prev.map(m =>
        String(m._id) === String(data._id) ? { ...m, message: data.message, edited: true } : m
      ));
      fetchConvos();
    };
    const onDel = (data) => {
      setChat((prev) => prev.filter(m => String(m._id) !== String(data._id)));
      fetchConvos();
    };
    const onTyping = () => setTyping(true);
    const onStopTyping = () => setTyping(false);
    const onPresence = (data) => {
      if (data.uniqueId === targetId) {
        setTargetOnline(data.isOnline);
        if (data.lastSeen) setTargetLastSeen(data.lastSeen);
      }
      setConvos((prev) => prev.map(c =>
        c.uniqueId === data.uniqueId ? { ...c, isOnline: data.isOnline, lastSeen: data.lastSeen || c.lastSeen } : c
      ));
    };
    const onChatDeleted = ({ withUser }) => {
      if (targetId === withUser) setChat([]);
      fetchConvos();
    };
    const onRead = ({ by }) => {
      if (by === targetId) setChat(prev => prev.map(m => m.type === 'sent' ? { ...m, read: true } : m));
    };
    const onReacted = (data) => {
      setChat(prev => prev.map(m =>
        String(m._id) === String(data._id) ? { ...m, reactions: data.reactions } : m
      ));
    };
    const onSendError = ({ error }) => {
      showToast('⚠️ ' + error);
      setChat(prev => prev.filter(m => !isTemp(m._id)));
    };

    socket.on('receive_message', onMsg);
    socket.on('message_edited', onEdit);
    socket.on('message_deleted', onDel);
    socket.on('user_typing', onTyping);
    socket.on('user_stop_typing', onStopTyping);
    socket.on('presence', onPresence);
    socket.on('chat_deleted', onChatDeleted);
    socket.on('messages_read', onRead);
    socket.on('message_reacted', onReacted);
    socket.on('send_error', onSendError);

    return () => {
      socket.off('receive_message', onMsg);
      socket.off('message_edited', onEdit);
      socket.off('message_deleted', onDel);
      socket.off('user_typing', onTyping);
      socket.off('user_stop_typing', onStopTyping);
      socket.off('presence', onPresence);
      socket.off('chat_deleted', onChatDeleted);
      socket.off('messages_read', onRead);
      socket.off('message_reacted', onReacted);
      socket.off('send_error', onSendError);
    };
  }, [user, targetId]);

  useEffect(() => {
    if (!user) return;
    const onIncoming = (data) => {
      if (callRef.current) {
        socket.emit('call_response', { to: data.from, from: user.uniqueId, accepted: false });
        return;
      }
      if (data.from === user.uniqueId) return;
      setCallError('');
      setCall({
        peerId: data.from, peerName: data.fromName, peerPic: data.fromPic,
        type: data.type, incoming: true, outgoing: false, status: 'ringing', offer: data.offer
      });
    };
    const onResponse = async (data) => {
      if (!peerRef.current) return;
      if (data.accepted) {
        try {
          await peerRef.current.setRemoteDescription(new RTCSessionDescription(data.answer));
          for (const c of pendingCandidatesRef.current) {
            try { await peerRef.current.addIceCandidate(c); } catch {}
          }
          pendingCandidatesRef.current = [];
          clearTimeout(callTimeoutRef.current);
          setCall(prev => prev ? { ...prev, status: 'connected' } : prev);
        } catch (err) { setCallError('Connection failed'); }
      } else {
        clearTimeout(callTimeoutRef.current);
        cleanupCall(); setCall(null);
        setCallError('Call was rejected');
        setTimeout(() => setCallError(''), 3000);
      }
    };
    const onIce = async (data) => {
      if (peerRef.current && peerRef.current.remoteDescription && peerRef.current.remoteDescription.type) {
        try { await peerRef.current.addIceCandidate(data.candidate); } catch {}
      } else { pendingCandidatesRef.current.push(data.candidate); }
    };
    const onEnded = () => { cleanupCall(); setCall(null); };
    const onUnavailable = () => {
      cleanupCall(); setCall(null);
      setCallError('User is offline right now');
      setTimeout(() => setCallError(''), 3000);
    };

    socket.on('incoming_call', onIncoming);
    socket.on('call_response', onResponse);
    socket.on('webrtc_ice', onIce);
    socket.on('call_ended', onEnded);
    socket.on('call_unavailable', onUnavailable);
    return () => {
      socket.off('incoming_call', onIncoming);
      socket.off('call_response', onResponse);
      socket.off('webrtc_ice', onIce);
      socket.off('call_ended', onEnded);
      socket.off('call_unavailable', onUnavailable);
    };
  }, [user]);

  useEffect(() => {
    if (!targetId || !user) { setIAmBlocked(false); return; }
    axios.get(`${API}/api/users/${targetId}`).then(r => {
      setIAmBlocked((r.data.blocked || []).includes(user.uniqueId));
    }).catch(() => setIAmBlocked(false));
  }, [targetId, user, blockedUsers]);

  useEffect(() => {
    if (targetId && user && targetId !== user.uniqueId) {
      const conv = convos.find(c => c.uniqueId === targetId);
      if (conv) {
        setTargetName(conv.username);
        setTargetPic(conv.profilePic || '');
        setTargetOnline(conv.isOnline || false);
        setTargetLastSeen(conv.lastSeen || null);
      }
      axios.get(`${API}/api/messages/${user.uniqueId}/${targetId}`).then(r => {
        setChat(r.data.map(m => ({
          ...m, type: m.senderId === user.uniqueId ? 'sent' : 'received'
        })));
      });
      setReplyTo(null); setSearchQuery(''); setShowSearch(false);
    } else {
      setChat([]);
    }
  }, [targetId, user, convos]);

  const handleAuth = async (e) => {
    e.preventDefault();
    setAuthErr('');
    try {
      const ep = isLogin ? 'login' : 'register';
      const { data } = await axios.post(`${API}/api/${ep}`, { username: uInput, password: pInput });
      setUser(data);
      localStorage.setItem('chatUser', JSON.stringify(data));
      socket.emit('register_user', data.uniqueId);
      setUInput(''); setPInput('');
    } catch (e) { setAuthErr(e.response?.data?.error || 'Error'); }
  };

  const logout = () => {
    cleanupCall();
    localStorage.removeItem('chatUser');
    setUser(null); setChat([]); setConvos([]); setTargetId('');
  };

  const startChat = async (e) => {
    e.preventDefault();
    const id = newChatId.trim();
    if (!id) return;
    if (id === user.uniqueId) { alert("You can't chat with yourself"); return; }
    try {
      const { data } = await axios.get(`${API}/api/users/${id}`);
      setTargetId(data.uniqueId);
      setTargetName(data.username);
      setNewChatId('');
      if (isMobile) setSidebarCollapsed(true);
    } catch (err) {
      alert(err.response?.status === 404 ? "❌ No user found with that ID" : "Error: " + err.message);
    }
  };

  const openChat = (id) => {
    setTargetId(id);
    if (isMobile) setSidebarCollapsed(true);
  };

  const sendMsg = (e, type = 'text', payload = null) => {
    e?.preventDefault?.();
    const content = payload ?? message;
    if (!content || !targetId) return;
    const tmp = {
      _id: 'tmp' + Date.now(),
      senderId: user.uniqueId, senderUsername: user.username,
      message: content, messageType: type,
      timestamp: new Date().toISOString(), type: 'sent', edited: false, read: false,
      reactions: [],
      replyTo: replyTo ? {
        _id: replyTo._id, message: replyTo.message,
        messageType: replyTo.messageType, senderId: replyTo.senderId
      } : undefined
    };
    setChat((p) => [...p, tmp]);
    socket.emit('send_message', {
      senderId: user.uniqueId, targetUniqueId: targetId,
      senderUsername: user.username, message: content, messageType: type,
      replyTo: tmp.replyTo
    });
    if (type === 'text') { setMessage(''); socket.emit('stop_typing', { targetUniqueId: targetId }); }
    setReplyTo(null);
    setTimeout(fetchConvos, 500);
  };

  const onTyping = (e) => {
    setMessage(e.target.value);
    if (!targetId) return;
    socket.emit('typing', { targetUniqueId: targetId });
    clearTimeout(typingTimer.current);
    typingTimer.current = setTimeout(() => socket.emit('stop_typing', { targetUniqueId: targetId }), 1500);
  };

  const insertEmoji = (emoji) => {
    const input = messageInputRef.current;
    if (!input) { setMessage(m => m + emoji); return; }
    const start = input.selectionStart ?? message.length;
    const end = input.selectionEnd ?? message.length;
    const newVal = message.slice(0, start) + emoji + message.slice(end);
    setMessage(newVal);
    setTimeout(() => {
      input.focus();
      input.selectionStart = input.selectionEnd = start + emoji.length;
    }, 0);
  };

  const toggleReaction = async (msgId, emoji) => {
    try {
      const { data } = await axios.post(`${API}/api/messages/${msgId}/react`, {
        userId: user.uniqueId, emoji
      });
      setChat(prev => prev.map(m =>
        String(m._id) === String(msgId) ? { ...m, reactions: data.reactions } : m
      ));
      setEmojiPickerFor(null);
    } catch (e) { console.error(e); }
  };

  const blockUser = async () => {
    if (!targetId) return;
    if (!window.confirm(`Block ${targetName}? They won't be able to message you.`)) return;
    try {
      await axios.post(`${API}/api/users/${targetId}/block`, { blockerId: user.uniqueId });
      showToast(`Blocked ${targetName}`);
      setShowMenu(false);
      fetchBlocked();
    } catch { showToast('Block failed'); }
  };

  const unblockUser = async (uid) => {
    try {
      await axios.post(`${API}/api/users/${uid}/unblock`, { blockerId: user.uniqueId });
      fetchBlocked();
    } catch {}
  };

  const startRecording = async () => {
    if (recording) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : (MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : '');
      const rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
      audioChunksRef.current = [];
      rec.ondataavailable = (e) => { if (e.data.size > 0) audioChunksRef.current.push(e.data); };
      rec.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        clearInterval(recTimerRef.current);
        setRecording(false); setRecTime(0);
        const blob = new Blob(audioChunksRef.current, { type: rec.mimeType || 'audio/webm' });
        if (blob.size < 1000) return;
        try { sendMsg(null, 'audio', await blobToDataURL(blob)); }
        catch { alert('Failed to encode audio'); }
      };
      mediaRecorderRef.current = rec;
      rec.start();
      setRecording(true); setRecTime(0);
      recTimerRef.current = setInterval(() => setRecTime(t => t + 1), 1000);
    } catch (err) { alert('Microphone access denied: ' + err.message); }
  };

  const stopRecording = () => {
    const rec = mediaRecorderRef.current;
    if (rec && rec.state !== 'inactive') rec.stop();
  };

  const cancelRecording = () => {
    const rec = mediaRecorderRef.current;
    if (rec && rec.state !== 'inactive') { audioChunksRef.current = []; rec.stop(); }
    clearInterval(recTimerRef.current);
    setRecording(false); setRecTime(0);
  };

  const deleteChat = async (scope) => {
    if (!targetId || deleting) return;
    setDeleting(true);
    try {
      const res = await axios.delete(`${API}/api/messages/${user.uniqueId}/${targetId}/${scope}`);
      if (res.data.success) { setChat([]); await fetchConvos(); setTargetId(''); setShowDeleteModal(false); }
    } catch (err) { alert('Delete error: ' + (err.response?.data?.error || err.message)); }
    finally { setDeleting(false); }
  };

  const saveSettings = async () => {
    try {
      const { data } = await axios.put(`${API}/api/users/${user.uniqueId}`, { username: editName, profilePic: editPic });
      setUser(data);
      localStorage.setItem('chatUser', JSON.stringify(data));
      setShowSettings(false);
      fetchConvos();
    } catch (e) { alert(e.response?.data?.error || 'Error saving'); }
  };

  const onProfilePic = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    setEditPic(await compressImage(f, 300, 0.85));
  };

  const onChatPic = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    try { sendMsg(null, 'image', await compressImage(f, 900, 0.7)); }
    catch { alert('Failed to load image'); }
    e.target.value = '';
  };

  const setWallpaper = (value) => {
    const updated = { ...wallpapers, [targetId]: value };
    setWallpapers(updated);
    localStorage.setItem('wallpapers', JSON.stringify(updated));
    setShowWallpaperModal(false);
  };

  const postStatus = async () => {
    const content = statusPic || statusText;
    if (!content) return;
    try {
      await axios.post(`${API}/api/status`, { uniqueId: user.uniqueId, type: statusPic ? 'image' : 'text', content });
      setStatusText(''); setStatusPic(''); setShowStatusModal(false);
      fetchStatuses();
    } catch { alert('Status post failed'); }
  };

  const deleteMyStatus = async () => {
    try {
      await axios.delete(`${API}/api/status/${user.uniqueId}`);
      setViewingStatus(null); fetchStatuses();
    } catch { alert('Failed to delete status'); }
  };

  const onStatusPic = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    setStatusPic(await compressImage(f, 900, 0.75));
  };

  const openMsgMenu = (e, m) => {
    e.stopPropagation();
    if (msgMenu?.id === m._id) { setMsgMenu(null); return; }
    const rect = e.currentTarget.getBoundingClientRect();
    const W = 190, H = 240;
    let top = rect.bottom + 6;
    let left = rect.right - W;
    if (left < 8) left = 8;
    if (left + W > window.innerWidth - 8) left = window.innerWidth - W - 8;
    if (top + H > window.innerHeight - 8) top = rect.top - H - 6;
    if (top < 8) top = 8;
    setMsgMenu({
      id: m._id, top, left,
      isMine: m.type === 'sent',
      isImage: isImageMsg(m) || isAudioMsg(m),
      tmp: isTemp(m._id),
      msg: m
    });
  };

  const startEdit = () => {
    if (!msgMenu) return;
    if (msgMenu.tmp) return alert('Message is still sending');
    if (msgMenu.isImage) return alert('Only text messages can be edited');
    setEditTarget(msgMenu.msg); setEditText(msgMenu.msg.message); setMsgMenu(null);
  };

  const startReply = () => {
    if (!msgMenu) return;
    setReplyTo(msgMenu.msg); setMsgMenu(null);
  };

  const saveEdit = async () => {
    if (!editText.trim() || !editTarget || editSaving) return;
    const id = editTarget._id;
    if (isTemp(id)) return alert('Cannot edit unsaved message');
    setEditSaving(true);
    try {
      await axios.put(`${API}/api/messages/${id}`, { message: editText.trim(), senderId: user.uniqueId });
      setChat((prev) => prev.map(m => String(m._id) === String(id) ? { ...m, message: editText.trim(), edited: true } : m));
      setEditTarget(null); setEditText('');
    } catch (err) { alert('Edit failed: ' + (err.response?.data?.error || err.message)); }
    finally { setEditSaving(false); }
  };

  const startSingleDelete = (isMine) => {
    if (!msgMenu) return;
    if (msgMenu.tmp) return alert('Message is still sending');
    setSingleDelete({ id: msgMenu.id, isMine });
    setMsgMenu(null);
  };

  const deleteMessage = async (scope) => {
    if (!singleDelete) return;
    const { id } = singleDelete;
    try {
      if (scope === 'me') await axios.delete(`${API}/api/messages/${id}/me?userId=${user.uniqueId}`);
      else await axios.delete(`${API}/api/messages/${id}/all`);
      setChat((prev) => prev.filter(m => String(m._id) !== String(id)));
      setSingleDelete(null);
      fetchConvos();
    } catch (e) { alert('Delete failed: ' + (e.response?.data?.error || e.message)); }
  };

  const formatLastSeen = (ls) => {
    if (!ls) return 'Offline';
    const d = new Date(ls);
    const diff = Math.floor((Date.now() - d) / 60000);
    if (diff < 1) return 'just now';
    if (diff < 60) return `${diff}m ago`;
    if (diff < 1440) return `${Math.floor(diff / 60)}h ago`;
    return d.toLocaleDateString();
  };

  const isImageMsg = (m) => m.messageType === 'image' ||
    (typeof m.message === 'string' && m.message.startsWith('data:image'));
  const isAudioMsg = (m) => m.messageType === 'audio' ||
    (typeof m.message === 'string' && m.message.startsWith('data:audio'));

  const myStatus = statuses.find(s => s.uniqueId === user?.uniqueId);
  const hasMyStatus = !!myStatus;
  const openSettings = () => { setShowSettings(true); setEditName(user.username); setEditPic(user.profilePic || ''); };

  const cleanupCall = () => {
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(t => t.stop());
      localStreamRef.current = null;
    }
    setLocalStream(null); setRemoteStream(null);
    if (peerRef.current) { try { peerRef.current.close(); } catch {} peerRef.current = null; }
    pendingCandidatesRef.current = [];
    clearTimeout(callTimeoutRef.current);
    setMuted(false); setCameraOff(false);
    callPeerIdRef.current = null;
    lockRef.current = false;
  };

  const buildPeer = (peerId) => {
    const pc = new RTCPeerConnection(ICE_SERVERS);
    pc.onicecandidate = (e) => {
      if (e.candidate) socket.emit('webrtc_ice', { to: peerId, candidate: e.candidate });
    };
    pc.ontrack = (e) => setRemoteStream(e.streams[0]);
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
        setTimeout(() => {
          if (peerRef.current === pc &&
              (pc.connectionState === 'failed' || pc.connectionState === 'disconnected')) {
            cleanupCall(); setCall(null);
          }
        }, 3000);
      }
    };
    return pc;
  };

  const startCall = async (type) => {
    if (!targetId || callRef.current || lockRef.current) return;
    lockRef.current = true;
    setCallError('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: type === 'video' });
      localStreamRef.current = stream;
      setLocalStream(stream);
      const pc = buildPeer(targetId);
      peerRef.current = pc;
      callPeerIdRef.current = targetId;
      stream.getTracks().forEach(track => pc.addTrack(track, stream));
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      setCall({
        peerId: targetId, peerName: targetName, peerPic: targetPic,
        type, incoming: false, outgoing: true, status: 'calling', offer: null
      });
      socket.emit('call_user', {
        to: targetId, from: user.uniqueId, fromName: user.username,
        fromPic: user.profilePic || '', type, offer
      });
      callTimeoutRef.current = setTimeout(() => {
        socket.emit('call_end', { to: targetId });
        cleanupCall(); setCall(null);
        setCallError('No answer');
        setTimeout(() => setCallError(''), 3000);
      }, 30000);
    } catch (err) {
      alert('Could not access camera/mic: ' + err.message);
      cleanupCall();
    }
  };

  const acceptCall = async () => {
    const c = callRef.current;
    if (!c || !c.offer) return;
    lockRef.current = true;
    const { peerId, type, offer } = c;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: type === 'video' });
      localStreamRef.current = stream;
      setLocalStream(stream);
      const pc = buildPeer(peerId);
      peerRef.current = pc;
      callPeerIdRef.current = peerId;
      stream.getTracks().forEach(track => pc.addTrack(track, stream));
      await pc.setRemoteDescription(new RTCSessionDescription(offer));
      for (const ca of pendingCandidatesRef.current) {
        try { await pc.addIceCandidate(ca); } catch {}
      }
      pendingCandidatesRef.current = [];
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socket.emit('call_response', { to: peerId, from: user.uniqueId, accepted: true, answer });
      setCall(prev => prev ? { ...prev, incoming: false, status: 'connected' } : prev);
    } catch (err) {
      alert('Could not access camera/mic: ' + err.message);
      rejectCall();
    }
  };

  const rejectCall = () => {
    const c = callRef.current;
    if (c?.peerId) socket.emit('call_response', { to: c.peerId, from: user.uniqueId, accepted: false });
    cleanupCall(); setCall(null);
  };

  const hangUp = () => {
    const peer = callRef.current?.peerId || callPeerIdRef.current;
    if (peer) socket.emit('call_end', { to: peer });
    cleanupCall(); setCall(null);
  };

  const toggleMute = () => {
    const stream = localStreamRef.current;
    if (!stream) return;
    const next = !muted;
    stream.getAudioTracks().forEach(t => t.enabled = !next);
    setMuted(next);
  };

  const toggleCamera = () => {
    const stream = localStreamRef.current;
    if (!stream) return;
    const next = !cameraOff;
    stream.getVideoTracks().forEach(t => t.enabled = !next);
    setCameraOff(next);
  };

  const triggerInstall = async () => {
    if (!installPrompt) return;
    installPrompt.prompt();
    const { outcome } = await installPrompt.userChoice;
    if (outcome === 'accepted') showToast('🎉 App installed!');
    setInstallPrompt(null); setShowInstallBanner(false);
  };

  if (!user) {
    return (
      <div className="auth-wrap">
        <div className="auth-card">
          <h1 className="logo">🌸 Whisper</h1>
          <p className="subtitle">Private. Warm. Yours.</p>
          <h2>{isLogin ? 'Welcome back' : 'Create account'}</h2>
          {authErr && <div className="err">{authErr}</div>}
          <form onSubmit={handleAuth} className="auth-form">
            <input placeholder="Username" value={uInput} onChange={e => setUInput(e.target.value)} />
            <input type="password" placeholder="Password" value={pInput} onChange={e => setPInput(e.target.value)} />
            <button>{isLogin ? 'Login' : 'Register'}</button>
          </form>
          <p className="switch" onClick={() => { setIsLogin(!isLogin); setAuthErr(''); }}>
            {isLogin ? "New here? Register" : "Have account? Login"}
          </p>
        </div>
      </div>
    );
  }

  const wp = wallpapers[targetId];
  const chatStyle = {};
  if (wp) {
    if (wp.startsWith('url') || wp.startsWith('data:')) {
      chatStyle.backgroundImage = wp.startsWith('data:') ? `url(${wp})` : wp;
      chatStyle.backgroundSize = 'cover';
      chatStyle.backgroundPosition = 'center';
    } else {
      chatStyle.backgroundColor = wp;
    }
  }

  const visibleChat = searchQuery.trim()
    ? chat.filter(m => (m.message || '').toLowerCase().includes(searchQuery.toLowerCase()))
    : chat;

  const amIBlocking = blockedUsers.some(b => b.uniqueId === targetId);
  const showSidebar = !isMobile || !targetId;

  return (
    <div className="app">
      {showInstallBanner && installPrompt && (
        <div className="install-banner">
          <span>📱 Install Whisper as an app?</span>
          <button className="install-yes" onClick={triggerInstall}>Install</button>
          <button className="install-no" onClick={() => setShowInstallBanner(false)}>✕</button>
        </div>
      )}

      {toast && <div className="toast">{toast}</div>}

      {showSidebar && (
        <aside
          className={`sidebar ${sidebarCollapsed ? 'collapsed' : ''}`}
          style={{ width: isMobile ? '100vw' : (sidebarCollapsed ? 64 : sidebarWidth) }}
        >
          {sidebarCollapsed && !isMobile ? (
            <div className="collapsed-sidebar">
              <button className="expand-btn" onClick={() => setSidebarCollapsed(false)} title="Expand (Ctrl+B)">›</button>
              <div className="collapsed-avatar" onClick={() => setSidebarCollapsed(false)} title={user.username}>
                {user.profilePic
                  ? <img src={user.profilePic} className="avatar" />
                  : <div className="avatar-ph">{user.username[0]?.toUpperCase()}</div>}
              </div>
              <div className="collapsed-convos">
                {convos.map(c => (
                  <div
                    key={c.uniqueId}
                    className={`collapsed-convo ${targetId === c.uniqueId ? 'active' : ''}`}
                    onClick={() => openChat(c.uniqueId)}
                    title={c.username}
                  >
                    {c.profilePic ? <img src={c.profilePic} className="avatar" /> : <div className="avatar-ph">{c.username[0].toUpperCase()}</div>}
                    {c.isOnline && <span className="online-dot" />}
                  </div>
                ))}
              </div>
              <button className="expand-btn bottom" onClick={logout} title="Logout">🚪</button>
            </div>
          ) : (
            <>
              <div className="sidebar-top">
                <div className="profile-block">
                  <div className="avatar-wrap">
                    {user.profilePic
                      ? <img src={user.profilePic} className="avatar" />
                      : <div className="avatar-ph">{user.username[0]?.toUpperCase()}</div>}
                  </div>
                  <div className="profile-info">
                    <strong>{user.username}</strong>
                    <div className="small">ID: {user.uniqueId}</div>
                  </div>
                  <button className="icon-btn" onClick={openSettings} title="Settings">⚙️</button>
                  {!isMobile && (
                    <button className="icon-btn collapse-toggle" onClick={() => setSidebarCollapsed(true)} title="Collapse (Ctrl+B)">‹</button>
                  )}
                </div>
              </div>

              <div className="status-row">
                <div className="status-bubble" onClick={() => hasMyStatus ? setViewingStatus(myStatus) : setShowStatusModal(true)}>
                  <div className={`avatar-wrap ${hasMyStatus ? 'has-status' : ''}`}>
                    {user.profilePic
                      ? <img src={user.profilePic} className="avatar-ring" alt="" />
                      : <div className="avatar-ph ring">{user.username[0]?.toUpperCase()}</div>}
                    {!hasMyStatus && <span className="plus">+</span>}
                  </div>
                  <span>{hasMyStatus ? 'Your status' : 'Add status'}</span>
                </div>
                {statuses.filter(s => s.uniqueId !== user.uniqueId).map(s => (
                  <div key={s.uniqueId} className="status-bubble" onClick={() => setViewingStatus(s)}>
                    {s.profilePic
                      ? <img src={s.profilePic} className="avatar-ring" alt="" />
                      : <div className="avatar-ph ring">{s.username[0].toUpperCase()}</div>}
                    <span>{s.username}</span>
                  </div>
                ))}
              </div>

              <form onSubmit={startChat} className="new-chat">
                <input placeholder="New chat by ID..." value={newChatId} onChange={e => setNewChatId(e.target.value)} />
                <button>+</button>
              </form>

              <div className="convos">
                {convos.length === 0 && <p className="empty">No chats yet</p>}
                {convos.map(c => (
                  <div key={c.uniqueId} className={`convo ${targetId === c.uniqueId ? 'active' : ''}`} onClick={() => openChat(c.uniqueId)}>
                    <div className="avatar-wrap">
                      {c.profilePic ? <img src={c.profilePic} className="avatar" /> : <div className="avatar-ph">{c.username[0].toUpperCase()}</div>}
                      {c.isOnline && <span className="online-dot" />}
                    </div>
                    <div className="convo-info">
                      <div className="row">
                        <strong>{c.username}</strong>
                        {c.isOnline && <span className="badge-online">online</span>}
                      </div>
                      <p className="last-msg">{c.lastMessage}</p>
                    </div>
                  </div>
                ))}
              </div>

              <div className="sidebar-bottom">
                <button className="foot-btn danger" onClick={logout}>🚪 Logout</button>
              </div>
            </>
          )}
        </aside>
      )}

      {!sidebarCollapsed && !isMobile && <div className="resizer" onMouseDown={() => setResizing(true)} />}

      {(!isMobile || targetId) && (
        <main className="chat" style={chatStyle}>
          {targetId ? (
            <>
              <header className="chat-header">
                {isMobile && (
                  <button className="mobile-back" onClick={() => setTargetId('')} title="Back">←</button>
                )}
                <div className="chat-header-info">
                  <div className="avatar-wrap">
                    {targetPic ? <img src={targetPic} className="avatar" /> : <div className="avatar-ph">{targetName[0]?.toUpperCase()}</div>}
                    {targetOnline && <span className="online-dot" />}
                  </div>
                  <div>
                    <h3>{targetName}</h3>
                    <span className="sub">{typing ? 'typing…' : targetOnline ? 'online' : `last seen ${formatLastSeen(targetLastSeen)}`}</span>
                  </div>
                </div>

                <div className="chat-header-actions">
                  <button className="call-btn" onClick={() => setShowSearch(s => !s)} title="Search">🔍</button>
                  <button className="call-btn" onClick={() => startCall('audio')} disabled={!!call} title="Voice call">📞</button>
                  <button className="call-btn" onClick={() => startCall('video')} disabled={!!call} title="Video call">🎥</button>
                  <div className="menu-wrap" ref={menuRef}>
                    <button className="dots" onClick={() => setShowMenu(!showMenu)}>⋮</button>
                    {showMenu && (
                      <div className="dropdown">
                        <button onClick={() => { setShowWallpaperModal(true); setShowMenu(false); }}>🎨 Wallpaper</button>
                        {amIBlocking ? (
                          <button onClick={async () => { await unblockUser(targetId); setShowMenu(false); }}>✅ Unblock</button>
                        ) : (
                          <button onClick={blockUser}>🚫 Block</button>
                        )}
                        <button onClick={() => { setShowDeleteModal(true); setShowMenu(false); }}>🗑️ Delete Chat</button>
                      </div>
                    )}
                  </div>
                </div>
              </header>

              {showSearch && (
                <div className="search-bar">
                  <input
                    autoFocus
                    placeholder="Search messages..."
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                  />
                  {searchQuery && <span className="search-count">{visibleChat.length} found</span>}
                  <button className="search-close" onClick={() => { setShowSearch(false); setSearchQuery(''); }}>✕</button>
                </div>
              )}

              {iAmBlocked && (
                <div className="blocked-notice">
                  🚫 You can't message this user — they've blocked you.
                </div>
              )}
              {amIBlocking && !iAmBlocked && (
                <div className="blocked-notice you-blocked">
                  🚫 You blocked this user. <button onClick={async () => { await unblockUser(targetId); }}>Unblock</button>
                </div>
              )}

              {callError && (
                <div style={{ background: '#fee2e2', color: '#dc2626', padding: '8px 14px', fontSize: '12px', fontWeight: '600', textAlign: 'center' }}>{callError}</div>
              )}

              <div className="messages" ref={messagesRef}>
                {chat.length === 0 && <p className="empty">Say hi to {targetName} 👋</p>}
                {searchQuery && visibleChat.length === 0 && <p className="empty">No messages found</p>}
                {visibleChat.map((m, i) => {
                  const img = isImageMsg(m);
                  const aud = isAudioMsg(m);
                  const reactions = m.reactions || [];
                  const grouped = {};
                  reactions.forEach(r => { grouped[r.emoji] = (grouped[r.emoji] || 0) + 1; });
                  const myEmoji = reactions.find(r => r.userId === user.uniqueId)?.emoji;
                  return (
                    <div key={m._id || i} className={`msg-row ${m.type}`}>
                      <div className={`msg ${m.type}`}>
                        {m.replyTo && (
                          <div className="reply-quote">
                            <div className="reply-bar" />
                            <div className="reply-content">
                              <strong>{m.replyTo.senderId === user.uniqueId ? 'You' : targetName}</strong>
                              <span>{m.replyTo.messageType === 'image' ? '📷 Photo'
                                   : m.replyTo.messageType === 'audio' ? '🎤 Voice'
                                   : m.replyTo.message}</span>
                            </div>
                          </div>
                        )}
                        {img ? (
                          <img src={m.message} className="msg-img" alt="attachment" onClick={() => setLightbox(m.message)} />
                        ) : aud ? (
                          <div className="audio-bubble">
                            <span className="audio-icon">🎤</span>
                            <audio src={m.message} controls className="audio-msg" preload="metadata" />
                          </div>
                        ) : (
                          <span className="msg-text">{m.message}</span>
                        )}
                        <div className="msg-meta">
                          {m.edited && <span className="edited-tag">edited</span>}
                          <span className="msg-time">{fmtTime(m.timestamp)}</span>
                          {m.type === 'sent' && (
                            <span className={`read-tick ${m.read ? 'read' : ''}`}>{m.read ? '✓✓' : '✓'}</span>
                          )}
                        </div>
                        {Object.keys(grouped).length > 0 && (
                          <div className="reactions">
                            {Object.entries(grouped).map(([emoji, count]) => (
                              <span
                                key={emoji}
                                className={`reaction-chip ${myEmoji === emoji ? 'mine' : ''}`}
                                onClick={() => !isTemp(m._id) && toggleReaction(m._id, emoji)}
                              >
                                {emoji}{count > 1 ? ` ${count}` : ''}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                      <div className="msg-side">
                        <button className="msg-more" onClick={(e) => openMsgMenu(e, m)}>⋮</button>
                        <button
                          className="emoji-trigger"
                          onClick={(e) => { e.stopPropagation(); setEmojiPickerFor(emojiPickerFor === m._id ? null : m._id); }}
                          title="React"
                        >😊</button>
                        {emojiPickerFor === m._id && !isTemp(m._id) && (
                          <div className={`emoji-picker ${m.type === 'sent' ? 'from-right' : 'from-left'}`}>
                            {QUICK_EMOJI.map(e => (
                              <button key={e} onClick={() => toggleReaction(m._id, e)}>{e}</button>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
                {typing && <div className="typing">{targetName} is typing...</div>}
                <div ref={chatEnd} />
              </div>

              {replyTo && (
                <div className="reply-preview">
                  <div className="reply-preview-bar" />
                  <div className="reply-preview-content">
                    <strong>Replying to {replyTo.senderId === user.uniqueId ? 'yourself' : targetName}</strong>
                    <span>{replyTo.messageType === 'image' ? '📷 Photo'
                         : replyTo.messageType === 'audio' ? '🎤 Voice'
                         : replyTo.message}</span>
                  </div>
                  <button className="reply-preview-close" onClick={() => setReplyTo(null)}>✕</button>
                </div>
              )}

              {recording ? (
                <form className="composer recording" onSubmit={e => e.preventDefault()}>
                  <button type="button" className="icon cancel-rec" onClick={cancelRecording}>✕</button>
                  <span className="rec-timer">● {fmtSecs(recTime)}</span>
                  <span className="rec-hint">Recording… tap ➤ to send</span>
                  <button type="button" className="send rec-send" onClick={stopRecording}>➤</button>
                </form>
              ) : (
                <form className="composer" onSubmit={sendMsg}>
                  <button type="button" className="icon" onClick={() => chatImgRef.current.click()} disabled={amIBlocking}>📷</button>
                  <input ref={chatImgRef} type="file" accept="image/*" hidden onChange={onChatPic} />
                  <button type="button" className="icon" onClick={startRecording} disabled={amIBlocking} title="Record">🎤</button>
                  <div className="composer-input-wrap" ref={composerEmojiRef}>
                    <button
                      type="button"
                      className="composer-emoji-btn"
                      onClick={() => setShowComposerEmoji(s => !s)}
                      disabled={amIBlocking}
                      title="Emoji"
                    >😊</button>
                    {showComposerEmoji && (
                      <div className="composer-emoji-panel">
                        {COMPOSER_EMOJI.map((em, i) => (
                          <button key={i} onClick={() => insertEmoji(em)} className="composer-emoji-item">{em}</button>
                        ))}
                      </div>
                    )}
                  </div>
                  <input
                    ref={messageInputRef}
                    className="text"
                    placeholder={iAmBlocked ? "You can't reply" : (replyTo ? 'Write a reply...' : 'Type a message...')}
                    value={message}
                    onChange={onTyping}
                    disabled={iAmBlocked}
                  />
                  <button className="send" disabled={!message || iAmBlocked || amIBlocking}>➤</button>
                </form>
              )}
            </>
          ) : (
            <div className="empty-chat">
              <h1>🌸 Whisper</h1>
              <p>Select a chat or start a new one</p>
            </div>
          )}
        </main>
      )}

      {call && (
        <div className="call-overlay">
          <div className={`call-modal ${call.type === 'video' ? 'video-mode' : 'audio-mode'}`}>
            <video ref={remoteVideoRef} autoPlay playsInline className={call.type === 'video' ? 'remote-video' : 'remote-video hidden-media'} />
            <video ref={localVideoRef} autoPlay playsInline muted className={call.type === 'video' ? 'local-video' : 'local-video hidden-media'} />
            {(call.type === 'audio' || call.status === 'ringing' || call.status === 'calling') && (
              <div className="call-avatar-wrap">
                <div className="call-avatar">
                  {call.peerPic ? <img src={call.peerPic} alt="" /> : <div className="avatar-ph big">{call.peerName?.[0]?.toUpperCase() || '?'}</div>}
                </div>
                {call.status !== 'connected' && <div className="call-pulse" />}
              </div>
            )}
            <div className="call-info">
              <h2>{call.peerName}</h2>
              <p>
                {call.status === 'ringing' && 'Incoming call…'}
                {call.status === 'calling' && 'Calling…'}
                {call.status === 'connected' && (call.type === 'video' ? 'Video call' : 'Voice call')}
              </p>
            </div>
            <div className="call-controls">
              {call.incoming && call.status === 'ringing' ? (
                <>
                  <button className="call-ctrl reject" onClick={rejectCall}>✕</button>
                  <button className="call-ctrl accept" onClick={acceptCall}>✓</button>
                </>
              ) : (
                <>
                  <button className={`call-ctrl ${muted ? 'active' : ''}`} onClick={toggleMute}>{muted ? '🔇' : '🎤'}</button>
                  {call.type === 'video' && (
                    <button className={`call-ctrl ${cameraOff ? 'active' : ''}`} onClick={toggleCamera}>{cameraOff ? '📷' : '📹'}</button>
                  )}
                  <button className="call-ctrl end" onClick={hangUp}>📵</button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {msgMenu && (
        <div className="msg-menu-fixed" style={{ top: msgMenu.top, left: msgMenu.left }} onMouseDown={e => e.stopPropagation()}>
          <button onClick={startReply}>↩️ Reply</button>
          {msgMenu.isMine && !msgMenu.isImage && <button onClick={startEdit}>✏️ Edit</button>}
          <button onClick={() => startSingleDelete(msgMenu.isMine)}>🗑️ Delete for me</button>
          {msgMenu.isMine && <button className="danger" onClick={() => startSingleDelete(msgMenu.isMine)}>❌ Delete for everyone</button>}
        </div>
      )}

      {showSettings && (
        <div className="overlay" onClick={() => setShowSettings(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h2>Profile Settings</h2>
            <div className="avatar-upload">
              {editPic ? <img src={editPic} className="avatar big" /> : <div className="avatar-ph big">{editName[0]?.toUpperCase()}</div>}
              <button onClick={() => imgInputRef.current.click()}>Change Photo</button>
              <input ref={imgInputRef} type="file" accept="image/*" hidden onChange={onProfilePic} />
            </div>
            <label>Username</label>
            <input value={editName} onChange={e => setEditName(e.target.value)} />
            <div className="theme-row">
              <span>Dark Mode</span>
              <button className={`toggle ${darkMode ? 'on' : ''}`} onClick={() => setDarkMode(!darkMode)}><span className="knob" /></button>
            </div>
            {blockedUsers.length > 0 && (
              <div className="blocked-section">
                <label>Blocked Users ({blockedUsers.length})</label>
                <div className="blocked-list">
                  {blockedUsers.map(b => (
                    <div key={b.uniqueId} className="blocked-item">
                      <span>{b.username} <small>({b.uniqueId})</small></span>
                      <button onClick={() => unblockUser(b.uniqueId)}>Unblock</button>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div className="modal-actions">
              <button className="cancel" onClick={() => setShowSettings(false)}>Cancel</button>
              <button className="save" onClick={saveSettings}>Save</button>
            </div>
          </div>
        </div>
      )}

      {showDeleteModal && (
        <div className="overlay" onClick={() => !deleting && setShowDeleteModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h2>Delete this chat?</h2>
            <p className="muted">Choose how you want to delete this conversation.</p>
            <div className="delete-opts">
              <button className="opt" disabled={deleting} onClick={() => deleteChat('me')}><strong>Delete for me</strong><span>Hides chat for you only</span></button>
              <button className="opt danger" disabled={deleting} onClick={() => deleteChat('all')}><strong>Delete for everyone</strong><span>Permanently removes for both</span></button>
            </div>
            <button className="cancel full" disabled={deleting} onClick={() => setShowDeleteModal(false)}>{deleting ? 'Deleting...' : 'Cancel'}</button>
          </div>
        </div>
      )}

      {singleDelete && (
        <div className="overlay" onClick={() => setSingleDelete(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h2>Delete this message?</h2>
            <div className="delete-opts">
              <button className="opt" onClick={() => deleteMessage('me')}><strong>Delete for me</strong><span>Removes from your view only</span></button>
              {singleDelete.isMine && (
                <button className="opt danger" onClick={() => deleteMessage('all')}><strong>Delete for everyone</strong><span>Removes for both users</span></button>
              )}
            </div>
            <button className="cancel full" onClick={() => setSingleDelete(null)}>Cancel</button>
          </div>
        </div>
      )}

      {editTarget && (
        <div className="overlay" onClick={() => !editSaving && setEditTarget(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h2>Edit Message</h2>
            <textarea value={editText} onChange={e => setEditText(e.target.value)} rows={4} autoFocus />
            <div className="modal-actions">
              <button className="cancel" disabled={editSaving} onClick={() => setEditTarget(null)}>Cancel</button>
              <button className="save" onClick={saveEdit} disabled={!editText.trim() || editSaving}>{editSaving ? 'Saving...' : 'Save'}</button>
            </div>
          </div>
        </div>
      )}

      {showWallpaperModal && (
        <div className="overlay" onClick={() => setShowWallpaperModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h2>Choose Wallpaper</h2>
            <div className="wallpaper-grid">
              {['#fff5f5', '#ffe4e6', '#fef3c7', '#fff7ed', '#fce7f3', '#1a1a1a', '#450a0a', '#78350f'].map(c => (
                <div key={c} className="wp-swatch" style={{ background: c }} onClick={() => setWallpaper(c)} />
              ))}
            </div>
            <label className="upload-wp">
              📷 Upload Custom
              <input type="file" accept="image/*" hidden onChange={async (e) => {
                const f = e.target.files[0]; if (!f) return;
                setWallpaper(`url(${await compressImage(f, 1400, 0.7)})`);
              }} />
            </label>
            <button className="cancel full" onClick={() => setShowWallpaperModal(false)}>Close</button>
          </div>
        </div>
      )}

      {showStatusModal && (
        <div className="overlay" onClick={() => setShowStatusModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h2>Post Status</h2>
            <textarea placeholder="What's on your mind?" value={statusText} onChange={e => setStatusText(e.target.value)} rows={4} />
            <button className="opt" onClick={() => statusImgRef.current.click()}>
              {statusPic ? '✅ Photo selected' : '📷 Add Photo'}
            </button>
            <input ref={statusImgRef} type="file" accept="image/*" hidden onChange={onStatusPic} />
            <div className="modal-actions">
              <button className="cancel" onClick={() => setShowStatusModal(false)}>Cancel</button>
              <button className="save" onClick={postStatus}>Post</button>
            </div>
          </div>
        </div>
      )}

      {viewingStatus && (
        <div className="overlay status-view" onClick={() => setViewingStatus(null)}>
          <div className="status-card" onClick={e => e.stopPropagation()}>
            <div className="status-header">
              {viewingStatus.profilePic
                ? <img src={viewingStatus.profilePic} className="avatar" />
                : <div className="avatar-ph">{viewingStatus.username[0]}</div>}
              <strong>{viewingStatus.uniqueId === user.uniqueId ? 'Your Status' : viewingStatus.username}</strong>
              {viewingStatus.uniqueId === user.uniqueId && (
                <button className="x" onClick={deleteMyStatus} title="Delete my status" style={{ marginLeft: 'auto' }}>🗑️</button>
              )}
              <button className="x" onClick={() => setViewingStatus(null)}>✕</button>
            </div>
            <div className="status-body">
              {viewingStatus.items.map((it, i) =>
                it.type === 'image'
                  ? <img key={i} src={it.content} className="status-img" />
                  : <div key={i} className="status-text">{it.content}</div>
              )}
            </div>
          </div>
        </div>
      )}

      {lightbox && (
        <div className="lightbox" onClick={() => setLightbox(null)}>
          <button className="lightbox-close" onClick={() => setLightbox(null)}>✕</button>
          <img src={lightbox} className="lightbox-img" alt="full" onClick={e => e.stopPropagation()} />
        </div>
      )}
    </div>
  );
}