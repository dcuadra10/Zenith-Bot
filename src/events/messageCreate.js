const { AttachmentBuilder, ChannelType, EmbedBuilder } = require('discord.js');
const { getDb } = require('../config/database');
const { handleApplicationMessage } = require('../utils/applicationHandler');
const { getISOWeekString } = require('../utils/dateHelpers');
const { buildMessage } = require('../utils/messageBuilder');
const { sendBranded } = require('../utils/brandedSender');

module.exports = {
    name: 'messageCreate',
    async execute(message, client) {
        if (message.author.bot) return;

        // Catch DMs for applications
        if (message.channel.type === ChannelType.DM) {
            return await handleApplicationMessage(message, message.client);
        }

        if (!message.guild || message.author.bot) return;

        const db = await getDb();
        const conf = await db.get(`SELECT * FROM module_configs WHERE guildId = ?`, [message.guild.id]);
        if (!conf) return;

        // --- 1. AUTO-MODERATION ---
        if (conf.automodEnabled) {
            let shouldDelete = false;
            let reason = '';

            // Anti-Mentions
            if (conf.automodMentions && message.mentions.users.size > conf.automodMaxMentions) {
                shouldDelete = true;
                reason = 'Too many mentions';
            }

            // Anti-Links (Ignore if admin)
            if (!shouldDelete && conf.automodLinks && !message.member.permissions.has('Administrator')) {
                const linkRegex = new RegExp('https?://\\S+', 'g');
                if (linkRegex.test(message.content)) {
                    shouldDelete = true;
                    reason = 'Unauthorized links';
                }
            }

            // Anti-Caps
            if (!shouldDelete && conf.automodCaps && message.content.length > 5) {
                const upper = message.content.replace(/[^A-Z]/g, '').length;
                if ((upper / message.content.length) > 0.7) {
                    shouldDelete = true;
                    reason = 'Excessive CAPS';
                }
            }

            // Bad Words
            if (!shouldDelete && conf.automodWords && conf.automodWordList) {
                const badWords = conf.automodWordList.split(',').map(w => w.trim().toLowerCase());
                const msgLower = message.content.toLowerCase();
                for (const w of badWords) {
                    if (w && msgLower.includes(w)) {
                        shouldDelete = true;
                        reason = 'Banned words';
                        break;
                    }
                }
            }

            if (shouldDelete) {
                await message.delete().catch(() => {});
                const warningMsg = await message.channel.send(`⚠️ <@${message.author.id}>, your message was removed: **${reason}**.`);
                setTimeout(() => warningMsg.delete().catch(() => {}), 3000);
                
                if (conf.automodLogChannel) {
                    const logChannel = message.guild.channels.cache.get(conf.automodLogChannel);
                    if (logChannel) {
                        const embed = new AttachmentBuilder(Buffer.from(''), { name: 'filler' }); // placeholder if needed
                        logChannel.send(`🛡️ **AutoMod Alert** | User: <@${message.author.id}> | Reason: ${reason}`);
                    }
                }
                return; // Stop processing further
            }
        }

        // --- 2. COUNTING GAME ---
        if (conf.countingEnabled && conf.countingChannel === message.channel.id) {
            let num = null;
            
            if (conf.countingMath) {
                const exprMatch = message.content.match(/^[-+*/%\s\d().]+/);
                if (exprMatch) {
                    try {
                        const evaluated = new Function('return ' + exprMatch[0])();
                        if (typeof evaluated === 'number' && !isNaN(evaluated)) {
                            num = evaluated;
                        }
                    } catch(e) {}
                }
            } else {
                const match = message.content.match(/^\d+/);
                if (match) num = parseInt(match[0], 10);
            }

            if (num !== null) {
                const isCorrectNum = (num === conf.countingCurrent + 1);
                const isSameUser = (message.author.id === conf.countingLastUser);

                if (isCorrectNum && !conf.countingSameUser && isSameUser) {
                    // Right number, but counting twice in a row (Warning, no reset)
                    await message.delete().catch(() => {});
                    const warnEmbed = new EmbedBuilder()
                        .setDescription(`⚠️ **<@${message.author.id}>, you cannot count twice in a row!** Wait for someone else to take a turn.`)
                        .setColor('Orange');
                    const warnMsg = await message.channel.send({ embeds: [warnEmbed] });
                    setTimeout(() => warnMsg.delete().catch(() => {}), 5000);
                }
                else if (isCorrectNum) {
                    // Right number, valid user (Proceed)
                    await message.react('✅').catch(() => {});
                    await db.run(`UPDATE module_configs SET countingCurrent = ?, countingLastUser = ? WHERE guildId = ?`, [num, message.author.id, message.guild.id]);
                } 
                else if (conf.countingReset) {
                    // Wrong number triggers nuclear reset
                    await message.react('❌').catch(() => {});
                    const resetEmbed = new EmbedBuilder()
                        .setTitle("💥 Sequence Detonated!")
                        .setDescription(`**<@${message.author.id}>** ruined the sequence by putting \`${num}\`!\n\nThe stack has been reset to **0**. Start again from \`1\`.`)
                        .setColor('Red');
                    await message.channel.send({ embeds: [resetEmbed] });
                    await db.run(`UPDATE module_configs SET countingCurrent = 0, countingLastUser = NULL WHERE guildId = ?`, [message.guild.id]);
                } 
                else {
                    // Wrong number, but Reset disabled (just delete)
                    await message.delete().catch(() => {});
                }
            }
            return; // Don't give XP for just counting
        }

        // --- 3. LEVELING SYSTEM ---
        if (conf.levelingEnabled) {
            try {
                // XP Cooldown check (in-memory)
                const cooldownMs = (conf.xpCooldown || 60) * 1000;
                const cooldownKey = `${message.guild.id}_${message.author.id}`;
                const now = Date.now();
                const lastXp = module.exports._xpCooldowns.get(cooldownKey);
                
                if (!lastXp || (now - lastXp) >= cooldownMs) {
                    module.exports._xpCooldowns.set(cooldownKey, now);
                    
                    const xpAmount = Math.floor(Math.random() * ((conf.xpMax || 15) - (conf.xpMin || 5) + 1)) + (conf.xpMin || 5);
                    
                    await db.run(
                        `INSERT INTO users (userId, xp, level) VALUES (?, ?, 0)
                         ON CONFLICT(userId) DO UPDATE SET xp = users.xp + ?`,
                        [message.author.id, xpAmount, xpAmount]
                    );
                    
                    const userProfile = await db.get(`SELECT * FROM users WHERE userId = ?`, [message.author.id]);
                    if (!userProfile) return;
                    
                    const currentLevel = userProfile.level;
                    const requiredXP = 5 * (currentLevel ** 2) + 50 * currentLevel + 100;

                    if (userProfile.xp >= requiredXP) {
                        await db.run(`UPDATE users SET level = level + 1, xp = 0 WHERE userId = ?`, [message.author.id]);
                        
                        const upChannel = conf.levelUpChannel ? message.guild.channels.cache.get(conf.levelUpChannel) : message.channel;
                        if (upChannel) {
                            const payload = buildMessage(false, {
                                title: '🎉 Level Up!',
                                description: `Congratulations <@${message.author.id}>, you just leveled up to **Level ${currentLevel + 1}**!`,
                                color: '#FFD700'
                            });
                            sendBranded(upChannel, payload).catch(() => {});
                        }

                        // Check Role Rewards (if configured)
                        try {
                            const rewards = JSON.parse(conf.roleRewards || '[]');
                            const reward = rewards.find(r => parseInt(r.level) === currentLevel + 1);
                            if (reward && reward.roleId) {
                                const rr = message.guild.roles.cache.get(reward.roleId.replace(/[^0-9]/g, ''));
                                if (rr) await message.member.roles.add(rr).catch(()=>{});
                            }
                        } catch(e) {}
                    }
                }
            } catch (e) {
                console.error('Leveling error:', e.message);
            }
        }

        // --- 4. R4 TRACKING (MESSAGES) ---
        if (conf.r4TrackingEnabled && conf.r4TrackingRole) {
            try {
                if (message.member.roles.cache.has(conf.r4TrackingRole.replace(/[^0-9]/g, ''))) {
                    const weekId = getISOWeekString();
                    await db.run(
                        `INSERT INTO r4_tracking (userId, guildId, weekId, messages, ads, excused) 
                         VALUES (?, ?, ?, 1, 0, 0)
                         ON CONFLICT(userId, guildId, weekId) DO UPDATE SET messages = r4_tracking.messages + 1`,
                        [message.author.id, message.guild.id, weekId]
                    );
                }
            } catch (e) {
                console.error('R4 tracking error:', e.message);
            }
        }
    },
    // In-memory XP cooldown tracker
    _xpCooldowns: new Map()
};
