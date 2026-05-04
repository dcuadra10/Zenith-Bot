const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require('discord.js');
const { processAdsSubmission } = require('../commands/tracking/add-ads');
const { handleTicketSelection, handleApplicationStartButton, createTicketChannel } = require('../utils/applicationHandler');
const { getDb } = require('../config/database');

module.exports = {
    name: 'interactionCreate',
    async execute(interaction, client) {
        console.log(`[INTERACTION] Type: ${interaction.type}, Name: ${interaction.commandName || interaction.customId}, User: ${interaction.user.tag}`);
        if (interaction.isChatInputCommand()) {
            const command = client.commands.get(interaction.commandName);
            if (!command) {
                console.warn(`[WARNING] Command not found: ${interaction.commandName}`);
                return;
            }

            try {
                await command.execute(interaction);
            } catch (error) {
                console.error(error);
                if (interaction.replied || interaction.deferred) {
                    await interaction.followUp({ content: '❌ There was an error executing this command.', ephemeral: true });
                } else {
                    await interaction.reply({ content: '❌ There was an error executing this command.', ephemeral: true });
                }
            }
        } 
        else if (interaction.isButton()) {
            if (interaction.customId.startsWith('market_')) {
                const { handleMarketInteraction } = require('../features/market');
                await handleMarketInteraction(interaction);
                return;
            } else if (interaction.customId === 'btn_register_ads') {
                const modal = new ModalBuilder()
                    .setCustomId('modal_register_ads')
                    .setTitle('Log Sent Ads');

                const amountInput = new TextInputBuilder()
                    .setCustomId('adsAmount')
                    .setLabel("How many ads did you send?")
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true)
                    .setPlaceholder('e.g. 5');

                const row = new ActionRowBuilder().addComponents(amountInput);
                modal.addComponents(row);

                await interaction.showModal(modal);
            } else if (interaction.customId.startsWith('start_app_')) {
                await handleApplicationStartButton(interaction);

            } else if (interaction.customId.startsWith('ticket_panel_')) {
                const parts = interaction.customId.split('_');
                // ticket_panel_{panelId}_btn_{rIdx}_{oIdx}
                if (parts[3] === 'btn') {
                    const panelId = parts[2];
                    const rIdx = parseInt(parts[4]);
                    const oIdx = parseInt(parts[5]);
                    
                    const db = await getDb();
                    const panelRec = await db.get(`SELECT panelData FROM ticket_panels WHERE id = ?`, [panelId]);
                    if (!panelRec) return interaction.reply({ content: 'Panel data not found.', ephemeral: true });

                    const data = JSON.parse(panelRec.panelData);
                    const opt = data.buttonRows[rIdx].options[oIdx];
                    const guildConfigs = await db.get(`SELECT * FROM guild_configs WHERE guildId = ?`, [interaction.guildId]);
                    const moduleConfigs = await db.get(`SELECT * FROM module_configs WHERE guildId = ?`, [interaction.guildId]);
                    await handleTicketSelection(interaction, opt, guildConfigs, moduleConfigs);
                }

            } else if (interaction.customId === 'start_app_yes' || interaction.customId === 'start_app_no' || interaction.customId.startsWith('app_choice_')) {
                const { handleApplicationStartButton } = require('../utils/applicationHandler');
                await handleApplicationStartButton(interaction);

            } else if (interaction.customId.startsWith('claim_ticket_')) {
                if (!interaction.member.permissions.has('ManageChannels')) {
                    return interaction.reply({ content: '❌ You do not have permission to claim this ticket.', ephemeral: true });
                }
                
                const originalEmbed = interaction.message.embeds[0];
                if (!originalEmbed) return interaction.reply({ content: '❌ Could not find ticket embed.', ephemeral: true });

                const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
                const newEmbed = EmbedBuilder.from(originalEmbed)
                    .addFields({ name: 'Assigned Staff', value: `<@${interaction.user.id}>` });

                const parts = interaction.customId.split('_');
                const targetUserId = parts[2];
                const newRow = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId(`close_ticket_${targetUserId}`).setLabel('🔒 Close').setStyle(ButtonStyle.Danger)
                );

                await interaction.update({ embeds: [newEmbed], components: [newRow] });
                await interaction.followUp({ content: `✅ Ticket claimed by <@${interaction.user.id}>. They will assist you shortly!` });

            } else if (interaction.customId.startsWith('close_ticket_')) {
                if (!interaction.member.permissions.has('ManageChannels')) {
                    return interaction.reply({ content: '❌ You do not have permission to close this ticket.', ephemeral: true });
                }
                
                await interaction.reply('Generating transcript and closing ticket in 5 seconds...');
                
                try {
                    const discordTranscripts = require('discord-html-transcripts');
                    
                    const attachment = await discordTranscripts.createTranscript(interaction.channel, {
                        limit: -1, 
                        returnType: 'attachment',
                        filename: `${interaction.channel.name}-transcript.html`,
                        saveImages: true, 
                        poweredBy: false
                    });
                    
                    const htmlString = await discordTranscripts.createTranscript(interaction.channel, {
                        limit: -1,
                        returnType: 'string',
                        saveImages: true,
                        poweredBy: false
                    });
                    
                    const encodedHTML = encodeURIComponent(htmlString);
                    const db = await getDb();
                    
                    const targetUser = interaction.customId.split('_')[2];
                    const ticketId = interaction.channel.name + '-' + Date.now().toString().slice(-4);
                    await db.run(
                        `INSERT INTO ticket_transcripts (ticketId, guildId, userId, logContent) VALUES (?, ?, ?, ?)`,
                        [ticketId, interaction.guildId, targetUser || interaction.user.id, encodedHTML]
                    );

                    const moduleConfigs = await db.get(`SELECT ticketsTranscriptChannel FROM module_configs WHERE guildId = ?`, [interaction.guildId]);

                    if (targetUser) {
                        try {
                            const dmMember = await interaction.guild.members.fetch(targetUser).catch(() => null);
                            if (dmMember) {
                                await dmMember.send({ content: `✅ Your ticket \`${interaction.channel.name}\` has been closed. Here is your transcript:`, files: [attachment] });
                            }
                        } catch(err) {
                            console.error('Could not DM user transcript.');
                        }
                    }
                    if (moduleConfigs && moduleConfigs.ticketsTranscriptChannel) {
                        const transcriptChannel = interaction.guild.channels.cache.get(moduleConfigs.ticketsTranscriptChannel);
                        if (transcriptChannel) {
                            await transcriptChannel.send({ content: `📁 Transcript for ticket \`${interaction.channel.name}\``, files: [attachment] });
                        }
                    }
                } catch(e) {
                    console.error('Error generating transcript:', e);
                }
                setTimeout(() => interaction.channel.delete().catch(() => {}), 5000);
            } else if (interaction.customId.startsWith('admin_app_approve_')) {
                const uuid = interaction.customId.split('_').pop();
                const db = await getDb();
                const pending = await db.get(`SELECT * FROM pending_tickets WHERE uuid = ?`, [uuid]);
                if (!pending) return interaction.reply({ content: '❌ Application data not found or already processed.', ephemeral: true });

                const opt = JSON.parse(pending.optJson);
                const answers = JSON.parse(pending.answersJson);
                const guildConfigs = await db.get(`SELECT * FROM guild_configs WHERE guildId = ?`, [interaction.guildId]);
                const moduleConfigs = await db.get(`SELECT * FROM module_configs WHERE guildId = ?`, [interaction.guildId]);

                await createTicketChannel(interaction, opt, answers, guildConfigs, moduleConfigs, pending.userId);
                await db.run(`DELETE FROM pending_tickets WHERE uuid = ?`, [uuid]);
                await interaction.update({ content: `✅ Application approved by <@${interaction.user.id}>. Ticket created.`, embeds: interaction.message.embeds, components: [] });

            } else if (interaction.customId.startsWith('admin_app_decline_')) {
                const uuid = interaction.customId.split('_').pop();
                const modal = new ModalBuilder()
                    .setCustomId(`admin_app_decline_modal_${uuid}`)
                    .setTitle('Decline Application');

                const reasonInput = new TextInputBuilder()
                    .setCustomId('declineReason')
                    .setLabel("Reason for rejection (Optional)")
                    .setStyle(TextInputStyle.Paragraph)
                    .setRequired(false)
                    .setPlaceholder('Provide feedback to the user...');

                modal.addComponents(new ActionRowBuilder().addComponents(reasonInput));
                await interaction.showModal(modal);
            }
        }
        else if (interaction.isStringSelectMenu()) {
            if (interaction.customId.startsWith('ticket_panel_')) {
                const value = interaction.values[0];
                if (!value.startsWith('ticket_opt_')) return;
                
                const parts = value.split('_');
                const panelId = parts[2];
                const dIdx = parseInt(parts[3]);
                const oIdx = parseInt(parts[4]);

                const db = await getDb();
                const panelRec = await db.get(`SELECT panelData FROM ticket_panels WHERE id = ?`, [panelId]);
                if (!panelRec) return interaction.reply({ content: 'Panel data not found.', ephemeral: true });

                const data = JSON.parse(panelRec.panelData);
                const opt = data.dropdowns[dIdx].options[oIdx];
                
                const guildConfigs = await db.get(`SELECT * FROM guild_configs WHERE guildId = ?`, [interaction.guildId]);
                const moduleConfigs = await db.get(`SELECT * FROM module_configs WHERE guildId = ?`, [interaction.guildId]);

                await handleTicketSelection(interaction, opt, guildConfigs, moduleConfigs, panelId, dIdx, oIdx);
            } else if (interaction.customId === 'app_edit_select') {
                await handleApplicationStartButton(interaction);
            }
        }
        else if (interaction.isModalSubmit()) {
            if (interaction.customId === 'modal_register_ads') {
                const amountStr = interaction.fields.getTextInputValue('adsAmount');
                const amount = parseInt(amountStr, 10);

                if (isNaN(amount) || amount <= 0) {
                    return interaction.reply({ content: "❌ Please enter a valid number greater than 0.", ephemeral: true });
                }

                await interaction.deferReply({ ephemeral: true });
                await processAdsSubmission(interaction, amount);
            }
            else if (interaction.customId.startsWith('modal_ticket_app_')) {
                const parts = interaction.customId.split('_');
                const panelId = parts[3];
                const dIdx = parseInt(parts[4]);
                const oIdx = parseInt(parts[5]);

                const db = await getDb();
                const panelRec = await db.get(`SELECT panelData FROM ticket_panels WHERE id = ?`, [panelId]);
                if (!panelRec) return interaction.reply({ content: 'Panel data not found.', ephemeral: true });

                const data = JSON.parse(panelRec.panelData);
                const opt = data.dropdowns[dIdx].options[oIdx];
                
                const guildConfigs = await db.get(`SELECT * FROM guild_configs WHERE guildId = ?`, [interaction.guildId]);
                const moduleConfigs = await db.get(`SELECT * FROM module_configs WHERE guildId = ?`, [interaction.guildId]);

                const answers = [];
                // Only first 5 questions could be rendered in modal
                const numQuestions = Math.min(opt.questions.length, 5);
                for (let i = 0; i < numQuestions; i++) {
                    answers.push({
                        question: opt.questions[i],
                        answer: interaction.fields.getTextInputValue(`q_${i}`)
                    });
                }

                const { createTicketChannel } = require('../utils/applicationHandler');
                await createTicketChannel(interaction, opt, answers, guildConfigs, moduleConfigs);
            }
            else if (interaction.customId.startsWith('admin_app_decline_modal_')) {
                const uuid = interaction.customId.split('_').pop();
                const reason = interaction.fields.getTextInputValue('declineReason') || 'No specific reason provided.';
                
                const db = await getDb();
                const pending = await db.get(`SELECT * FROM pending_tickets WHERE uuid = ?`, [uuid]);
                if (!pending) return interaction.reply({ content: '❌ Application data not found.', ephemeral: true });

                const user = await client.users.fetch(pending.userId).catch(() => null);
                if (user) {
                    await user.send(`❌ Your application for **${JSON.parse(pending.optJson).label}** was declined.\n**Reason:** ${reason}`).catch(() => {});
                }

                await db.run(`DELETE FROM pending_tickets WHERE uuid = ?`, [uuid]);
                await interaction.update({ content: `❌ Application declined by <@${interaction.user.id}>.\n**Reason:** ${reason}`, embeds: interaction.message.embeds, components: [] });
            }
            else if (interaction.customId.startsWith('modal_market_')) {
                const { handleMarketInteraction } = require('../features/market');
                await handleMarketInteraction(interaction);
            }
        }
        }
    },
};
