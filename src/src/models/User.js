const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  userId: { type: String, required: true, unique: true },
  xp: { type: Number, default: 0 },
  level: { type: Number, default: 1 },
  invites: { type: Number, default: 0 }
});

module.exports = mongoose.model('User', userSchema);
