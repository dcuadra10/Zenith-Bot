const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, PermissionsBitField } = require('discord.js');
const { getDb } = require('../config/database');

async function handleTicketSelection(interaction, opt, guildConfigs, moduleConfigs, panelId, dIdx, oIdx) {
    const systemType = opt.systemType || 'ticket';
    const limit = moduleConfigs?.ticketsMaxActive || 2;
    
    // Count active tickets for user securely using channel topics
    const botGuild = interaction.client.guilds.cache.get(interaction.guildId);
    let openCount = 0;
    if (botGuild) {
        botGuild.channels.cache.forEach(c => {
            if (c.type === ChannelType.GuildText && c.topic === interaction.user.id) {
                openCount++;
            }
        });
    }
    
    if (openCount >= limit) {
        return interaction.reply({ content: `❌ You have reached the maximum open limit of ${limit} active tickets. Please close them before opening a new one.`, ephemeral: true });
    }

    const hasQuestions = opt.questions && opt.questions.length > 0;
    const delivery = opt.questionDelivery || 'dm';

    if (hasQuestions) {
        if (delivery === 'modal') {
            const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require('discord.js');
            const modal = new ModalBuilder()
                .setCustomId(`modal_ticket_app_${panelId}_${dIdx}_${oIdx}`)
                .setTitle((opt.label || 'Application').substring(0, 45));

            const numQuestions = Math.min(opt.questions.length, 5);
            for (let i = 0; i < numQuestions; i++) {
                modal.addComponents(new ActionRowBuilder().addComponents(
                    new TextInputBuilder()
                        .setCustomId(`q_${i}`)
                        .setLabel(opt.questions[i].substring(0, 45))
                        .setStyle(TextInputStyle.Paragraph)
                        .setRequired(true)
                ));
            }
            return await interaction.showModal(modal);
        } else {
            return await startApplication(interaction, opt, guildConfigs, moduleConfigs);
        }
    } else {
        await createTicketChannel(interaction, opt, {}, guildConfigs, moduleConfigs);
    }
}

async function startApplication(interaction, opt, guildConfigs, moduleConfigs) {
    // Send a DM to start
    const embed = new EmbedBuilder()
        .setTitle(`📝 Application: ${opt.label}`)
        .setDescription(`You have initiated an application. I will ask you **${opt.questions.length} questions**.\n\nPlease answer each question fully. Reply with your answers here in DMs. Do you wish to begin?`)
        .setColor('#a855f7');
        
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`start_app_yes`)
            .setLabel('Begin Application')
            .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
            .setCustomId(`start_app_no`)
            .setLabel('Cancel')
            .setStyle(ButtonStyle.Danger)
    );

    try {
        const dmMsg = await interaction.user.send({ embeds: [embed], components: [row] });
        await interaction.reply({ content: `✅ I have sent you a DM to begin your application! Please open your DMs to proceed.`, ephemeral: true });

        // Register active application
        interaction.client.activeApplications.set(interaction.user.id, {
            guildId: interaction.guildId,
            member: interaction.member,
            opt: opt,
            guildConfigs: guildConfigs,
            moduleConfigs: moduleConfigs,
            currentQuestion: 0,
            answers: [],
            currentBuffer: '',
            dmChannelId: dmMsg.channelId,
            status: 'waiting_to_start'
        });
    } catch(e) {
        await interaction.reply({ content: `❌ I couldn't DM you! Please ensure your DMs are open and try again.`, ephemeral: true });
    }
}

