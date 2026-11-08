const dns = require('dns');
try {
  dns.setServers(['8.8.8.8', '8.8.4.4', '1.1.1.1']);
  console.log('DNS servers set:', dns.getServers());
} catch (e) { console.warn('DNS setServers failed:', e.message); }

require('dotenv').config();

const express = require('express');
const http = require('http');
const mongoose = require('mongoose');
const cors = require('cors');
const { Server } = require('socket.io');
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcryptjs');
const User = require('./models/User');
const Message = require('./models/Message');

const app = express();
app.use(cors());
app.use(express.json({ limit: '30mb' }));

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST', 'PUT', 'DELETE'] },
  maxHttpBufferSize: 1e8
});

// --- MongoDB Connection ---
const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/chatapp';

console.log('Connecting to MongoDB...');
if (MONGO_URI.includes('mongodb+srv://')) {
  const host = MONGO_URI.split('@')[1]?.split('/')[0] || 'unknown';
  console.log('   mode: SRV (Atlas)');
  console.log('   host:', host);
} else if (MONGO_URI.includes('.mongodb.net')) {
  const hosts = MONGO_URI.split('@')[1]?.split('/')[0]?.split(',') || [];
  console.log('   mode: Legacy (Atlas direct hosts)');
  console.log('   hosts:', hosts);
} else {
  console.log('   mode: Local');
}

mongoose.connect(MONGO_URI, {
  serverSelectionTimeoutMS: 15000,
  socketTimeoutMS: 45000,
  family: 4,
})
  .then(() => console.log('✅ MongoDB Connected'))
  .catch(err => {
    console.error('❌ MongoDB connection FAILED:', err.message);
    console.error('   → Check: DB user exists? Password correct? IP whitelisted (0.0.0.0/0)?');
  });

mongoose.connection.on('connected', () => console.log('   [mongo] connected'));
mongoose.connection.on('error', (err) => console.error('   [mongo] error:', err.message));
mongoose.connection.on('disconnected', () => console.warn('   [mongo] disconnected'));

const online = {};

