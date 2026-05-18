const { EmbedBuilder } = require('discord.js');
const { getDb } = require('../config/database');
const ms = require('ms');

async function handleNewKingdom(message, conf) {
    console.log(`[New Kingdom Debug] Checking message in ${message.channel.id} for guild ${conf.guildid}. Enabled: ${conf.newkingdomenabled}, Target: ${conf.newkingdomtargetchannel}`);

    if (!conf.newkingdomenabled || !conf.newkingdomtargetchannel) {
        console.log('[New Kingdom Debug] Missing configuration. Returning.');
        return;
    }

    if (message.channel.id !== '1505011607636414545') {
        console.log(`[New Kingdom Debug] Channel ID mismatch: ${message.channel.id} !== 1505011607636414545`);
        return;
    }

    // Verify it is a valid New Kingdom alert message
    let fullText = message.content || "";
    if (message.embeds && message.embeds.length > 0) {
        const embed = message.embeds[0];
        fullText += " " + (embed.description || embed.title || "");
    }

    const lowerText = fullText.toLowerCase();
    const isAlert = lowerText.includes("is now open!") || lowerText.includes("new kingdom alerts") || (lowerText.includes("kingdom") && lowerText.includes("open"));
    if (!isAlert) {
        console.log(`[New Kingdom Debug] Message does not match alert patterns: "${fullText}"`);
        return;
    }

    console.log('[New Kingdom Debug] Pattern matched! Processing...');


    const db = await getDb();
    const guildId = conf.guildid;

    // 1. Log the new kingdom event
    await db.run(`INSERT INTO new_kingdom_logs (guildId, timestamp) VALUES (?, CURRENT_TIMESTAMP)`, [guildId]);

    // 2. Fetch history for stats
    const logs = await db.all(`SELECT timestamp FROM new_kingdom_logs WHERE guildId = ? ORDER BY timestamp DESC LIMIT 11`, [guildId]);

    let statsText = '';
    const sirenEmoji = '<a:Amber_Siren:1505647294949883907>';
    const prevEmoji = '<:previous:1505649387869835264>';
    const avgEmoji = '<:avrg:1505649332823654420>';
    const predEmoji = '<:days:1505647444615233607>';
    const kingdomEmoji = '<:kingdom:1505649432706940928>';



    if (logs.length >= 2) {
        const last = new Date(logs[0].timestamp);
        const prev = new Date(logs[1].timestamp);
        const diffLast = last - prev;

        const prevUnixTime = Math.floor(prev.getTime() / 1000);
        statsText += `${prevEmoji} **Previous Kingdom:** <t:${prevUnixTime}:R> (<t:${prevUnixTime}:t>)\n`;


        // Calculate average of all available intervals
        let totalDiff = 0;
        const intervals = logs.length - 1;
        for (let i = 0; i < intervals; i++) {
            totalDiff += (new Date(logs[i].timestamp) - new Date(logs[i + 1].timestamp));
        }
        const avgDiff = totalDiff / intervals;

        if (intervals > 1) {
            statsText += `${avgEmoji} **Average time (last ${intervals} kingdoms):** ${formatDuration(avgDiff)}\n`;
        }

        // 3. Prediction
        const nextTime = new Date(last.getTime() + avgDiff);
        const unixTime = Math.floor(nextTime.getTime() / 1000);
        statsText += `${predEmoji} **Predicted next Kingdom:** <t:${unixTime}:R> (<t:${unixTime}:t>)`;
    } else {
        statsText = `${sirenEmoji} *First recorded Kingdom. Statistics and predictions will appear after the next one.*`;
    }


    // 4. Send the update
    const targetGuild = message.client.guilds.cache.get(conf.guildid);
    if (!targetGuild) {
        console.error(`[New Kingdom Debug] Target guild ${conf.guildid} not found in client cache.`);
        return;
    }
    let targetChannel = targetGuild.channels.cache.get(conf.newkingdomtargetchannel);
    if (!targetChannel) {
        try {
            targetChannel = await targetGuild.channels.fetch(conf.newkingdomtargetchannel);
        } catch (e) {
            console.error(`[New Kingdom Debug] Failed to fetch target channel ${conf.newkingdomtargetchannel} in guild ${conf.guildid}:`, e);
        }
    }

    if (targetChannel) {
        // Extract raw content
        let rawContent = message.content || "";
        if (!rawContent && message.embeds && message.embeds.length > 0) {
            const firstEmbed = message.embeds[0];
            rawContent = firstEmbed.description || firstEmbed.title || "";
        }

        // Clean alarm emojis, mentions, duplicate Powered by Hero Scrolls text and double slashes
        let cleanContent = rawContent
            .replace(/<a?:alarm:\d+>/gi, '') // Strip specific alarm custom emoji
            .replace(/@New Kingdom Alerts/gi, '')
            .replace(/@New Kingdom Alert/gi, '')
            .replace(/\/\//g, '')
            .replace(/<:heroscrolls:\d+>/gi, '') // Strip old/new heroscrolls emoji
            .replace(/\*Powered by Hero Scrolls\*/gi, '') // Strip text with asterisks
            .replace(/Powered by Hero Scrolls/gi, '') // Strip plain text
            .replace(/\n\s*\n+/g, '\n') // Collapse blank lines
            .trim();

        // Fallback if fully cleaned
        if (!cleanContent) cleanContent = rawContent || '*No text content*';

        const pingStr = conf.newkingdompingrole ? `${sirenEmoji} <@&${conf.newkingdompingrole}>` : sirenEmoji;

        const embed = new EmbedBuilder()
            .setTitle(`${kingdomEmoji} New Kingdom Detected!`)

            .setDescription(cleanContent)
            .setColor('#10b981')
            .addFields({ name: 'Statistics & Prediction:', value: statsText })
            .setFooter({
                text: 'Powered by Hero Scrolls',
                iconURL: 'https://cdn.discordapp.com/emojis/1505646196373585980.gif'
            })

            .setTimestamp();

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
