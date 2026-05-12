/**
 * Branded Message Sender
 * Uses webhooks to send messages with per-guild custom bot name and avatar.
 */
const { getDb } = require('../config/database');
const axios = require('axios');

// In-memory cache: guildId+channelId -> webhook
const webhookCache = new Map();

/**
 * Get or create a webhook in the given channel for branded messages.
 * @param {TextChannel} channel - Discord channel
 * @returns {Promise<Webhook>}
 */
async function getOrCreateWebhook(channel) {
    const cacheKey = `${channel.guild.id}_${channel.id}`;
    if (webhookCache.has(cacheKey)) {
        return webhookCache.get(cacheKey);
    }

    try {
        const webhooks = await channel.fetchWebhooks();
        let webhook = webhooks.find(wh => wh.name === 'ZenithBranding' && wh.owner?.id === channel.client.user.id);

        if (!webhook) {
            webhook = await channel.createWebhook({
                name: 'ZenithBranding',
                reason: 'Per-server branding system'
            });
        }

        webhookCache.set(cacheKey, webhook);
        return webhook;
    } catch (e) {
        console.error('Failed to get/create branding webhook:', e.message);
        return null;
    }
}

/**
 * Get branding config for a guild.
 * @param {string} guildId
 * @returns {Promise<{brandingName: string|null, brandingAvatar: string|null}>}
 */
async function getBranding(guildId) {
    const db = await getDb();
    const config = await db.get(`SELECT brandingName, brandingAvatar FROM guild_configs WHERE guildId = ?`, [guildId]);
    return {
        brandingName: config?.brandingName || null,
        brandingAvatar: config?.brandingAvatar || null
    };
}

/**
 * Send a message with per-guild branding (custom name/avatar via webhook).
 * Falls back to normal channel.send() if no branding is configured or webhook fails.
 * 
 * @param {TextChannel} channel - Target channel
 * @param {Object} payload - Message payload (content, embeds, components, etc.)
 * @returns {Promise<Message>}
 */
async function sendBranded(channel, payload) {
    const branding = await getBranding(channel.guild.id);

    // If no branding is set, use normal send
    if (!branding.brandingName && !branding.brandingAvatar) {
        return channel.send(payload);
    }

    const webhook = await getOrCreateWebhook(channel);
    if (!webhook) {
        return channel.send(payload);
    }

    try {
        // Webhook messages don't support V2 Components flags, so strip if present
        const webhookPayload = { ...payload };
        if (branding.brandingName) webhookPayload.username = branding.brandingName;
        if (branding.brandingAvatar) webhookPayload.avatarURL = branding.brandingAvatar;
        
        // Remove flags that webhooks don't support
        delete webhookPayload.flags;

        return await webhook.send(webhookPayload);
    } catch (e) {
        console.error('Branded webhook send failed, falling back:', e.message);
        return channel.send(payload);
    }
}

/**
 * Clear cached webhook for a channel (e.g. when webhook is deleted).
 * @param {string} guildId
 * @param {string} channelId
 */
function clearWebhookCache(guildId, channelId) {
    webhookCache.delete(`${guildId}_${channelId}`);
}

/**
 * Update the bot's member profile in a guild (Nickname and Avatar).
 * @param {Guild} guild - Discord guild
 * @param {Object} branding - { brandingName, brandingAvatar }
 */
async function updateBotGuildIdentity(guild, branding) {
    if (!guild) return;
    try {
        const me = await guild.members.fetchMe();
        const { brandingName, brandingAvatar } = branding;

        const updateData = {};
        
        // Handle Nickname
        if (brandingName) {
            updateData.nick = brandingName;
        } else {
            updateData.nick = null; // Reset to default
        }

        // Handle Avatar
        if (brandingAvatar && brandingAvatar.startsWith('http')) {
            try {
                console.log(`[BRANDING] Fetching avatar from: ${brandingAvatar}`);
                const response = await axios.get(brandingAvatar, { responseType: 'arraybuffer' });
                updateData.avatar = Buffer.from(response.data);
                console.log(`[BRANDING] Avatar fetched successfully (${updateData.avatar.length} bytes)`);
            } catch (e) {
                console.error(`[BRANDING ERROR] Failed to fetch branding avatar for guild ${guild.id}:`, e.message);
            }
        } else {
            updateData.avatar = null; // Reset to default
        }

        if (Object.keys(updateData).length > 0) {
            console.log(`[BRANDING] Applying identity update to ${guild.name}:`, JSON.stringify({ nick: updateData.nick, hasAvatar: !!updateData.avatar }));
            await me.edit(updateData);
            console.log(`[BRANDING] Successfully updated bot identity in guild ${guild.name} (${guild.id})`);
        } else {
            console.log(`[BRANDING] No changes to apply for guild ${guild.name}`);
        }
    } catch (e) {
        console.error(`[BRANDING ERROR] Failed to update bot identity in guild ${guild.id}:`, e.message);
    }
}

module.exports = { sendBranded, getBranding, getOrCreateWebhook, clearWebhookCache, updateBotGuildIdentity };
