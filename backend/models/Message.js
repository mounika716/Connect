const mongoose = require('mongoose');

const MessageSchema = new mongoose.Schema({
  senderId: { type: String, required: true },
  receiverId: { type: String, required: true },
  message: { type: String, default: '' },
  messageType: { type: String, enum: ['text', 'image', 'audio'], default: 'text' },
  deletedFor: [{ type: String }],
  edited: { type: Boolean, default: false },
  read: { type: Boolean, default: false },
  reactions: [{
    emoji: String,
    userId: String,
  }],
  replyTo: {
    _id: String,
    message: String,
    messageType: String,
    senderId: String,
  },
  timestamp: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Message', MessageSchema);