// --- AUTH ---
app.post('/api/register', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Missing fields' });
    if (await User.findOne({ username })) return res.status(400).json({ error: 'Username taken' });
    const salt = await bcrypt.genSalt(10);
    const hash = await bcrypt.hash(password, salt);
    const u = new User({ uniqueId: uuidv4().slice(0, 8), username, password: hash });
    await u.save();
    res.status(201).json({ uniqueId: u.uniqueId, username: u.username, profilePic: u.profilePic });
  } catch (e) {
    console.error('register error:', e);
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Missing fields' });
    const u = await User.findOne({ username });
    if (!u || !(await bcrypt.compare(password, u.password)))
      return res.status(400).json({ error: 'Invalid credentials' });
    res.json({ uniqueId: u.uniqueId, username: u.username, profilePic: u.profilePic });
  } catch (e) {
    console.error('login error:', e);
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/users/:uniqueId', async (req, res) => {
  try {
    const u = await User.findOne({ uniqueId: req.params.uniqueId });
    if (!u) return res.status(404).json({ error: 'User not found' });
    res.json({
      uniqueId: u.uniqueId, username: u.username, profilePic: u.profilePic,
      isOnline: u.isOnline, lastSeen: u.lastSeen, blocked: u.blocked || []
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/users/:uniqueId', async (req, res) => {
  try {
    const { username, profilePic } = req.body;
    if (username) {
      const exists = await User.findOne({ username });
      if (exists && exists.uniqueId !== req.params.uniqueId)
        return res.status(400).json({ error: 'Username taken' });
    }
    const u = await User.findOneAndUpdate(
      { uniqueId: req.params.uniqueId },
      { ...(username && { username }), ...(profilePic !== undefined && { profilePic }) },
      { returnDocument: 'after' }
    );
    if (!u) return res.status(404).json({ error: 'User not found' });
    res.json({ uniqueId: u.uniqueId, username: u.username, profilePic: u.profilePic });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// BLOCK / UNBLOCK
app.post('/api/users/:uniqueId/block', async (req, res) => {
  try {
    const { blockerId } = req.body;
    if (!blockerId) return res.status(400).json({ error: 'Missing blockerId' });
    const target = await User.findOne({ uniqueId: req.params.uniqueId });
    if (!target) return res.status(404).json({ error: 'User not found' });
    await User.updateOne({ uniqueId: blockerId }, { $addToSet: { blocked: req.params.uniqueId } });
    res.json({ success: true, blocked: req.params.uniqueId });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/users/:uniqueId/unblock', async (req, res) => {
  try {
    const { blockerId } = req.body;
    if (!blockerId) return res.status(400).json({ error: 'Missing blockerId' });
    await User.updateOne({ uniqueId: blockerId }, { $pull: { blocked: req.params.uniqueId } });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/users/:uniqueId/blocked', async (req, res) => {
  try {
    const u = await User.findOne({ uniqueId: req.params.uniqueId });
    if (!u) return res.status(404).json({ error: 'Not found' });
    const ids = u.blocked || [];
    const users = await User.find({ uniqueId: { $in: ids } });
    res.json(users.map(x => ({ uniqueId: x.uniqueId, username: x.username, profilePic: x.profilePic })));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// --- MESSAGES ---
app.get('/api/messages/:a/:b', async (req, res) => {
  try {
    const { a, b } = req.params;
    const msgs = await Message.find({
      $or: [{ senderId: a, receiverId: b }, { senderId: b, receiverId: a }],
      deletedFor: { $ne: a }
    }).sort({ timestamp: 1 });
    res.json(msgs);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/conversations/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const msgs = await Message.find({
      $or: [{ senderId: userId }, { receiverId: userId }],
      deletedFor: { $ne: userId }
    }).sort({ timestamp: -1 });
    const partners = new Set();
    const latest = {};
    msgs.forEach(m => {
      const p = m.senderId === userId ? m.receiverId : m.senderId;
      partners.add(p);
      if (!latest[p]) latest[p] = m;
    });
    const users = await User.find({ uniqueId: { $in: [...partners] } });
    const convos = users.map(u => {
      const last = latest[u.uniqueId];
      let preview = last.message;
      if (last.messageType === 'image') preview = '📷 Photo';
      else if (last.messageType === 'audio') preview = '🎤 Voice message';
      return {
        uniqueId: u.uniqueId, username: u.username, profilePic: u.profilePic,
        isOnline: u.isOnline, lastSeen: u.lastSeen, lastMessage: preview, timestamp: last.timestamp
      };
    });
    convos.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    res.json(convos);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/messages/read', async (req, res) => {
  try {
    const { readerId, senderId } = req.body;
    if (!readerId || !senderId) return res.status(400).json({ error: 'Missing params' });
    const result = await Message.updateMany(
      { senderId, receiverId: readerId, read: false },
      { read: true }
    );
    if (result.modifiedCount > 0 && online[senderId]) {
      io.to(online[senderId]).emit('messages_read', { by: readerId });
    }
    res.json({ success: true, count: result.modifiedCount });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/messages/:id/react', async (req, res) => {
  try {
    const { userId, emoji } = req.body;
    if (!userId || !emoji) return res.status(400).json({ error: 'Missing params' });
    const msg = await Message.findById(req.params.id);
    if (!msg) return res.status(404).json({ error: 'Not found' });
    msg.reactions = msg.reactions || [];
    const idx = msg.reactions.findIndex(r => r.userId === userId && r.emoji === emoji);
    if (idx >= 0) msg.reactions.splice(idx, 1);
    else {
      msg.reactions = msg.reactions.filter(r => r.userId !== userId);
      msg.reactions.push({ emoji, userId });
    }
    await msg.save();
    const payload = { _id: msg._id.toString(), reactions: msg.reactions };
    if (online[msg.senderId]) io.to(online[msg.senderId]).emit('message_reacted', payload);
    if (online[msg.receiverId]) io.to(online[msg.receiverId]).emit('message_reacted', payload);
    res.json({ reactions: msg.reactions });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/messages/:id', async (req, res) => {
  try {
    const { message, senderId } = req.body;
    if (!message || !senderId) return res.status(400).json({ error: 'Missing fields' });
    if (!mongoose.Types.ObjectId.isValid(req.params.id))
      return res.status(400).json({ error: 'Invalid message ID' });
    const msg = await Message.findById(req.params.id);
    if (!msg) return res.status(404).json({ error: 'Not found' });
    if (msg.senderId !== senderId) return res.status(403).json({ error: 'Not allowed' });
    if ((msg.messageType || 'text') !== 'text') return res.status(400).json({ error: 'Only text' });
    msg.message = message;
    msg.edited = true;
    await msg.save();
    const payload = {
      _id: msg._id.toString(), senderId: msg.senderId, receiverId: msg.receiverId,
      message: msg.message, messageType: 'text', edited: true, timestamp: msg.timestamp
    };
    if (online[msg.senderId]) io.to(online[msg.senderId]).emit('message_edited', payload);
    if (online[msg.receiverId]) io.to(online[msg.receiverId]).emit('message_edited', payload);
    res.json(payload);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/messages/:id/me', async (req, res) => {
  try {
    const userId = req.query.userId;
    if (!userId) return res.status(400).json({ error: 'Missing userId' });
    await Message.updateOne({ _id: req.params.id }, { $addToSet: { deletedFor: userId } });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/messages/:id/all', async (req, res) => {
  try {
    const msg = await Message.findById(req.params.id);
    if (!msg) return res.status(404).json({ error: 'Not found' });
    await Message.deleteOne({ _id: req.params.id });
    const payload = { _id: req.params.id };
    if (online[msg.senderId]) io.to(online[msg.senderId]).emit('message_deleted', payload);
    if (online[msg.receiverId]) io.to(online[msg.receiverId]).emit('message_deleted', payload);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/messages/:u1/:u2/me', async (req, res) => {
  try {
    const { u1, u2 } = req.params;
    await Message.updateMany(
      { $or: [{ senderId: u1, receiverId: u2 }, { senderId: u2, receiverId: u1 }] },
      { $addToSet: { deletedFor: u1 } }
    );
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/messages/:u1/:u2/all', async (req, res) => {
  try {
    const { u1, u2 } = req.params;
    await Message.deleteMany({ $or: [{ senderId: u1, receiverId: u2 }, { senderId: u2, receiverId: u1 }] });
    if (online[u1]) io.to(online[u1]).emit('chat_deleted', { withUser: u2 });
    if (online[u2]) io.to(online[u2]).emit('chat_deleted', { withUser: u1 });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// --- STATUS ---
app.post('/api/status', async (req, res) => {
  try {
    const { uniqueId, type, content } = req.body;
    const u = await User.findOne({ uniqueId });
    if (!u) return res.status(404).json({ error: 'Not found' });
    u.status = (u.status || []).filter(s => Date.now() - new Date(s.createdAt) < 86400000);
    u.status.push({ type, content });
    await u.save();
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/status', async (req, res) => {
  try {
    const cutoff = new Date(Date.now() - 86400000);
    const users = await User.find({ 'status.0': { $exists: true } });
    const statuses = users.map(u => ({
      uniqueId: u.uniqueId, username: u.username, profilePic: u.profilePic,
      items: (u.status || []).filter(s => new Date(s.createdAt) > cutoff)
    })).filter(s => s.items.length > 0);
    res.json(statuses);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/status/:uniqueId', async (req, res) => {
  try {
    await User.updateOne({ uniqueId: req.params.uniqueId }, { status: [] });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Health check
app.get('/', (req, res) => {
  const dbState = mongoose.connection.readyState;
  const states = { 0: 'disconnected', 1: 'connected', 2: 'connecting', 3: 'disconnecting' };
  res.json({
    status: dbState === 1 ? 'ok' : 'degraded',
    database: states[dbState] || 'unknown',
    service: 'whisper-backend',
    time: new Date().toISOString()
  });
});

// --- SOCKETS ---
io.on('connection', (socket) => {
  socket.on('register_user', async (uniqueId) => {
    online[uniqueId] = socket.id;
    try {
      await User.updateOne({ uniqueId }, { isOnline: true });
      io.emit('presence', { uniqueId, isOnline: true });
    } catch (e) { console.error('register_user error:', e.message); }
  });

  socket.on('typing', ({ targetUniqueId }) => {
    if (online[targetUniqueId]) io.to(online[targetUniqueId]).emit('user_typing');
  });
  socket.on('stop_typing', ({ targetUniqueId }) => {
    if (online[targetUniqueId]) io.to(online[targetUniqueId]).emit('user_stop_typing');
  });

  socket.on('send_message', async (data) => {
    const { senderId, targetUniqueId, senderUsername, message, messageType, replyTo } = data;
    try {
      const [sender, receiver] = await Promise.all([
        User.findOne({ uniqueId: senderId }),
        User.findOne({ uniqueId: targetUniqueId })
      ]);
      if (!sender || !receiver) return socket.emit('send_error', { error: 'User not found' });
      if ((receiver.blocked || []).includes(senderId))
        return socket.emit('send_error', { error: 'You are blocked by this user' });
      if ((sender.blocked || []).includes(targetUniqueId))
        return socket.emit('send_error', { error: 'You have blocked this user. Unblock to send.' });

      const m = new Message({
        senderId, receiverId: targetUniqueId, message,
        messageType: messageType || 'text',
        replyTo: replyTo || undefined,
        reactions: []
      });
      await m.save();
      const payload = {
        _id: m._id.toString(), senderId, senderUsername, message,
        messageType: m.messageType, timestamp: m.timestamp, edited: false, read: false,
        reactions: [], replyTo: m.replyTo
      };
      if (online[targetUniqueId]) io.to(online[targetUniqueId]).emit('receive_message', payload);
      socket.emit('receive_message', payload);
    } catch (e) { console.log('send_message error:', e.message); }
  });

  // WebRTC signaling
  socket.on('call_user', ({ to, from, fromName, fromPic, type, offer }) => {
    if (online[to]) io.to(online[to]).emit('incoming_call', { from, fromName, fromPic, type, offer });
    else socket.emit('call_unavailable', { to });
  });
  socket.on('call_response', ({ to, from, accepted, answer }) => {
    if (online[to]) io.to(online[to]).emit('call_response', { from, accepted, answer });
  });
  socket.on('webrtc_ice', ({ to, candidate }) => {
    if (online[to]) io.to(online[to]).emit('webrtc_ice', { candidate });
  });
  socket.on('call_end', ({ to }) => {
    if (online[to]) io.to(online[to]).emit('call_ended');
  });

  socket.on('disconnect', async () => {
    for (const uid in online) {
      if (online[uid] === socket.id) {
        delete online[uid];
        try {
          await User.updateOne({ uniqueId: uid }, { isOnline: false, lastSeen: new Date() });
          io.emit('presence', { uniqueId: uid, isOnline: false, lastSeen: new Date() });
        } catch (e) { console.error('disconnect error:', e.message); }
        break;
      }
    }
  });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));