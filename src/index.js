const { Client, GatewayIntentBits, Partials, Collection } = require('discord.js');
require('dotenv').config();
const { validateEnv } = require('./config/env');
const express = require('express');
const cors = require('cors');
const path = require('path');
const axios = require('axios');
const cookieParser = require('cookie-parser');
const { getDb } = require('./config/database');

const app = express();
app.use(cors());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, '../dashboard')));

// Middleware to verify Discord Token
async function authenticateToken(req, res, next) {
    const token = req.cookies.discord_token;
    if (!token) return res.status(401).json({ error: 'No autorizado' });

    try {
        const userRes = await axios.get('https://discord.com/api/users/@me', {
            headers: { Authorization: `Bearer ${token}` }
        });
        req.user = userRes.data;
        next();
    } catch (e) {
        res.status(401).json({ error: 'Sesión expirada' });
    }
}

// Helper to check if user has admin permissions in a guild
async function checkAdmin(userId, guildId) {
    const guild = client.guilds.cache.get(guildId);
    if (!guild) return false;
    const member = await guild.members.fetch(userId).catch(() => null);
    if (!member) return false;
    return member.permissions.has('Administrator');
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.GuildPresences,
    GatewayIntentBits.GuildMessageReactions
  ],
  partials: [Partials.Channel, Partials.Message, Partials.Reaction]
});
client.commands = new Collection();
client.activeApplications = new Collection();

// Endpoints de API Local
app.use(express.json()); // Necesario para parsear el req.body del POST config

// Health Check endpoint for UptimeRobot / healthchecks.io
app.get('/health', (req, res) => {
    res.status(200).json({
        status: 'ok',
        uptime: process.uptime(),
        timestamp: Date.now(),
        bot: client.isReady() ? 'connected' : 'disconnected'
    });
});

// Ping healthchecks.io on interval (if configured)
if (process.env.HEALTHCHECKS_URL) {
    setInterval(async () => {
        try {
            const axios = require('axios');
            await axios.get(process.env.HEALTHCHECKS_URL);
        } catch (e) { /* silent */ }
    }, 5 * 60 * 1000); // Every 5 minutes
}

app.get('/api/stats', async (req, res) => {
    try {
        const db = await getDb();
        const adStat = await db.get(`SELECT value FROM global_stats WHERE statName = 'total_ads_globales'`);
        const userCount = await db.get(`SELECT COUNT(*) as count FROM users`);
        
        res.json({
            totalAds: adStat ? adStat.value : 0,
            totalUsers: userCount ? userCount.count : 0
        });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Error fetching stats' });
    }
});

// OAuth2 Auth Flow
app.get('/api/auth/discord', (req, res) => {
    const clientId = process.env.CLIENT_ID;
    const protocol = req.headers['x-forwarded-proto'] || req.protocol;
    const host = req.get('host');
    const baseUrl = process.env.DASHBOARD_URL || `${protocol}://${host}`;
    const redirectUri = encodeURIComponent(`${baseUrl}/api/auth/callback`);
    res.redirect(`https://discord.com/api/oauth2/authorize?client_id=${clientId}&redirect_uri=${redirectUri}&response_type=code&scope=identify%20guilds`);
});

app.get('/api/auth/callback', async (req, res) => {
    const code = req.query.code;
    if (!code) return res.send('No code provided');
    try {
        const protocol = req.headers['x-forwarded-proto'] || req.protocol;
        const host = req.get('host');
        const baseUrl = process.env.DASHBOARD_URL || `${protocol}://${host}`;
        
        const params = new URLSearchParams({
            client_id: process.env.CLIENT_ID,
            client_secret: process.env.DISCORD_CLIENT_SECRET,
            grant_type: 'authorization_code',
            code,
            redirect_uri: `${baseUrl}/api/auth/callback`
        });
        
        const tokenRes = await axios.post('https://discord.com/api/oauth2/token', params.toString(), {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        });
        const accessToken = tokenRes.data.access_token;
        
        // Guardar token en cookie segura y regresar al dashboard
        res.cookie('discord_token', accessToken, { httpOnly: false }); // false para poder validarlo desde JS front, o preferiblemente validado en backend
        res.redirect('/?token=success');
    } catch (error) {
        console.error('Error en callback Oauth2:', error.response?.data || error.message);
        res.status(500).send('Error durante OAuth2');
    }
});

