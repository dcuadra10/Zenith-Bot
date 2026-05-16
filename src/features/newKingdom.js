const { EmbedBuilder } = require('discord.js');
const { getDb } = require('../config/database');
const ms = require('ms');

async function handleNewKingdom(message, conf) {
    console.log(`[New Kingdom Debug] Checking message in ${message.channel.id}. Enabled: ${conf.newkingdomenabled}, Source: ${conf.newkingdomsourcechannel}, Target: ${conf.newkingdomtargetchannel}`);
    
    if (!conf.newkingdomenabled || !conf.newkingdomsourcechannel || !conf.newkingdomtargetchannel) {
        console.log('[New Kingdom Debug] Missing configuration. Returning.');
        return;
    }
    
    if (message.channel.id !== conf.newkingdomsourcechannel) {
        console.log(`[New Kingdom Debug] Channel ID mismatch: ${message.channel.id} !== ${conf.newkingdomsourcechannel}`);
        return;
    }

    console.log('[New Kingdom Debug] Pattern matched! Processing...');

    const db = await getDb();
    const guildId = message.guild.id;

    // 1. Log the new kingdom event
    await db.run(`INSERT INTO new_kingdom_logs (guildId, timestamp) VALUES (?, CURRENT_TIMESTAMP)`, [guildId]);

    // 2. Fetch history for stats
    const logs = await db.all(`SELECT timestamp FROM new_kingdom_logs WHERE guildId = ? ORDER BY timestamp DESC LIMIT 11`, [guildId]);
    
    let statsText = '';
    if (logs.length >= 2) {
        const last = new Date(logs[0].timestamp);
        const prev = new Date(logs[1].timestamp);
        const diffLast = last - prev;
        
        statsText += `⏱️ **Time since previous:** ${formatDuration(diffLast)}\n`;

        // Calculate average of all available intervals
        let totalDiff = 0;
        const intervals = logs.length - 1;
        for (let i = 0; i < intervals; i++) {
            totalDiff += (new Date(logs[i].timestamp) - new Date(logs[i+1].timestamp));
        }
        const avgDiff = totalDiff / intervals;
        
        if (intervals > 1) {
            statsText += `📊 **Average time (last ${intervals} reinos):** ${formatDuration(avgDiff)}\n`;
        }

        // 3. Prediction
        const nextTime = new Date(last.getTime() + avgDiff);
        const unixTime = Math.floor(nextTime.getTime() / 1000);
        statsText += `🔮 **Predicted next reino:** <t:${unixTime}:R> (<t:${unixTime}:t>)`;
    } else {
        statsText = '📊 *First recorded reino. Statistics and predictions will appear after the next one.*';
    }

    // 4. Send the update
    const targetChannel = message.guild.channels.cache.get(conf.newkingdomtargetchannel);
    if (targetChannel) {
        // Clean @New Kingdom Alert from content
        const cleanContent = message.content.replace(/@New Kingdom Alert/g, '').trim();
        
        const sirenEmoji = '<:reino:1505012438700003419>';
        const pingStr = conf.newkingdompingrole ? `${sirenEmoji} <@&${conf.newkingdompingrole}>` : sirenEmoji;

        const embed = new EmbedBuilder()
            .setTitle('🌍 New Kingdom Detected!')
            .setDescription(cleanContent || '*No text content*')
            .setColor('#10b981')
            .setTimestamp();

        // Update the stats text
        const updatedStatsText = statsText.replace(/⏱️/g, sirenEmoji);
        embed.setFields({ name: 'Statistics & Prediction', value: updatedStatsText });

        await targetChannel.send({ content: pingStr, embeds: [embed] });
    }
}

function formatDuration(ms) {
    const hours = Math.floor(ms / (1000 * 60 * 60));
    const minutes = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((ms % (1000 * 60)) / 1000);
    
    const parts = [];
    if (hours > 0) parts.push(`${hours}h`);
    if (minutes > 0) parts.push(`${minutes}m`);
    if (seconds > 0 || parts.length === 0) parts.push(`${seconds}s`);
    
    return parts.join(' ');
}

module.exports = { handleNewKingdom };
