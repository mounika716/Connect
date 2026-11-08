const dns = require('dns');
try { dns.setServers(['8.8.8.8', '8.8.4.4']); } catch (e) { }

require('dotenv').config();
const express = require('express');
const http = require('http');
const mongoose = require('mongoose');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const jwt = require('jsonwebtoken');
const { Server } = require('socket.io');
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcryptjs');
const User = require('./models/User');
const Message = require('./models/Message');

const app = express();

const ALLOWED_ORIGINS = process.env.FRONTEND_URL 
  ? process.env.FRONTEND_URL.split(',') 
  : ['http://localhost:5173', 'http://localhost:3000'];

app.use(cors({ origin: ALLOWED_ORIGINS, credentials: true }));
app.use(express.json({ limit: '30mb' }));

const apiLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 500 });
app.use('/api', apiLimiter);

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: ALLOWED_ORIGINS, methods: ['GET', 'POST', 'PUT', 'DELETE'], credentials: true },
  maxHttpBufferSize: 1e8
});

const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/connect';
const JWT_SECRET = process.env.JWT_SECRET || 'super-secret-connect-key-change-in-production';

console.log('Connecting to MongoDB...');
mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 15000, family: 4 })
  .then(() => console.log('✅ MongoDB Connected'))
  .catch(err => console.error('❌ MongoDB connection FAILED:', err.message));

const online = {};

// --- JWT MIDDLEWARE ---
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Access denied. No token provided.' });

  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    if (err) return res.status(403).json({ error: 'Invalid or expired token' });
    req.user = decoded;
    next();
  });
};

// --- AUTH ROUTES ---
app.post('/api/register', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Missing fields' });
    if (await User.findOne({ username })) return res.status(400).json({ error: 'Username taken' });
    
    const salt = await bcrypt.genSalt(10);
    const hash = await bcrypt.hash(password, salt);
    const u = new User({ uniqueId: uuidv4().slice(0, 8), username, password: hash });
    await u.save();

    const token = jwt.sign({ uniqueId: u.uniqueId, username: u.username }, JWT_SECRET, { expiresIn: '7d' });
    res.status(201).json({ uniqueId: u.uniqueId, username: u.username, profilePic: u.profilePic, token });
  } catch (e) {
    console.error('register error:', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const u = await User.findOne({ username });
    if (!u || !(await bcrypt.compare(password, u.password)))
      return res.status(400).json({ error: 'Invalid credentials' });

    const token = jwt.sign({ uniqueId: u.uniqueId, username: u.username }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ uniqueId: u.uniqueId, username: u.username, profilePic: u.profilePic, token });
  } catch (e) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// --- PROTECTED USER ROUTES ---
