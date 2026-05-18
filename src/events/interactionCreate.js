const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, EmbedBuilder } = require('discord.js');
const { processAdsSubmission } = require('../commands/tracking/add-ads');
const { handleTicketSelection, handleApplicationStartButton, createTicketChannel } = require('../utils/applicationHandler');
const { getDb } = require('../config/database');

module.exports = {
    name: 'interactionCreate',
    async execute(interaction, client) {
        if (interaction.isAutocomplete()) {
            const command = client.commands.get(interaction.commandName);
            if (!command || !command.autocomplete) return;
            try {
                await command.autocomplete(interaction);
            } catch (err) {
                console.error('Autocomplete Error:', err);
            }
            return;
        }

        console.log(`[INTERACTION] Type: ${interaction.type}, Name: ${interaction.commandName || interaction.customId}, User: ${interaction.user.tag}`);
        if (interaction.isChatInputCommand()) {
            const commandName = interaction.commandName;
            const publicCommands = ['help', 'jail', 'mafia', 'family'];
            const slowCommands = ['help', 'mafia', 'businesses', 'jail', 'influence', 'family'];
            
            if (slowCommands.includes(commandName)) {
                const shouldBePublic = publicCommands.includes(commandName);
                const isEphemeral = !shouldBePublic;
                console.log(`[DEBUG] Command: ${commandName}, ShouldBePublic: ${shouldBePublic}, Final Ephemeral: ${isEphemeral}`);
                
                if (interaction.isRepliable()) {
                    if (interaction.replied || interaction.deferred) {
                        console.log(`[DEBUG] Interaction ${interaction.id} already acknowledged, skipping defer.`);
                    } else {
                        try {
                            await interaction.deferReply({ ephemeral: isEphemeral });
                        } catch (e) {
                            console.error('[ERROR] DeferReply failed:', e.message);
                            return; 
                        }
                    }
                }
            }
            
            const command = client.commands.get(interaction.commandName);
            if (!command) {
                console.warn(`[WARNING] Command not found: ${interaction.commandName}`);
                return;
            }

            const step1 = Date.now();
            const db = await getDb();
            const dbTime = Date.now() - step1;
            console.log(`[DEBUG] getDb took ${dbTime}ms for ${interaction.commandName}`);

            const step2 = Date.now();
            const userData = await db.get(`SELECT jailUntil FROM users WHERE userId = ?`, [interaction.user.id]);
            console.log(`[DEBUG] userData fetch took ${Date.now() - step2}ms`);
            if (userData && userData.jailUntil && new Date(userData.jailUntil) > new Date()) {
                if (interaction.commandName !== 'jail' && interaction.commandName !== 'help') {
                    const diffMs = new Date(userData.jailUntil) - new Date();
                    const hours = Math.floor(diffMs / 3600000);
                    const minutes = Math.ceil((diffMs % 3600000) / 60000);
                    const timeStr = hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
                    
                    const embed = new EmbedBuilder()
                        .setTitle('⛓️ Jail Record')
                        .setDescription(`You are currently serving a sentence in the Zenith Correctional Facility.`)
                        .addFields({ name: 'Time Remaining', value: `⏳ ${timeStr}` })
                        .setColor('#b91c1c')
                        .setTimestamp();
                    
                    return await interaction.editReply({ 
                        embeds: [embed]
                    });
                }
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
                    
                    if (!moduleConfigs || !moduleConfigs.ticketsEnabled) {
                        return interaction.reply({ content: '❌ The ticket system is currently disabled.', ephemeral: true });
                    }
                    
                    await handleTicketSelection(interaction, opt, guildConfigs, moduleConfigs);
                }

            } else if (interaction.customId.startsWith('start_app_') || 
                       interaction.customId.startsWith('app_choice_') || 
                       interaction.customId === 'app_finalize_submit' || 
                       interaction.customId === 'app_cancel_all') {
                await handleApplicationStartButton(interaction);
            } else if (interaction.customId === 'app_edit_select') {
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
                    
                    // Capture application answers from the welcome embed before generating transcript
                    try {
                        const pinnedMessages = await interaction.channel.messages.fetch({ limit: 10 });
                        const welcomeMsg = pinnedMessages.find(m => m.author.id === client.user.id && m.embeds.length > 0 && m.embeds[0].fields?.length > 0);
                        if (welcomeMsg) {
                            const answerFields = welcomeMsg.embeds[0].fields.filter(f => f.name.startsWith('Q'));
                            if (answerFields.length > 0) {
                                const { EmbedBuilder } = require('discord.js');
                                const summaryEmbed = new EmbedBuilder()
                                    .setTitle('📋 Application Responses')
                                    .setColor('#ffd700')
                                    .setDescription(answerFields.map(f => `**${f.name}**\n${f.value}`).join('\n\n'))
                                    .setFooter({ text: 'Archived at ticket closure' })
                                    .setTimestamp();
                                await interaction.channel.send({ embeds: [summaryEmbed] });
                            }
                        }
                    } catch (e) { /* silently continue if answer capture fails */ }
                    
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

                if (!moduleConfigs || !moduleConfigs.ticketsEnabled) {
                    return interaction.reply({ content: '❌ The ticket system is currently disabled.', ephemeral: true });
                }

                await handleTicketSelection(interaction, opt, guildConfigs, moduleConfigs, panelId, dIdx, oIdx);
            } else if (interaction.customId === 'app_edit_select') {
                await handleApplicationStartButton(interaction);
            } else if (interaction.customId === 'help_category') {
                await interaction.deferUpdate().catch(() => {});
                const category = interaction.values[0];
                const { EmbedBuilder } = require('discord.js');
                const helpEmbed = new EmbedBuilder().setColor('#111827');

                if (category === 'help_mafia') {
                    helpEmbed.setTitle('🌑 Mafia & Economy — Detailed Guide')
                        .setDescription('Master the criminal underworld and the city economy.')
                        .addFields(
                            { name: '💰 Earning Money', value: '• **Legal:** Use `/work` or `/jobs` to earn clean coins.\n• **Illegal:** Use `/mafia heist` or `/mafia rob` for high rewards in **Dirty Money**.' },
                            { name: '🏦 The Mafia Vault', value: '• **Taxation:** Mafias have an automatic tax (max 20%) that funds the vault.\n• **Upgrades:** The Don uses vault funds in the `/mafia armory` for vests, cars, and hackers.' },
                            { name: '🧼 Dirty Money & Cleaning', value: '• Illegal acts pay in unlaundered bills.\n• Use `/mafia clean` to process them into clean coins (20% fee).' },
                            { name: '👛 Wallet vs 🏦 Bank', value: '• **Wallet:** Cash on hand. Risk of loss if robbed or jailed!\n• **Bank:** Safe storage for your coins. Use `/bank deposit` and `/bank withdraw`.\n• **Upgrades:** The bank starts at 5,000 capacity. Use `/bank upgrade` to store more.' },
                            { name: '⚖️ Jail & Justice', value: '• Getting caught sends you to jail.\n• Use `/jail info` to see your sentence, or try a `/jail trial` or `/jail bribe`.' },
                            { name: '🚩 Turfs & Control', value: '• Mafias battle for city turfs using `/mafia turfs` to get global bonuses (discounts, extra loot).' },
                            { name: '🌟 Community Rewards', value: '• Earn coins passively by being active!\n• **Chatting:** Coins per message.\n• **Invites:** Rewards for each friend invited.\n• **VC Activity:** Earnings for every minute in voice channels.\n• **Server Support:** Bonuses for Boosting and Welcoming new members.' }
                        );
                } else if (category === 'help_social') {
                    helpEmbed.setTitle('💍 Social & Family — Detailed Guide')
                        .setDescription('Build your legacy and dynasty in Zenith City.')
                        .addFields(
                            { name: '💍 Marriage & Partners', value: '• Use `/marry` to propose to another citizen.\n• **Bonus:** Gain a **+10% Coin Multiplier** on all earnings.' },
                            { name: '👪 Adoption & Children', value: '• Use `/adopt` to add members to your family.\n• **Bonus:** Gain **+5% per child** (Max +25%).' },
                            { name: '🌳 Visual Lineage', value: '• Use `/family` to see a high-fidelity image of your family tree.' },
                            { name: '💔 Divorce', value: '• Relationship not working? Use `/divorce` to end the union (costs 2500 coins).' }
                        );
                } else if (category === 'help_community') {
                    helpEmbed.setTitle('📊 Community & Ranking — Detailed Guide')
                        .setDescription('Track your progress and influence.')
                        .addFields(
                            { name: '📈 Leveling & XP', value: '• Earn XP by chatting and being active.\n• Use `/rank` to see your progress and level rewards.' },
                            { name: '🏛️ Influence Market', value: '• Invest in city sectors (Casino, Bank, etc.) using `/influence buy`.\n• Controlling sectors gives the entire community special perks.' },
                            { name: '🏆 Competition', value: '• Use `/leaderboard` to see the top earners and most powerful mafias.' }
                        );
                } else if (category === 'help_staff') {
                    helpEmbed.setTitle('⚙️ Staff & Administration')
                        .setDescription('Administrative tools for kingdom management.')
                        .addFields(
                            { name: 'Economy Management', value: '`/eco-admin setbalance`, `/eco-admin reset-jail`, `/market-setup`' },
                            { name: 'Ads & Activity', value: '`/add-ads`, `/setup-ads-panel`, `/activity-check`, `/r4-stats`' },
                            { name: 'Member Tools', value: '`/export-members`, `/import-members`, `/giveaway`' }
                        );
                }

                await interaction.update({ embeds: [helpEmbed] });
            } else if (interaction.customId.startsWith('bank_upgrade_')) {
                const bankId = interaction.customId.split('_').pop();
                const upgradeId = interaction.values[0];
                const db = await getDb();
                
                const bank = await db.get(`SELECT * FROM economy_banks WHERE id = ?`, [bankId]);
                if (!bank || bank.ownerId !== interaction.user.id) return interaction.reply({ content: '❌ You do not own this bank.', ephemeral: true });

                const upgrades = [
                    { id: 'vaults', name: 'Reinforced Vaults', cost: 50000, sec: 0.1, ins: 0, res: 0 },
                    { id: 'encryption', name: 'Advanced Encryption', cost: 100000, sec: 0.15, ins: 0, res: 0 },
                    { id: 'insurance', name: 'Gold Insurance', cost: 150000, sec: 0, ins: 0.2, res: 0 },
                    { id: 'reserve', name: 'Reserve Expansion', cost: 200000, sec: 0, ins: 0, res: 100000 }
                ];

                const up = upgrades.find(u => u.id === upgradeId);
                const { removeBalance } = require('../utils/economyHandler');
                
                const removed = await removeBalance(interaction.user.id, up.cost);
                if (!removed) return interaction.reply({ content: `❌ You need **${up.cost}** coins for this upgrade!`, ephemeral: true });

                const currentUps = JSON.parse(bank.upgrades || '[]');
                currentUps.push(up.name);

                await db.run(
                    `UPDATE economy_banks SET security = security + ?, insurance = insurance + ?, reserve = reserve + ?, upgrades = ? WHERE id = ?`,
                    [up.sec, up.ins, up.res, JSON.stringify(currentUps), bankId]
                );

                await interaction.reply({ content: `✅ **Upgrade Purchased!** Your bank now has **${up.name}**.`, ephemeral: true });
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

                if (!moduleConfigs || !moduleConfigs.ticketsEnabled) {
                    return interaction.reply({ content: '❌ The ticket system is currently disabled.', ephemeral: true });
                }

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
    },
};
