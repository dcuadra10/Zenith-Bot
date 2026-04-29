const mongoose = require('mongoose');

const guildConfigSchema = new mongoose.Schema({
    guildId: { type: String, required: true, unique: true },
    spreadsheetId: { type: String, required: true },
    leadershipChannelId: { type: String, required: true }
});

module.exports = mongoose.model('GuildConfig', guildConfigSchema);