app.get('/api/users/:uniqueId', authenticateToken, async (req, res) => {
  try {
    const u = await User.findOne({ uniqueId: req.params.uniqueId });
    if (!u) return res.status(404).json({ error: 'User not found' });
    res.json({ uniqueId: u.uniqueId, username: u.username, profilePic: u.profilePic, isOnline: u.isOnline, lastSeen: u.lastSeen, blocked: u.blocked || [] });
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

app.put('/api/users/:uniqueId', authenticateToken, async (req, res) => {
  try {
    if (req.user.uniqueId !== req.params.uniqueId) return res.status(403).json({ error: 'Unauthorized' });
    const { username, profilePic } = req.body;
    if (username) {
      const exists = await User.findOne({ username });
      if (exists && exists.uniqueId !== req.params.uniqueId) return res.status(400).json({ error: 'Username taken' });
    }
    const u = await User.findOneAndUpdate({ uniqueId: req.params.uniqueId }, { ...(username && { username }), ...(profilePic !== undefined && { profilePic }) }, { returnDocument: 'after' });
    res.json({ uniqueId: u.uniqueId, username: u.username, profilePic: u.profilePic });
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

app.post('/api/users/:uniqueId/block', authenticateToken, async (req, res) => {
  try {
    await User.updateOne({ uniqueId: req.user.uniqueId }, { $addToSet: { blocked: req.params.uniqueId } });
    res.json({ success: true, blocked: req.params.uniqueId });
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

app.post('/api/users/:uniqueId/unblock', authenticateToken, async (req, res) => {
  try {
    await User.updateOne({ uniqueId: req.user.uniqueId }, { $pull: { blocked: req.params.uniqueId } });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

app.get('/api/users/:uniqueId/blocked', authenticateToken, async (req, res) => {
  try {
    if (req.user.uniqueId !== req.params.uniqueId) return res.status(403).json({ error: 'Unauthorized' });
    const u = await User.findOne({ uniqueId: req.params.uniqueId });
    const users = await User.find({ uniqueId: { $in: u.blocked || [] } });
    res.json(users.map(x => ({ uniqueId: x.uniqueId, username: x.username, profilePic: x.profilePic })));
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// --- PROTECTED MESSAGE ROUTES ---
app.get('/api/messages/:a/:b', authenticateToken, async (req, res) => {
  try {
    const { a, b } = req.params;
    if (req.user.uniqueId !== a && req.user.uniqueId !== b) return res.status(403).json({ error: 'Unauthorized' });
    const msgs = await Message.find({ $or: [{ senderId: a, receiverId: b }, { senderId: b, receiverId: a }], deletedFor: { $ne: a } }).sort({ timestamp: 1 });
    res.json(msgs);
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

app.get('/api/conversations/:userId', authenticateToken, async (req, res) => {
  try {
    if (req.user.uniqueId !== req.params.userId) return res.status(403).json({ error: 'Unauthorized' });
    const msgs = await Message.find({ $or: [{ senderId: req.params.userId }, { receiverId: req.params.userId }], deletedFor: { $ne: req.params.userId } }).sort({ timestamp: -1 });
    const partners = new Set();
    const latest = {};
    msgs.forEach(m => {
      const p = m.senderId === req.params.userId ? m.receiverId : m.senderId;
      partners.add(p);
      if (!latest[p]) latest[p] = m;
    });
    const users = await User.find({ uniqueId: { $in: [...partners] } });
    const convos = users.map(u => {
      const last = latest[u.uniqueId];
      return { uniqueId: u.uniqueId, username: u.username, profilePic: u.profilePic, isOnline: u.isOnline, lastSeen: u.lastSeen, lastMessage: last.messageType === 'image' ? '📷 Photo' : last.messageType === 'audio' ? '🎤 Voice message' : last.message, timestamp: last.timestamp };
    });
    convos.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    res.json(convos);
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

app.post('/api/messages/read', authenticateToken, async (req, res) => {
  try {
    const result = await Message.updateMany({ senderId: req.body.senderId, receiverId: req.user.uniqueId, read: false }, { read: true });
    if (result.modifiedCount > 0 && online[req.body.senderId]) io.to(online[req.body.senderId]).emit('messages_read', { by: req.user.uniqueId });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

app.post('/api/messages/:id/react', authenticateToken, async (req, res) => {
  try {
    const msg = await Message.findById(req.params.id);
    if (!msg) return res.status(404).json({ error: 'Not found' });
    msg.reactions = msg.reactions || [];
    const idx = msg.reactions.findIndex(r => r.userId === req.user.uniqueId && r.emoji === req.body.emoji);
    if (idx >= 0) msg.reactions.splice(idx, 1);
    else { msg.reactions = msg.reactions.filter(r => r.userId !== req.user.uniqueId); msg.reactions.push({ emoji: req.body.emoji, userId: req.user.uniqueId }); }
    await msg.save();
    const payload = { _id: msg._id.toString(), reactions: msg.reactions };
    if (online[msg.senderId]) io.to(online[msg.senderId]).emit('message_reacted', payload);
    if (online[msg.receiverId]) io.to(online[msg.receiverId]).emit('message_reacted', payload);
    res.json({ reactions: msg.reactions });
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

app.put('/api/messages/:id', authenticateToken, async (req, res) => {
  try {
    const msg = await Message.findById(req.params.id);
    if (!msg) return res.status(404).json({ error: 'Not found' });
    if (msg.senderId !== req.user.uniqueId) return res.status(403).json({ error: 'Unauthorized' });
    msg.message = req.body.message; msg.edited = true; await msg.save();
    const payload = { _id: msg._id.toString(), senderId: msg.senderId, receiverId: msg.receiverId, message: msg.message, messageType: 'text', edited: true, timestamp: msg.timestamp };
    if (online[msg.senderId]) io.to(online[msg.senderId]).emit('message_edited', payload);
    if (online[msg.receiverId]) io.to(online[msg.receiverId]).emit('message_edited', payload);
    res.json(payload);
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

app.delete('/api/messages/:id/me', authenticateToken, async (req, res) => {
  try {
    await Message.updateOne({ _id: req.params.id }, { $addToSet: { deletedFor: req.user.uniqueId } });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

app.delete('/api/messages/:id/all', authenticateToken, async (req, res) => {
  try {
    const msg = await Message.findById(req.params.id);
    if (!msg) return res.status(404).json({ error: 'Not found' });
    if (msg.senderId !== req.user.uniqueId) return res.status(403).json({ error: 'Unauthorized' });
    await Message.deleteOne({ _id: req.params.id });
    const payload = { _id: req.params.id };
    if (online[msg.senderId]) io.to(online[msg.senderId]).emit('message_deleted', payload);
    if (online[msg.receiverId]) io.to(online[msg.receiverId]).emit('message_deleted', payload);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

app.delete('/api/messages/:u1/:u2/me', authenticateToken, async (req, res) => {
  try {
    const { u1, u2 } = req.params;
    if (req.user.uniqueId !== u1 && req.user.uniqueId !== u2) return res.status(403).json({ error: 'Unauthorized' });
    await Message.updateMany({ $or: [{ senderId: u1, receiverId: u2 }, { senderId: u2, receiverId: u1 }] }, { $addToSet: { deletedFor: req.user.uniqueId } });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

app.delete('/api/messages/:u1/:u2/all', authenticateToken, async (req, res) => {
  try {
    const { u1, u2 } = req.params;
    if (req.user.uniqueId !== u1 && req.user.uniqueId !== u2) return res.status(403).json({ error: 'Unauthorized' });
    await Message.deleteMany({ $or: [{ senderId: u1, receiverId: u2 }, { senderId: u2, receiverId: u1 }] });
    if (online[u1]) io.to(online[u1]).emit('chat_deleted', { withUser: u2 });
    if (online[u2]) io.to(online[u2]).emit('chat_deleted', { withUser: u1 });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

app.post('/api/status', authenticateToken, async (req, res) => {
  try {
    const u = await User.findOne({ uniqueId: req.user.uniqueId });
    u.status = (u.status || []).filter(s => Date.now() - new Date(s.createdAt) < 86400000);
    u.status.push({ type: req.body.type, content: req.body.content });
    await u.save();
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

app.get('/api/status', authenticateToken, async (req, res) => {
  try {
    const cutoff = new Date(Date.now() - 86400000);
    const users = await User.find({ 'status.0': { $exists: true } });
    res.json(users.map(u => ({ uniqueId: u.uniqueId, username: u.username, profilePic: u.profilePic, items: (u.status || []).filter(s => new Date(s.createdAt) > cutoff) })).filter(s => s.items.length > 0));
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

app.delete('/api/status/:uniqueId', authenticateToken, async (req, res) => {
  try {
    if (req.user.uniqueId !== req.params.uniqueId) return res.status(403).json({ error: 'Unauthorized' });
    await User.updateOne({ uniqueId: req.params.uniqueId }, { status: [] });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

app.get('/', (req, res) => res.json({ status: 'ok', database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected' }));

// --- SOCKET.IO SECURITY MIDDLEWARE ---
io.use((socket, next) => {
  const token = socket.handshake.auth.token;
  if (!token) return next(new Error('Authentication error'));
  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    if (err) return next(new Error('Authentication error'));
    socket.user = decoded; 
    next();
  });
});

io.on('connection', (socket) => {
  const uniqueId = socket.user.uniqueId;
  online[uniqueId] = socket.id;
  User.updateOne({ uniqueId }, { isOnline: true }).catch(() => {});
  io.emit('presence', { uniqueId, isOnline: true });

  socket.on('typing', ({ targetUniqueId }) => { if (online[targetUniqueId]) io.to(online[targetUniqueId]).emit('user_typing'); });
  socket.on('stop_typing', ({ targetUniqueId }) => { if (online[targetUniqueId]) io.to(online[targetUniqueId]).emit('user_stop_typing'); });

  socket.on('send_message', async (data) => {
    const { targetUniqueId, message, messageType, replyTo } = data;
    const senderId = socket.user.uniqueId;
    const senderUsername = socket.user.username;
    try {
      const [sender, receiver] = await Promise.all([User.findOne({ uniqueId: senderId }), User.findOne({ uniqueId: targetUniqueId })]);
      if (!receiver) return socket.emit('send_error', { error: 'User not found' });
      if ((receiver.blocked || []).includes(senderId)) return socket.emit('send_error', { error: 'You are blocked' });
      if ((sender.blocked || []).includes(targetUniqueId)) return socket.emit('send_error', { error: 'You blocked this user' });

      const m = new Message({ senderId, receiverId: targetUniqueId, message, messageType: messageType || 'text', replyTo: replyTo || undefined, reactions: [] });
      await m.save();
      
      const payload = { _id: m._id.toString(), senderId, senderUsername, message, messageType: m.messageType, timestamp: m.timestamp, edited: false, read: false, reactions: [], replyTo: m.replyTo };
      if (online[targetUniqueId]) io.to(online[targetUniqueId]).emit('receive_message', payload);
      socket.emit('receive_message', payload);
    } catch (e) { console.log('send_message error:', e.message); }
  });

  socket.on('call_user', ({ to, type, offer }) => {
    if (online[to]) io.to(online[to]).emit('incoming_call', { from: uniqueId, fromName: socket.user.username, type, offer });
    else socket.emit('call_unavailable', { to });
  });
  socket.on('call_response', ({ to, accepted, answer }) => { if (online[to]) io.to(online[to]).emit('call_response', { from: uniqueId, accepted, answer }); });
  socket.on('webrtc_ice', ({ to, candidate }) => { if (online[to]) io.to(online[to]).emit('webrtc_ice', { candidate }); });
  socket.on('call_end', ({ to }) => { if (online[to]) io.to(online[to]).emit('call_ended'); });

  socket.on('disconnect', async () => {
    if (online[uniqueId] === socket.id) {
      delete online[uniqueId];
      await User.updateOne({ uniqueId }, { isOnline: false, lastSeen: new Date() }).catch(() => {});
      io.emit('presence', { uniqueId, isOnline: false, lastSeen: new Date() });
    }
  });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`🚀 Secure Server running on port ${PORT}`));