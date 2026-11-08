const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
  uniqueId: { type: String, required: true, unique: true },
  username: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  profilePic: { type: String, default: '' },
  lastSeen: { type: Date, default: Date.now },
  isOnline: { type: Boolean, default: false },
  blocked: [{ type: String }], // uniqueIds this user has blocked
  status: [{
    type: { type: String, enum: ['text', 'image'], default: 'text' },
    content: { type: String, required: true },
    createdAt: { type: Date, default: Date.now }
  }]
});

module.exports = mongoose.model('User', UserSchema);