app.get('/api/guilds', authenticateToken, async (req, res) => {
    try {
        const token = req.cookies.discord_token;
        const userGuildsRes = await axios.get('https://discord.com/api/users/@me/guilds', {
            headers: { Authorization: `Bearer ${token}` }
        });
        const userGuilds = userGuildsRes.data;

        const adminGuilds = userGuilds.filter(g => (g.permissions & 0x8) === 0x8);
        const botGuildIds = client.guilds.cache.map(g => g.id);
        const validGuilds = adminGuilds.filter(g => botGuildIds.includes(g.id));

        res.json(validGuilds);
    } catch (error) {
        console.error('Error fetching guilds', error.response?.data || error);
        res.status(500).json({ error: 'Error procesando servidores' });
    }
});

// GET Settings for a specific Guild
app.get('/api/config/:guildId', authenticateToken, async (req, res) => {
    try {
        const hasAdmin = await checkAdmin(req.user.id, req.params.guildId);
        if (!hasAdmin) return res.status(403).json({ error: 'Forbidden' });

        const db = await getDb();
        const config = await db.get(`SELECT * FROM guild_configs WHERE guildId = ?`, [req.params.guildId]);
        res.json(config || { spreadsheetId: '', leadershipChannelId: '' });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Error reading config' });
    }
});

// POST Settings for a specific Guild
app.post('/api/config/:guildId', authenticateToken, async (req, res) => {
    try {
        const hasAdmin = await checkAdmin(req.user.id, req.params.guildId);
        if (!hasAdmin) return res.status(403).json({ error: 'Forbidden' });

        const { spreadsheetId, leadershipChannelId, welcomeChannelId, logChannelId, ticketCategoryId, brandingName, brandingAvatar } = req.body;
        const db = await getDb();
        await db.run(
            `INSERT INTO guild_configs (guildId, spreadsheetId, leadershipChannelId, welcomeChannelId, logChannelId, ticketCategoryId, brandingName, brandingAvatar) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?) 
             ON CONFLICT(guildId) DO UPDATE SET 
             spreadsheetId=excluded.spreadsheetId, 
             leadershipChannelId=excluded.leadershipChannelId,
             welcomeChannelId=excluded.welcomeChannelId,
             logChannelId=excluded.logChannelId,
             ticketCategoryId=excluded.ticketCategoryId,
             brandingName=excluded.brandingName,
             brandingAvatar=excluded.brandingAvatar`,
             [req.params.guildId, spreadsheetId, leadershipChannelId, welcomeChannelId, logChannelId, ticketCategoryId, brandingName || null, brandingAvatar || null]
        );
        const config = await db.get(`SELECT * FROM guild_configs WHERE guildId = ?`, [req.params.guildId]);
        res.json({ success: true, config });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Error saving config' });
    }
});

// ============================================
// MARKET+ ROUTES (DEFINED BELOW)
// ============================================

// GET Branding for a specific Guild (includes bot defaults for preview)
app.get('/api/branding/:guildId', async (req, res) => {
    const token = req.cookies.discord_token;
    if (!token) return res.status(401).json({ error: 'No autorizado' });

    try {
        const db = await getDb();
        const config = await db.get(`SELECT brandingName, brandingAvatar FROM guild_configs WHERE guildId = ?`, [req.params.guildId]);
        res.json({
            brandingName: config?.brandingName || '',
            brandingAvatar: config?.brandingAvatar || '',
            defaultName: client.user.username,
            defaultAvatar: client.user.displayAvatarURL({ size: 128 })
        });
    } catch (e) {
        res.status(500).json({ error: 'Error fetching branding' });
    }
});