async function handleApplicationMessage(message, client) {
    if (message.author.bot) return;
    if (message.channel && message.channel.type !== ChannelType.DM) return;

    const appState = client.activeApplications.get(message.author.id);
    if (!appState || (appState.status !== 'in_progress' && appState.status !== 'review' && appState.status !== 'editing')) return;

    try {
        const content = message.content.toLowerCase().trim();
        const currentQ = getQuestion(appState);
        const qType = currentQ.type || 'text';

        // 1. Process attachments first for image questions
        if (qType === 'image' && message.attachments.size > 0 && appState.status !== 'review') {
            message.attachments.forEach(attachment => {
                appState.currentBuffer += attachment.url + '\n';
            });
            await message.react('✅').catch(() => {});
        }

        // 2. Handle Navigation Commands
        if (content === 'back' || content === 'repeatq') {
            if (appState.currentQuestion > 0) {
                appState.currentQuestion--;
                appState.currentBuffer = '';
                appState.answers.pop();
                return await askQuestion(message, appState);
            } else {
                return await message.author.send('⚠️ You are already on the first question! You cannot go back further.');
            }
        }

        if (content === 'next') {
            const hasBuffer = appState.currentBuffer && appState.currentBuffer.trim() !== '';
            
            // Check if required
            if (currentQ.required && !hasBuffer) {
                return await message.author.send('⚠️ This question is **Required**. Please provide an answer (text or image) before typing `next`.');
            }

            if (!hasBuffer && qType !== 'choice' && qType !== 'image' && qType !== 'text_image') {
                return await message.author.send('⚠️ You must provide an answer before typing `next`.');
            }
            
            const existingAnswerIdx = appState.answers.findIndex(a => a.question === (currentQ.text || currentQ));
            const newAnswer = {
                question: currentQ.text || currentQ,
                answer: appState.currentBuffer.trim() || 'No answer provided'
            };

            if (existingAnswerIdx !== -1) {
                appState.answers[existingAnswerIdx] = newAnswer;
            } else {
                appState.answers.push(newAnswer);
            }

            appState.currentBuffer = '';
            
            if (appState.status === 'editing') {
                appState.status = 'review';
                return await showReviewScreen(message, appState);
            }

            appState.currentQuestion++;

            if (appState.currentQuestion >= appState.opt.questions.length) {
                appState.status = 'review';
                await showReviewScreen(message, appState);
            } else {
                await askQuestion(message, appState);
            }
            return;
        }

        // 3. Accumulate data if not a command
        if (appState.status === 'review') {
            return await message.author.send('⚠️ You are in the review phase. Please use the menu below to edit an answer or click **Finalize & Send**.');
        }

        // Capture attachments
        if (message.attachments.size > 0) {
            message.attachments.forEach(att => {
                appState.currentBuffer += `[Image/File]: ${att.proxyURL}\n`;
            });
        }

        if (qType === 'image') {
            if (message.attachments.size === 0 && content !== '' && content !== 'next') {
                await message.author.send('📷 You can upload an image now, or type `next` to skip this optional step.');
            }
        } else if (qType === 'choice') {
            if (appState.currentBuffer === '') {
                await message.author.send('⚠️ Please select an option using the buttons above, then type `next`.');
            }
        } else {
            if (message.content.trim() !== '') {
                appState.currentBuffer += message.content + '\n';
            }
        }
    } catch (err) {
        console.error('Error in handleApplicationMessage:', err);
    }
}

async function showReviewScreen(messageOrInteraction, appState) {
    const { StringSelectMenuBuilder, StringSelectMenuOptionBuilder } = require('discord.js');
    const user = messageOrInteraction.user || messageOrInteraction.author;
    
    let summary = '';
    appState.answers.forEach((ans, i) => {
        let displayAns = ans.answer;
        if (displayAns.length > 100) displayAns = displayAns.substring(0, 97) + '...';
        const line = `**${i + 1}. ${ans.question}**\n> ${displayAns}\n\n`;
        if ((summary + line).length < 4000) {
            summary += line;
        }
    });

    const embed = new EmbedBuilder()
        .setTitle('🔍 Review Your Application')
        .setDescription(summary || 'No answers recorded yet.')
        .setColor('#ffd700');

    const selectMenu = new StringSelectMenuBuilder()
        .setCustomId('app_edit_select')
        .setPlaceholder('Modify a previous answer...')
        .addOptions(
            appState.answers.slice(0, 25).map((ans, i) => 
                new StringSelectMenuOptionBuilder()
                    .setLabel(`Edit Question ${i + 1}`)
                    .setDescription(ans.question.substring(0, 50))
                    .setValue(`${i}`)
            )
        );

    const rowMenu = new ActionRowBuilder().addComponents(selectMenu);
    const rowButtons = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('app_finalize_submit').setLabel('Finalize & Send').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('app_cancel_all').setLabel('Abort').setStyle(ButtonStyle.Danger)
    );

    return await user.send({ embeds: [embed], components: [rowMenu, rowButtons] });
}

