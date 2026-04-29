const mongoose = require('mongoose');

const ticketSchema = new mongoose.Schema({
  userId: { type: String, required: true },
  channelId: { type: String },
  status: { type: String, enum: ['open', 'closed'], default: 'open' },
  createdAt: { type: Date, default: Date.now },
  answers: { type: Array, default: [] }
});

module.exports = mongoose.model('Ticket', ticketSchema);