// POST Save Branding for a specific Guild
app.post('/api/branding/:guildId', async (req, res) => {
    const token = req.cookies.discord_token;
    if (!token) return res.status(401).json({ error: 'No autorizado' });

    const { brandingName, brandingAvatar } = req.body;
    console.log(`[API] Saving branding for ${req.params.guildId}: Name=${brandingName}, Avatar=${brandingAvatar}`);
    try {
        const db = await getDb();
        // Ensure the guild_configs row exists
        await db.run(
            `INSERT INTO guild_configs (guildId, brandingName, brandingAvatar) 
             VALUES (?, ?, ?) 
             ON CONFLICT(guildId) DO UPDATE SET 
             brandingName=excluded.brandingName,
             brandingAvatar=excluded.brandingAvatar`,
             [req.params.guildId, brandingName || null, brandingAvatar || null]
        );

        // Update Bot Profile in the guild
        const { updateBotGuildIdentity } = require('./utils/brandedSender');
        const guild = client.guilds.cache.get(req.params.guildId);
        if (guild) {
            await updateBotGuildIdentity(guild, { brandingName, brandingAvatar });
        }

        res.json({ success: true });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Error saving branding' });
    }
});

// GET Custom Bot Info
app.get('/api/custom-bot/:guildId', async (req, res) => {
    const token = req.cookies.discord_token;
    if (!token) return res.status(401).json({ error: 'No autorizado' });

    try {
        const db = await getDb();
        const bot = await db.get(`SELECT botToken, clientId, status, errorMessage FROM custom_bots WHERE guildId = ?`, [req.params.guildId]);
        if (bot) {
            // Mask the token partially for safety
            bot.botToken = bot.botToken ? bot.botToken.substring(0, 15) + '...' : null;
        }
        res.json(bot || { status: 'none' });
    } catch (e) {
        console.error('Error fetching custom bot:', e);
        res.status(500).json({ error: 'Error fetching custom bot' });
    }
});

// POST Custom Bot Connect
app.post('/api/custom-bot/:guildId', async (req, res) => {
    const tokenCookie = req.cookies.discord_token;
    if (!tokenCookie) return res.status(401).json({ error: 'No autorizado' });

    const { botToken } = req.body;
    if (!botToken) return res.status(400).json({ error: 'Falta el Token del Bot' });

    try {
        const db = await getDb();
        await db.run(
            `INSERT INTO custom_bots (guildId, botToken, status) VALUES (?, ?, 'starting') 
             ON CONFLICT(guildId) DO UPDATE SET botToken=excluded.botToken, status='starting'`,
            [req.params.guildId, botToken]
        );

        const customBotManager = require('./managers/CustomBotManager');
        const result = await customBotManager.startBot(req.params.guildId, botToken);

        if (result.success) {
            res.json({ success: true, clientId: result.client.user.id });
        } else {
            res.status(400).json({ error: result.error });
        }
    } catch (e) {
        console.error('Error connecting custom bot:', e);
        res.status(500).json({ error: 'Error al conectar el bot personalizado' });
    }
});

// DELETE Custom Bot Disconnect
app.delete('/api/custom-bot/:guildId', async (req, res) => {
    const token = req.cookies.discord_token;
    if (!token) return res.status(401).json({ error: 'No autorizado' });

    try {
        const customBotManager = require('./managers/CustomBotManager');
        await customBotManager.stopBot(req.params.guildId);
        
        const db = await getDb();
        await db.run(`DELETE FROM custom_bots WHERE guildId = ?`, [req.params.guildId]);
        
        res.json({ success: true });
    } catch (e) {
        console.error('Error disconnecting custom bot:', e);
        res.status(500).json({ error: 'Error al desconectar el bot personalizado' });
    }
});

