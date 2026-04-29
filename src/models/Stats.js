const mongoose = require('mongoose');

const statsSchema = new mongoose.Schema({
  statName: { type: String, required: true, unique: true },
  value: { type: Number, default: 0 }
});

module.exports = mongoose.model('Stats', statsSchema);