async function submitApplication(interaction, appState) {
    const db = await getDb();
    const config = appState.moduleConfigs;

    if (config && config.ticketsApprovalChannel) {
        const crypto = require('crypto');
        const uuid = crypto.randomUUID().substring(0, 8);
        
        await db.run(
            `INSERT INTO pending_tickets (uuid, guildId, userId, optJson, answersJson) VALUES (?, ?, ?, ?, ?)`,
            [uuid, appState.guildId, interaction.user.id, JSON.stringify(appState.opt), JSON.stringify(appState.answers)]
        );

        const adminChannel = interaction.client.channels.cache.get(config.ticketsApprovalChannel);
        if (adminChannel) {
            const adminEmbed = new EmbedBuilder()
                .setTitle('📥 New Application for Review')
                .setDescription(`**User:** <@${interaction.user.id}>\n**Ticket Type:** ${appState.opt.label}\n\n**Answers:**`)
                .setColor('#ffd700');

            appState.answers.forEach((ans, i) => {
                adminEmbed.addFields({ name: `${i+1}. ${ans.question}`, value: ans.answer.substring(0, 1024) });
            });

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`admin_app_approve_${uuid}`).setLabel('Approve').setStyle(ButtonStyle.Success),
                new ButtonBuilder().setCustomId(`admin_app_decline_${uuid}`).setLabel('Decline').setStyle(ButtonStyle.Danger)
            );

            await adminChannel.send({ embeds: [adminEmbed], components: [row] });
        }
        await interaction.update({ content: '✅ Your application has been sent for admin review. You will be notified of the decision.', embeds: [], components: [] });
    } else {
        await interaction.update({ content: '🚀 Creating your ticket channel now...', embeds: [], components: [] });
        await createTicketChannel(interaction, appState.opt, appState.answers, appState.guildConfigs, appState.moduleConfigs);
    }
    interaction.client.activeApplications.delete(interaction.user.id);
}

function getQuestion(appState) {
    const q = appState.opt.questions[appState.currentQuestion];
    return typeof q === 'string' ? { text: q, type: 'text' } : q;
}

async function askQuestion(messageOrInteraction, appState) {
    const user = messageOrInteraction.user || messageOrInteraction.author;
    const q = getQuestion(appState);
    const indicator = q.required ? ' *(Required)*' : '';
    
    const embed = new EmbedBuilder()
        .setTitle(`Question ${appState.currentQuestion + 1} of ${appState.opt.questions.length}${indicator}`)
        .setDescription(`**${q.text}**`)
        .setColor('#3498db')
        .setFooter({ text: 'Type "next" to skip/confirm, "back" to go back.' });

    if (q.type === 'image') {
        embed.addFields({ name: 'Requirement', value: '📷 Upload an image. Type `next` to skip.' });
    } else if (q.type === 'text_image') {
        embed.addFields({ name: 'Requirement', value: '📝 Provide text and/or 📷 upload an image.' });
    } else if (q.type === 'choice') {
        embed.addFields({ name: 'Requirement', value: '🔘 Select one of the options below.' });
        
        const options = (q.options || '').split(',').map(o => o.trim()).filter(o => o);
        if (options.length > 0) {
            const row = new ActionRowBuilder();
            // Up to 5 buttons for simplicity in DMs
            options.slice(0, 5).forEach((opt, i) => {
                row.addComponents(
                    new ButtonBuilder()
                        .setCustomId(`app_choice_${i}`)
                        .setLabel(opt)
                        .setStyle(ButtonStyle.Secondary)
                );
            });
            return await user.send({ embeds: [embed], components: [row] });
        }
    }

    return await user.send({ embeds: [embed], components: [] });
}

