const { EmbedBuilder } = require('discord.js');
const { getDb } = require('../config/database');

module.exports = {
    name: 'guildMemberAdd',
    async execute(member, client) {
        const db = await getDb();
        const conf = await db.get(`SELECT * FROM module_configs WHERE guildId = ?`, [member.guild.id]);

        if (conf) {
            // --- 1. Welcome Message ---
            if (conf.welcomeEnabled && conf.welcomeChannel) {
                const channel = member.guild.channels.cache.get(conf.welcomeChannel);
                if (channel) {
                    let title = conf.welcomeEmbedTitle || `Welcome to {server}!`;
                    let desc = conf.welcomeEmbedDesc || `Hello {user}, we hope you have a great time here.`;
                    
                    const pTitle = title.replace('{user}', `<@${member.id}>`)
                                        .replace('{server}', member.guild.name)
                                        .replace('{memberCount}', member.guild.memberCount);
                                        
                    const pDesc = desc.replace('{user}', `<@${member.id}>`)
                                      .replace('{server}', member.guild.name)
                                      .replace('{memberCount}', member.guild.memberCount);

                    const useEmbed = conf.welcomeUseEmbed === undefined || conf.welcomeUseEmbed === null ? true : !!conf.welcomeUseEmbed;

                    if (useEmbed) {
                        // Classic Embed mode
                        const embed = new EmbedBuilder()
                            .setTitle(pTitle)
                            .setDescription(pDesc)
                            .setColor(conf.welcomeColor || '#a855f7')
                            .setThumbnail(member.user.displayAvatarURL());
                        if (conf.welcomeImage) embed.setImage(conf.welcomeImage);
                        channel.send({ content: `<@${member.id}>`, embeds: [embed] }).catch(()=>{});
                    } else {
                        // Component V2 / Plain text mode
                        let textContent = `**${pTitle}**\n\n${pDesc}`;
                        const msgPayload = { content: `<@${member.id}>\n\n${textContent}` };
                        if (conf.welcomeImage) {
                            const { AttachmentBuilder } = require('discord.js');
                            try {
                                const axios = require('axios');
                                const response = await axios.get(conf.welcomeImage, { responseType: 'arraybuffer' });
                                const ext = conf.welcomeImage.split('.').pop().split('?')[0] || 'png';
                                const attachment = new AttachmentBuilder(Buffer.from(response.data), { name: `welcome.${ext}` });
                                msgPayload.files = [attachment];
                            } catch(imgErr) {
                                console.error('Could not fetch welcome image:', imgErr.message);
                            }
                        }
                        channel.send(msgPayload).catch(()=>{});
                    }
                }
            }

            // --- 2. Auto-Role ---
            if (conf.autoroleEnabled && conf.autoroleIds) {
                try {
                    const rolesIds = JSON.parse(conf.autoroleIds);
                    for (const roleId of rolesIds) {
                        const role = member.guild.roles.cache.get(roleId);
                        if (role) await member.roles.add(role).catch(()=>{});
                    }
                } catch(e) { }
            }
        }

        // --- 3. Invite Tracker ---
        try {
            const newInvites = await member.guild.invites.fetch();
            const oldInvites = client.invites.get(member.guild.id);
            
            if(oldInvites) {
                const usedInvite = newInvites.find(inv => inv.uses > oldInvites.get(inv.code));
                
                if (usedInvite) {
                    const inviterId = usedInvite.inviter.id;
                    const db = await getDb();
                    await db.run(
                        `INSERT INTO users (userId, invites) VALUES (?, 1)
                         ON CONFLICT(userId) DO UPDATE SET invites = invites + 1`,
                        [inviterId]
                    );
                    
                    oldInvites.set(usedInvite.code, usedInvite.uses);
                }
            }
        } catch (e) {
            console.error('Error tracking invite on guildMemberAdd', e);
        }
    }
};