// POST Test Branding (send a test message)
app.post('/api/branding/:guildId/test', async (req, res) => {
    const token = req.cookies.discord_token;
    if (!token) return res.status(401).json({ error: 'No autorizado' });

    const { channelId, brandingName, brandingAvatar } = req.body;
    try {
        const guild = client.guilds.cache.get(req.params.guildId);
        if (!guild) return res.status(400).json({ error: 'Bot is not in this guild' });
        
        const channel = guild.channels.cache.get(channelId);
        if (!channel) return res.status(400).json({ error: 'Channel not found' });

        const { getOrCreateWebhook, updateBotGuildIdentity } = require('./utils/brandedSender');
        
        // Update profile too so they see the change on the bot user
        await updateBotGuildIdentity(guild, { brandingName, brandingAvatar });

        const webhook = await getOrCreateWebhook(channel);
        
        if (!webhook) {
            return res.status(500).json({ error: 'Could not create webhook. Check bot permissions.' });
        }

        const { EmbedBuilder } = require('discord.js');
        const embed = new EmbedBuilder()
            .setTitle('🎨 Branding Test')
            .setDescription('This is a preview of how I will appear in this server with the configured branding.')
            .setColor(brandingName || brandingAvatar ? '#10b981' : '#a855f7')
            .setFooter({ text: 'Zenith Branding System' })
            .setTimestamp();

        await webhook.send({
            username: brandingName || client.user.username,
            avatarURL: brandingAvatar || client.user.displayAvatarURL(),
            embeds: [embed]
        });

        res.json({ success: true });
    } catch (e) {
        console.error('Branding test error:', e);
        res.status(500).json({ error: 'Error sending test message' });
    }
});

// GET Panels for a specific Guild
app.get('/api/panels/:guildId', async (req, res) => {
    const token = req.cookies.discord_token;
    if (!token) return res.status(401).json({ error: 'No autorizado' });
    try {
        const db = await getDb();
        const panels = await db.all(`SELECT * FROM ticket_panels WHERE guildId = ?`, [req.params.guildId]);
        res.json(panels);
    } catch (e) {
        res.status(500).json({ error: 'Error fetching panels' });
    }
});