async function handleApplicationStartButton(interaction) {
    const appState = interaction.client.activeApplications.get(interaction.user.id);

    if (interaction.customId === 'app_finalize_submit') {
        if (!appState) return interaction.reply({ content: 'Session expired.', ephemeral: true });
        return await submitApplication(interaction, appState);
    }

    if (interaction.customId === 'app_cancel_all') {
        interaction.client.activeApplications.delete(interaction.user.id);
        return await interaction.update({ content: '❌ Application cancelled.', embeds: [], components: [] });
    }

    if (interaction.isStringSelectMenu() && interaction.customId === 'app_edit_select') {
        if (!appState) return interaction.reply({ content: 'Session expired.', ephemeral: true });
        const idx = parseInt(interaction.values[0]);
        appState.status = 'editing';
        appState.currentQuestion = idx;
        appState.currentBuffer = '';
        await interaction.update({ content: `🔄 Re-answering Question ${idx + 1}...`, embeds: [], components: [] });
        return await askQuestion(interaction, appState);
    }

    if (!appState) {
        if (interaction.reply) await interaction.reply({ content: 'Session expired.', ephemeral: true });
        return;
    }

    if (interaction.customId === 'start_app_yes') {
        appState.status = 'in_progress';
        await interaction.update({ content: 'Application process initiated.', embeds: [], components: [] });
        await askQuestion(interaction, appState);
    } else if (interaction.customId.startsWith('app_choice_')) {
        const q = getQuestion(appState);
        const options = (q.options || '').split(',').map(o => o.trim()).filter(o => o);
        const choiceIdx = parseInt(interaction.customId.split('_').pop());
        const choice = options[choiceIdx];
        
        appState.currentBuffer = choice;
        await interaction.update({ content: `✅ Selected: **${choice}**\nType \`next\` to confirm.`, components: [] });
    } else {
        interaction.client.activeApplications.delete(interaction.user.id);
        await interaction.update({ content: 'Application aborted.', embeds: [], components: [] });
    }
}

async function createTicketChannel(interaction, opt, answers, guildConfigs, moduleConfigs, targetUserId = null) {
    const guild = interaction.guild;
    const finalUserId = targetUserId || interaction.user.id;
    const user = await interaction.client.users.fetch(finalUserId).catch(() => interaction.user);

    let baseName = opt.ticketName.replace('{username}', user.username).replace(/[^a-zA-Z0-9-]/g, '');
    const channelName = baseName.toLowerCase().substring(0, 30);
    
    // Priority: Option Specific Category -> Global Config Category -> undefined
    const categoryId = opt.categoryId || guildConfigs?.ticketCategoryId;

    // Parse permitted roles
    let allowedRoles = [];
    if (opt.staffRoles) {
        allowedRoles = opt.staffRoles.split(',').map(r => r.trim().replace(/[^0-9]/g, '')).filter(r => guild.roles.cache.has(r));
    }

    const permissionOverwrites = [
        {
            id: guild.id,
            deny: [PermissionsBitField.Flags.ViewChannel],
        },
        {
            id: finalUserId,
            allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory],
        },
        {
            id: interaction.client.user.id,
            allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory, PermissionsBitField.Flags.ManageChannels],
        }
    ];

    allowedRoles.forEach(roleId => {
        permissionOverwrites.push({
            id: roleId,
            allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory],
        });
    });

    const ticketChannel = await guild.channels.create({
        name: channelName,
        type: ChannelType.GuildText,
        parent: categoryId || null,
        topic: user.id, // Stamping ownership permanently for quota tracking
        permissionOverwrites: permissionOverwrites
    });

    const embed = new EmbedBuilder()
        .setTitle(opt.embedTitle || 'Support Ticket')
        .setDescription(opt.embedDescription || `Welcome ${user}!`)
        .setColor('#a855f7');
        
    if (answers && answers.length > 0) {
        let qs = '';
        answers.forEach((ans, i) => {
            qs += `**Q${i+1}: ${ans.question}**\n${ans.answer}\n\n`;
        });
        embed.addFields({ name: 'Application Answers', value: qs });
    }

    let pingText = `${user}`;
    if (opt.pingRoles) {
        const pingRolesStr = opt.pingRoles.split(',').map(r => `<@&${r.trim().replace(/[^0-9]/g, '')}>`).join(' ');
        pingText += ` ${pingRolesStr}`;
    }

    const closeRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`claim_ticket_${user.id}`).setLabel('✋ Claim').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`close_ticket_${user.id}`).setLabel('🔒 Close').setStyle(ButtonStyle.Danger)
    );

    await ticketChannel.send({ content: pingText, embeds: [embed], components: [closeRow] });

    if (interaction.reply) {
        await interaction.reply({ content: `✅ Ticket opened in ${ticketChannel}`, ephemeral: true });
    }
}

module.exports = { handleTicketSelection, handleApplicationMessage, handleApplicationStartButton, createTicketChannel };