// POST Create or Update Panel
app.post('/api/panels/:guildId', async (req, res) => {
    const token = req.cookies.discord_token;
    if (!token) return res.status(401).json({ error: 'No autorizado' });
    
    const { id, channelId, messageId, panelData } = req.body;
    const guildId = req.params.guildId;
    const panelId = id || Math.random().toString(36).substring(2, 10);
    
    try {
        const guild = client.guilds.cache.get(guildId);
        if (!guild) return res.status(400).json({ error: 'Bot is not in this guild' });
        
        const channel = guild.channels.cache.get(channelId);
        if (!channel) return res.status(400).json({ error: 'Channel not found' });

        const { EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
        const { buildMessage } = require('./utils/messageBuilder');

        const rows = [];
        panelData.dropdowns.forEach((dd, i) => {
            if (!dd.options || dd.options.length === 0) return;
            const selectOptions = dd.options.map((opt, optIdx) => {
                return {
                    label: opt.label,
                    description: opt.description || 'Select this option',
                    emoji: opt.emoji || '🎫',
                    value: `ticket_opt_${panelId}_${i}_${optIdx}`
                };
            });
            const menu = new StringSelectMenuBuilder()
                .setCustomId(`ticket_panel_${panelId}_${i}`)
                .setPlaceholder(dd.placeholder || 'Select an option...')
                .addOptions(selectOptions.slice(0, 25)); // Discord max 25
            rows.push(new ActionRowBuilder().addComponents(menu));
        });

        
        if (panelData.buttonRows) {
            panelData.buttonRows.forEach((br, i) => {
                if (!br.options || br.options.length === 0) return;
                const row = new ActionRowBuilder();
                br.options.forEach((opt, optIdx) => {
                    let style = ButtonStyle.Primary;
                    if (opt.buttonStyle === 'Secondary') style = ButtonStyle.Secondary;
                    if (opt.buttonStyle === 'Success') style = ButtonStyle.Success;
                    if (opt.buttonStyle === 'Danger') style = ButtonStyle.Danger;
                    
                    const btn = new ButtonBuilder()
                        .setCustomId(`ticket_panel_${panelId}_btn_${i}_${optIdx}`)
                        .setLabel(opt.label || 'Ticket')
                        .setStyle(style);
                    if (opt.emoji) btn.setEmoji(opt.emoji);
                    row.addComponents(btn);
                });
                rows.push(row);
            });
        }

        const useEmbed = panelData.useEmbed === undefined || panelData.useEmbed === null ? true : !!panelData.useEmbed;
        const panelTitle = (panelData.emoji ? panelData.emoji + ' ' : '') + (panelData.title || 'Support');
        const panelDesc = (panelData.descEmoji ? panelData.descEmoji + ' ' : '') + (panelData.description || 'Select an option to open a ticket.');

        const payload = buildMessage(useEmbed, {
            title: panelTitle,
            description: panelDesc,
            color: panelData.color || '#a855f7',
            imageUrl: panelData.imageUrl || null,
            actionRows: rows
        });

        let postedMsg;
        if (messageId) {
            try {
                postedMsg = await channel.messages.fetch(messageId);
                await postedMsg.edit(payload);
            } catch(e) {
                postedMsg = await channel.send(payload);
            }
        } else {
            postedMsg = await channel.send(payload);
        }

        const db = await getDb();
        await db.run(
            `INSERT INTO ticket_panels (id, guildId, channelId, messageId, panelData) 
             VALUES (?, ?, ?, ?, ?)
             ON CONFLICT(id) DO UPDATE SET 
             channelId=excluded.channelId,
             messageId=excluded.messageId,
             panelData=excluded.panelData`,
             [panelId, guildId, channelId, postedMsg.id, JSON.stringify(panelData)]
        );
        res.json({ success: true, panelId });
    } catch(e) {
        console.error(e);
        res.status(500).json({ error: 'Error saving panel to discord' });
    }
});

// DELETE Panel
app.delete('/api/panels/:id', async (req, res) => {
    const token = req.cookies.discord_token;
    if (!token) return res.status(401).json({ error: 'No autorizado' });
    try {
        const db = await getDb();
        await db.run(`DELETE FROM ticket_panels WHERE id = ?`, [req.params.id]);
        res.json({ success: true });
    } catch(e) {
        res.status(500).json({ error: 'Error deleting panel' });
    }
});

// Update Panel (EDIT)
app.put('/api/panels/:id', async (req, res) => {
    const token = req.cookies.discord_token;
    if (!token) return res.status(401).json({ error: 'No autorizado' });
    
    const { panelData } = req.body;
    try {
        const db = await getDb();
        await db.run(
            `UPDATE ticket_panels SET panelData = ? WHERE id = ?`,
            [JSON.stringify(panelData), req.params.id]
        );
        res.json({ success: true });
    } catch(e) {
        console.error('Error updating panel:', e);
        res.status(500).json({ error: 'Error updating panel' });
    }
});

// GET Giveaways
app.get('/api/giveaways/:guildId', async (req, res) => {
    const token = req.cookies.discord_token;
    if (!token) return res.status(401).json({ error: 'No autorizado' });
    try {
        const db = await getDb();
        const giveaways = await db.all(`SELECT * FROM giveaways WHERE guildId = ? ORDER BY endTime DESC`, [req.params.guildId]);
        res.json(giveaways || []);
    } catch (e) {
        res.status(500).json({ error: 'Error fetching giveaways' });
    }
});

// POST Giveaways
app.post('/api/giveaways/:guildId', async (req, res) => {
    const token = req.cookies.discord_token;
    if (!token) return res.status(401).json({ error: 'No autorizado' });
    
    const { channelId, prize, winnersCount, durationMs, color, requiredRole, pingRole } = req.body;
    const guildId = req.params.guildId;
    
    try {
        const guild = client.guilds.cache.get(guildId);
        if (!guild) return res.status(400).json({ error: 'Bot is not in this guild' });
        
        const channel = guild.channels.cache.get(channelId);
        if (!channel) return res.status(400).json({ error: 'Channel not found' });
        
        // Fetch user from token to set hostedBy (we can use client.users but we need the admin's ID)
        let userId = 'Unknown';
        try {
            const userRes = await axios.get('https://discord.com/api/users/@me', { headers: { Authorization: `Bearer ${token}` } });
            userId = userRes.data.id;
        } catch(e) {}
        
        const endTime = Date.now() + durationMs;
        const endUnix = Math.floor(endTime / 1000); // Unix for Discord <t:...>
        
        let desc = `React with 🎉 to enter!\n\n**Winners:** ${winnersCount}\n**Ends:** <t:${endUnix}:R> (<t:${endUnix}:f>)\n**Hosted By:** <@${userId}>`;
        if (requiredRole) {
            desc += `\n**Required Role:** <@&${requiredRole}>`;
        }

        const { EmbedBuilder } = require('discord.js');
        const embed = new EmbedBuilder()
            .setTitle(`🎉 Giveaway: ${prize}`)
            .setDescription(desc)
            .setColor(color || '#a855f7')
            .setTimestamp(new Date(endTime));
            
        const msgContent = pingRole ? `<@&${pingRole}>` : undefined;
        const message = await channel.send({ content: msgContent, embeds: [embed] });
        await message.react('🎉');
        
        const db = await getDb();
        await db.run(
            `INSERT INTO giveaways (id, guildId, channelId, prize, winnersCount, endTime, hostedBy, requiredRole, pingRole, status) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')`,
            [message.id, guildId, channelId, prize, winnersCount, endTime, userId, requiredRole || null, pingRole || null]
        );
        res.json({ success: true, messageId: message.id });
    } catch(e) {
        console.error(e);
        res.status(500).json({ error: 'Error processing giveaway' });
    }
});

// ============================================
// MARKET+ ROUTES
// ============================================
app.get('/api/market-config/:guildId', authenticateToken, async (req, res) => {
    try {
        const hasAdmin = await checkAdmin(req.user.id, req.params.guildId);
        if (!hasAdmin) return res.status(403).json({ error: 'Forbidden' });

        const db = await getDb();
        const config = await db.get(`SELECT * FROM market_configs WHERE guildId = ?`, [req.params.guildId]);
        res.json(config || {});
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Server error' });
    }
});

app.post('/api/market-config/:guildId', authenticateToken, async (req, res) => {
    try {
        const hasAdmin = await checkAdmin(req.user.id, req.params.guildId);
        if (!hasAdmin) return res.status(403).json({ error: 'Forbidden' });

        const db = await getDb();
        const { marketEnabled, forumChannelId, approvalChannelId, ownerChannelId, paymentMethods, middlemanRole, feePercentage, marketQuestions } = req.body;
        
        await db.run(
            `INSERT INTO market_configs (guildId, marketEnabled, forumChannelId, approvalChannelId, ownerChannelId, paymentMethods, middlemanRole, feePercentage, marketQuestions)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(guildId) DO UPDATE SET 
             marketEnabled = excluded.marketEnabled,
             forumChannelId = excluded.forumChannelId,
             approvalChannelId = excluded.approvalChannelId,
             ownerChannelId = excluded.ownerChannelId,
             paymentMethods = excluded.paymentMethods,
             middlemanRole = excluded.middlemanRole,
             feePercentage = excluded.feePercentage,
             marketQuestions = excluded.marketQuestions`,
            [req.params.guildId, marketEnabled ? 1 : 0, forumChannelId, approvalChannelId, ownerChannelId, paymentMethods, middlemanRole, feePercentage || 5, marketQuestions ? JSON.stringify(marketQuestions) : null]
        );
        res.json({ success: true });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Server error' });
    }
});


// GET Transcripts
app.get('/api/transcripts/:guildId', async (req, res) => {
    const token = req.cookies.discord_token;
    if (!token) return res.status(401).json({ error: 'No autorizado' });
    try {
        const db = await getDb();
        const transcripts = await db.all(`SELECT ticketId, userId, closedAt, logContent FROM ticket_transcripts WHERE guildId = ? ORDER BY closedAt DESC LIMIT 50`, [req.params.guildId]);
        res.json(transcripts);
    } catch (e) {
        res.status(500).json({ error: 'Error fetching transcripts' });
    }
});

// GET Module Configs
app.get('/api/modules/:guildId', async (req, res) => {
    const token = req.cookies.discord_token;
    if (!token) return res.status(401).json({ error: 'No autorizado' });
    try {
        const db = await getDb();
        const config = await db.get(`SELECT * FROM module_configs WHERE guildId = ?`, [req.params.guildId]);
        res.json(config || {});
    } catch (e) {
        res.status(500).json({ error: 'Error fetching module configs' });
    }
});

// POST Module Configs
app.post('/api/modules/:guildId', async (req, res) => {
    const token = req.cookies.discord_token;
    if (!token) return res.status(401).json({ error: 'No autorizado' });
    
    const b = req.body;
    const guildId = req.params.guildId;
    
    try {
        const db = await getDb();
        
        // Build dynamic upsert
        const fields = [
            'welcomeEnabled', 'welcomeChannel', 'welcomeEmbedTitle', 'welcomeEmbedDesc', 'welcomeColor', 'welcomeImage', 'welcomeUseEmbed',
            'levelingEnabled', 'xpMin', 'xpMax', 'xpCooldown', 'levelUpChannel', 'roleRewards',
            'ticketsEnabled', 'ticketsMaxActive', 'ticketsTranscriptChannel', 'ticketCategoryId', 'ticketsApprovalChannel',
            'automodEnabled', 'automodSpam', 'automodLinks', 'automodMentions', 'automodCaps', 'automodWords',
            'automodWordList', 'automodMaxMentions', 'automodLogChannel',
            'loggingEnabled', 'loggingChannel', 'logEdits', 'logDeletes', 'logMembers', 'logRoles', 'logChannels', 'logBans',
            'autoroleEnabled', 'autoroleIds',
            'countingEnabled', 'countingChannel', 'countingCurrent', 'countingSameUser', 'countingReset', 'countingMath',
            'serverStatsEnabled', 'statsTotalMembers', 'statsOnline', 'statsBots', 'statsChannels', 'statsCategoryId',
            'antinukeEnabled', 'antinukeBan', 'antinukeChannel', 'antinukeRole', 'antinukeWebhook', 'antinukeThreshold', 'antinukeWhitelist',
            'r4TrackingEnabled', 'r4TrackingRole', 'r4TrackingAdQuota', 'r4TrackingMsgQuota',
            'swearJarEnabled', 'swearJarChannel', 'swearJarWords', 'swearJarPing'
        ];
        
        const allFields = ['guildId', ...fields];
        const placeholders = allFields.map(() => '?').join(',');
        const updateSet = fields.map(f => `${f}=excluded.${f}`).join(',');
        const values = [guildId, ...fields.map(f => b[f] !== undefined ? b[f] : null)];
        
        await db.run(
            `INSERT INTO module_configs (${allFields.join(',')}) VALUES (${placeholders}) ON CONFLICT(guildId) DO UPDATE SET ${updateSet}`,
            values
        );
        
        res.json({ success: true });
    } catch (e) {
        console.error('Error saving module configs:', e);
        res.status(500).json({ error: 'Error saving module configs' });
    }
});

// GET R4 Tracking Data
app.get('/api/r4-tracking/:guildId', async (req, res) => {
    const token = req.cookies.discord_token;
    if (!token) return res.status(401).json({ error: 'No autorizado' });

    try {
        const db = await getDb();
        const records = await db.all(`SELECT * FROM r4_tracking WHERE guildId = ? ORDER BY weekId DESC`, [req.params.guildId]);
        res.json(records || []);
    } catch (e) {
        console.error('Error fetching R4 tracking:', e);
        res.status(500).json({ error: 'Error fetching R4 tracking' });
    }
});

// POST Excuse R4 User
app.post('/api/r4-tracking/excuse/:guildId', async (req, res) => {
    const token = req.cookies.discord_token;
    if (!token) return res.status(401).json({ error: 'No autorizado' });

    const { userId, weekId, excused } = req.body;
    try {
        const db = await getDb();
        await db.run(
            `UPDATE r4_tracking SET excused = ? WHERE guildId = ? AND userId = ? AND weekId = ?`,
            [excused ? 1 : 0, req.params.guildId, userId, weekId]
        );
        res.json({ success: true });
    } catch (e) {
        console.error('Error excusing user:', e);
        res.status(500).json({ error: 'Error excusing user' });
    }
});

// GET Transcripts List
app.get('/api/transcripts/:guildId', async (req, res) => {
    const token = req.cookies.discord_token;
    if (!token) return res.status(401).json({ error: 'No autorizado' });

    try {
        const userGuilds = await fetch('https://discord.com/api/users/@me/guilds', {
            headers: { Authorization: `Bearer ${token}` }
        }).then(r => r.json());

        const guild = userGuilds.find(g => g.id === req.params.guildId);
        if (!guild || !(guild.permissions & 0x8)) {
            return res.status(403).json({ error: 'Insufficient permissions' });
        }

        const db = await getDb();
        const logs = await db.all('SELECT ticketId, userId, closedAt FROM ticket_transcripts WHERE guildId = ? ORDER BY closedAt DESC', [req.params.guildId]);
        res.json(logs);
    } catch (e) {
        console.error('Error fetching transcripts:', e);
        res.status(500).json({ error: 'Error fetching transcripts' });
    }
});

// GET Single Transcript Content
app.get('/api/transcripts/:guildId/:ticketId', async (req, res) => {
    const token = req.cookies.discord_token;
    if (!token) return res.status(401).json({ error: 'No autorizado' });

    try {
        const userGuilds = await fetch('https://discord.com/api/users/@me/guilds', {
            headers: { Authorization: `Bearer ${token}` }
        }).then(r => r.json());

        const guild = userGuilds.find(g => g.id === req.params.guildId);
        if (!guild || !(guild.permissions & 0x8)) {
            return res.status(403).json({ error: 'Insufficient permissions' });
        }

        const db = await getDb();
        const transcript = await db.get('SELECT logContent FROM ticket_transcripts WHERE guildId = ? AND ticketId = ?', [req.params.guildId, req.params.ticketId]);
        if (!transcript) return res.status(404).json({ error: 'Transcript not found' });

        res.json({ content: decodeURIComponent(transcript.logContent) });
    } catch (e) {
        console.error('Error fetching transcript content:', e);
        res.status(500).json({ error: 'Error fetching transcript content' });
    }
});

// POST Import Levels from Backup
app.post('/api/levels/import/:guildId', async (req, res) => {
    const token = req.cookies.discord_token;
    if (!token) return res.status(401).json({ error: 'No autorizado' });

    try {
        const userGuilds = await axios.get('https://discord.com/api/users/@me/guilds', {
            headers: { Authorization: `Bearer ${token}` }
        }).then(r => r.data);

        const guild = userGuilds.find(g => g.id === req.params.guildId);
        if (!guild || !(guild.permissions & 0x8)) {
            return res.status(403).json({ error: 'Insufficient permissions' });
        }

        const levelsData = req.body.levels;
        if (!levelsData || !Array.isArray(levelsData)) {
            return res.status(400).json({ error: 'Invalid backup format. Missing "levels" array.' });
        }

        const db = await getDb();
        let successCount = 0;

        await db.run('BEGIN TRANSACTION');
        try {
            for (const item of levelsData) {
                if (!item.userId || item.level === undefined) continue;
                await db.run(
                    `INSERT INTO users (userId, level, xp) VALUES (?, ?, 0)
                     ON CONFLICT(userId) DO UPDATE SET level = excluded.level, xp = 0`,
                    [item.userId, item.level]
                );
                successCount++;
            }
            await db.run('COMMIT');
            res.json({ success: true, count: successCount });
        } catch (dbErr) {
            await db.run('ROLLBACK');
            throw dbErr;
        }
    } catch (e) {
        console.error('Error importing levels:', e);
        res.status(500).json({ error: 'Internal error during import' });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🌍 Dashboard Web corriendo en puerto ${PORT}`));

// Validar Entorno
validateEnv();

// Iniciar Manejadores
require('./handlers/commandHandler')(client);
require('./handlers/eventHandler')(client);
require('./features/logging')(client);
require('./features/serverStats')(client);
require('./features/giveaways')(client);
require('./features/r4Tracker')(client);

// Iniciar bots personalizados
const customBotManager = require('./managers/CustomBotManager');
customBotManager.initAll();

client.login(process.env.DISCORD_TOKEN);
