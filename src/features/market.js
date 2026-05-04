const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, PermissionsBitField, ComponentType } = require('discord.js');
const { getDb } = require('../config/database');
const crypto = require('crypto');

async function handleMarketInteraction(interaction) {
    if (!interaction.isButton()) return;
    
    if (interaction.customId === 'market_btn_sell') {
        await handleMarketSellInit(interaction);
    } else if (interaction.customId === 'market_btn_buy') {
        await handleMarketBuyInit(interaction);
    } else if (interaction.customId.startsWith('market_approve_')) {
        await handleMarketApprove(interaction);
    } else if (interaction.customId.startsWith('market_reject_')) {
        await handleMarketReject(interaction);
    } else if (interaction.customId.startsWith('market_buyoffer_')) {
        await handleMarketSendOffer(interaction);
    } else if (interaction.customId.startsWith('market_acceptoffer_')) {
        await handleMarketAcceptOffer(interaction);
    } else if (interaction.customId.startsWith('market_fee_paid_')) {
        await handleMarketFeeConfirmed(interaction);
    } else if (interaction.customId.startsWith('market_complete_')) {
        await handleMarketComplete(interaction);
    }
}

async function handleMarketSellInit(interaction) {
    const db = await getDb();
    const config = await db.get(`SELECT * FROM market_configs WHERE guildId = ?`, [interaction.guildId]);
    
    if (!config || !config.marketEnabled) {
        return interaction.reply({ content: '❌ The Market+ system is currently disabled.', ephemeral: true });
    }

    await interaction.reply({ content: '⏳ Creating your listing ticket...', ephemeral: true });

    const guild = interaction.guild;
    const channelName = `sell-${interaction.user.username}`.toLowerCase().substring(0, 30);
    
    const ticketChannel = await guild.channels.create({
        name: channelName,
        type: ChannelType.GuildText,
        permissionOverwrites: [
            { id: guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
            { id: interaction.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] },
            { id: interaction.client.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory, PermissionsBitField.Flags.ManageChannels] }
        ]
    });

    await interaction.editReply({ content: `✅ Ticket created: ${ticketChannel}` });
    
    // Start the conversational flow
    startSellFlow(ticketChannel, interaction.user, config, guild);
}

const DEFAULT_SELL_QUESTIONS = [
    { key: 'price', prompt: '💰 **1. What is the Price of the account?**\n*(e.g. 1000$)*' },
    { key: 'power', prompt: '<:power:1497402340892868618> **2. What is the Power?**\n*(e.g. 100m)*' },
    { key: 'kp', prompt: '<:kp:1497402419665961001> **3. What are the Kill Points?**\n*(e.g. 30b)*' },
    { key: 'deaths', prompt: '<:deaths:1497402636083662981> **4. What are the Deaths?**\n*(e.g. 30m)*' },
    { key: 'vip', prompt: '<:VIP:1497401764717002924> **5. What is the VIP Level?**\n*(e.g. SVIP, VIP 17)*' },
    { key: 'gems', prompt: '<:gem1:1497401988651159573> **6. How many Gems?**\n*(e.g. 50k)*' },
    { key: 'skins', prompt: '<:skin:1497410065492086965> **7. How many Legendary City Skins?**\n*(e.g. 5)*' },
    { key: 'equipment', prompt: '<:equip:1497405923189194863> **8. How many Legendary Equipment pieces?**\n*(e.g. 10)*' },
    { key: 'passports', prompt: '<:passport:1495891858717671454> **9. How many Passports?**\n*(e.g. 100)*' },
    { key: 'goldHeads', prompt: '<:gh:1497401912142729257> **10. How many Gold Heads?**\n*(e.g. 100)*' },
    { key: 'commanders', prompt: '<:commander:1497711538906337451> **11. How many Expertise Legendary Commanders?**\n*(e.g. 10)*' },
    { key: 'food', prompt: '<:food:1497402253814796480> **12. Food?**\n*(e.g. 10b bag/100b city)*' },
    { key: 'wood', prompt: '<:wood:1497402184629878804> **13. Wood?**\n*(e.g. 2b bag/20b city)*' },
    { key: 'stone', prompt: '<:stone:1497402113393819792> **14. Stone?**\n*(e.g. 2b bag/20b city)*' },
    { key: 'gold', prompt: '<:gold:1497401842823598151> **15. Gold?**\n*(e.g. 2b)*' },
    { key: 'unispeed', prompt: '<:unispeed:1497406105007952022> **16. Universal Speedups?**\n*(e.g. 1000 days)*' },
    { key: 'healspeed', prompt: '<:healspeed:1497406233534140586> **17. Healing Speedups?**\n*(e.g. 300 days)*' },
    { key: 'trainspeed', prompt: '<:trainspeed:1497406047797776524> **18. Training Speedups?**\n*(e.g. 200 days)*' },
    { key: 'age', prompt: '<:days:1497712897181089802> **19. Account Age in days?**\n*(e.g. 1000 days)*' },
    { key: 'migrate', prompt: '✈️ **20. Is the account ready to migrate?**\n*(Yes / No)*' },
    { key: 'kvk', prompt: '⚔️ **21. Which KvK is it in?**\n*(1, 2, 3, or SOC)*' },
    { key: 'notes', prompt: '<:notes:1500635402820780232> **22. Any additional notes?**\n*(e.g. N/A or details about farms)*' },
    { key: 'images', prompt: '📸 **23. Please upload screenshots proving this information.**\n*(Upload all images in a single message, then wait).*', isImage: true }
];

async function startSellFlow(channel, user, config, guild) {
    let questions = DEFAULT_SELL_QUESTIONS;
    if (config && config.marketQuestions) {
        try {
            const custom = JSON.parse(config.marketQuestions);
            if (Array.isArray(custom) && custom.length > 0) {
                questions = custom;
            }
        } catch (e) {}
    }

    const answers = {};
    const images = [];

    const askQuestion = async (index) => {
        if (index >= questions.length) {
            return finishSellFlow(channel, user, guild, answers, images, config);
        }

        const q = questions[index];
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('market_nav_back')
                .setLabel('⬅️ Back')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(index === 0),
            new ButtonBuilder()
                .setCustomId('market_nav_next')
                .setLabel('Next ➡️')
                .setStyle(ButtonStyle.Primary)
        );

        const getCurrentAnswerText = () => {
            if (q.isImage) return images.length > 0 ? `✅ ${images.length} images uploaded.` : '❌ No images uploaded yet. Please send them here.';
            return answers[q.key] ? `✅ ${answers[q.key]}` : '❌ Not answered yet. Type your answer below.';
        };

        const embed = new EmbedBuilder()
            .setTitle(`Question ${index + 1} of ${questions.length}`)
            .setDescription(`${q.prompt}\n\n**Your Current Answer:**\n${getCurrentAnswerText()}`)
            .setColor('#ffd700');

        const promptMsg = await channel.send({ content: `${user}`, embeds: [embed], components: [row] });

        const filter = m => m.author.id === user.id;
        const msgCollector = channel.createMessageCollector({ filter, time: 300000 });
        
        const btnFilter = i => i.user.id === user.id && (i.customId === 'market_nav_back' || i.customId === 'market_nav_next');
        const btnCollector = promptMsg.createMessageComponentCollector({ filter: btnFilter, time: 300000 });

        let advanced = false;

        btnCollector.on('collect', async i => {
            await i.deferUpdate().catch(()=>null);
            if (i.customId === 'market_nav_back') {
                advanced = true;
                msgCollector.stop();
                btnCollector.stop();
                await promptMsg.delete().catch(()=>null);
                askQuestion(index - 1);
            } else if (i.customId === 'market_nav_next') {
                if (!q.isImage && !answers[q.key]) {
                    channel.send('⚠️ You must provide an answer before clicking Next!').then(m => setTimeout(()=>m.delete(), 3000));
                } else if (q.isImage && images.length === 0) {
                    channel.send('⚠️ You must upload at least one image before clicking Next!').then(m => setTimeout(()=>m.delete(), 3000));
                } else {
                    advanced = true;
                    msgCollector.stop();
                    btnCollector.stop();
                    await promptMsg.delete().catch(()=>null);
                    askQuestion(index + 1);
                }
            }
        });

        msgCollector.on('collect', async msg => {
            if (q.isImage) {
                if (msg.attachments.size > 0) {
                    msg.attachments.forEach(att => images.push(att.url));
                }
            } else {
                answers[q.key] = msg.content;
            }
            
            embed.setDescription(`${q.prompt}\n\n**Your Current Answer:**\n${getCurrentAnswerText()}`);
            await promptMsg.edit({ embeds: [embed], components: [row] }).catch(()=>null);
            await msg.delete().catch(()=>null);
        });

        msgCollector.on('end', (collected, reason) => {
            if (reason === 'time' && !advanced) {
                channel.send('❌ You took too long to answer. This ticket will now be closed.');
                setTimeout(() => channel.delete().catch(()=>null), 5000);
            }
        });
    };

    askQuestion(0);
}

async function finishSellFlow(channel, user, guild, answers, images, config) {
    await channel.send('⏳ Processing your listing. Submitting to administrators for approval...');

    const db = await getDb();
    const code = `#ROK-${crypto.randomInt(10000, 99999)}`;
    
    await db.run(
        `INSERT INTO market_listings (code, guildId, sellerId, status, price, dataJson, imagesJson) VALUES (?, ?, ?, 'pending', ?, ?, ?)`,
        [code, guild.id, user.id, answers.price, JSON.stringify(answers), JSON.stringify(images)]
    );

    if (config.approvalChannelId) {
        const approvalChannel = guild.channels.cache.get(config.approvalChannelId);
        if (approvalChannel) {
            let adminDesc = `**Seller:** ${user}\n`;
            for (const [k, v] of Object.entries(answers)) {
                if (v && v.toString().length > 0) {
                    adminDesc += `**${k.toUpperCase()}:** ${v}\n`;
                }
            }

            const adminEmbed = new EmbedBuilder()
                .setTitle(`📥 New Account Listing Approval: ${code}`)
                .setDescription(adminDesc.substring(0, 4000)) // Discord limit safety
                .setColor('#e67e22');
            
            if (images.length > 0) adminEmbed.setImage(images[0]);

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`market_approve_${code}`).setLabel('Approve').setStyle(ButtonStyle.Success),
                new ButtonBuilder().setCustomId(`market_reject_${code}`).setLabel('Reject').setStyle(ButtonStyle.Danger)
            );

            await approvalChannel.send({ embeds: [adminEmbed], components: [row] });
        }
    }

    await channel.send(`✅ Your listing **${code}** has been sent to the admins for approval. This ticket will now close.`);
    setTimeout(() => channel.delete().catch(()=>null), 10000);
}

async function handleMarketApprove(interaction) {
    const code = interaction.customId.replace('market_approve_', '');
    const db = await getDb();
    
    const listing = await db.get(`SELECT * FROM market_listings WHERE code = ?`, [code]);
    if (!listing) return interaction.reply({ content: '❌ Listing not found.', ephemeral: true });
    
    if (listing.status !== 'pending') return interaction.reply({ content: '❌ Listing is no longer pending.', ephemeral: true });
    
    const config = await db.get(`SELECT * FROM market_configs WHERE guildId = ?`, [interaction.guildId]);
    if (!config) return interaction.reply({ content: '❌ Market configuration not found.', ephemeral: true });

    const data = JSON.parse(listing.dataJson);
    const images = JSON.parse(listing.imagesJson);
    const numericPrice = parseFloat(data.price?.toString().replace(/[^0-9.]/g, '')) || 0;

    // Determine correct forum channel
    let targetChannelId = null;
    if (config.forumChannelId && config.forumChannelId.startsWith('[')) {
        try {
            const channels = JSON.parse(config.forumChannelId);
            const match = channels.find(c => numericPrice >= c.min && numericPrice <= c.max);
            if (match) targetChannelId = match.channelId;
        } catch(e) {}
    } else {
        targetChannelId = config.forumChannelId;
    }

    if (!targetChannelId) return interaction.reply({ content: '❌ No matching forum channel found for this price range.', ephemeral: true });

    const forumChannel = interaction.guild.channels.cache.get(targetChannelId);
    if (!forumChannel || forumChannel.type !== ChannelType.GuildForum) return interaction.reply({ content: '❌ Invalid or missing forum channel.', ephemeral: true });

    // Handle Tags
    const appliedTags = [];
    if (forumChannel.availableTags) {
        // Migration Tag
        if (data.migrate && data.migrate.toLowerCase().includes('yes')) {
            const migTag = forumChannel.availableTags.find(t => t.name.toLowerCase().includes('migrate') || t.name.toLowerCase().includes('ready'));
            if (migTag) appliedTags.push(migTag.id);
        }
        // KvK Tag
        if (data.kvk) {
            const kvkInput = data.kvk.toLowerCase();
            let kvkSearch = '';
            if (kvkInput.includes('soc')) kvkSearch = 'soc';
            else if (kvkInput.includes('1')) kvkSearch = 'kvk 1';
            else if (kvkInput.includes('2')) kvkSearch = 'kvk 2';
            else if (kvkInput.includes('3')) kvkSearch = 'kvk 3';
            
            if (kvkSearch) {
                const kvkTag = forumChannel.availableTags.find(t => t.name.toLowerCase().includes(kvkSearch));
                if (kvkTag) appliedTags.push(kvkTag.id);
            }
        }
    }

    // Build the requested forum post text
    let text = `# SVIP Account
> ${data.price || 'N/A'}$

<:power:1497402340892868618> **Power:** ${data.power || 'N/A'}
<:kp:1497402419665961001> **Kill Points:** ${data.kp || 'N/A'}
<:deaths:1497402636083662981> **Deaths:** ${data.deaths || 'N/A'}
<:VIP:1497401764717002924> **VIP:** ${data.vip || 'N/A'}
<:gem1:1497401988651159573> **Gems:** ${data.gems || 'N/A'}
<:skin:1497410065492086965> **Legendary City Skins:** ${data.skins || 'N/A'}
<:equip:1497405923189194863> **Equipment:** ${data.equipment || 'N/A'}
<:passport:1495891858717671454> **Passports:** ${data.passports || 'N/A'}
<:gh:1497401912142729257> **Gold Heads:** ${data.goldHeads || 'N/A'}
<:commander:1497711538906337451> **Expertise Legendary Commanders:** ${data.commanders || 'N/A'}

Resources:
> <:food:1497402253814796480> ${data.food || 'N/A'}
> <:wood:1497402184629878804> ${data.wood || 'N/A'}
> <:stone:1497402113393819792> ${data.stone || 'N/A'}
> <:gold:1497401842823598151> ${data.gold || 'N/A'}

Speedups:
> <:unispeed:1497406105007952022> ${data.unispeed || 'N/A'}
> <:healspeed:1497406233534140586> ${data.healspeed || 'N/A'}
> <:trainspeed:1497406047797776524> ${data.trainspeed || 'N/A'}

✈️ **Ready to Migrate:** ${data.migrate || 'N/A'}
⚔️ **KvK Stage:** ${data.kvk || 'N/A'}
<:days:1497712897181089802> **Account Age:** ${data.age || 'N/A'} <:notes:1500635402820780232> **Notes:** ${data.notes || 'N/A'}

> **Code:** ${code}`;

    // Append any extra keys dynamically
    const defaultKeys = ['price','power','kp','deaths','vip','gems','skins','equipment','formations','passports','goldHeads','commanders','food','wood','stone','gold','unispeed','healspeed','trainspeed','age','notes','images','migrate','kvk'];
    let extras = '';
    for (const [k, v] of Object.entries(data)) {
        if (!defaultKeys.includes(k)) extras += `\n**${k.toUpperCase()}:** ${v}`;
    }
    if (extras) text += `\n\n--- **Extra Details** ---${extras}`;

    const messagePayload = { content: text };
    if (images.length > 0) messagePayload.files = images;

    try {
        const thread = await forumChannel.threads.create({
            name: `${data.power} Power | ${data.price}$`,
            message: messagePayload,
            appliedTags: appliedTags,
            autoArchiveDuration: 10080
        });

        await db.run(`UPDATE market_listings SET status = 'active', forumThreadId = ? WHERE code = ?`, [thread.id, code]);
        
        await interaction.update({ content: `✅ Approved! Forum post created: <#${thread.id}>`, embeds: [], components: [] });

        // Notify seller
        const seller = await interaction.client.users.fetch(listing.sellerId).catch(()=>null);
        if (seller) seller.send(`✅ Your market listing **${code}** has been approved and is now live! <#${thread.id}>`).catch(()=>null);
        
    } catch (err) {
        console.error(err);
        return interaction.reply({ content: '❌ Failed to create forum post.', ephemeral: true });
    }
}

async function handleMarketReject(interaction) {
    const code = interaction.customId.replace('market_reject_', '');
    const { ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
    
    const modal = new ModalBuilder()
        .setCustomId(`modal_market_reject_${code}`)
        .setTitle(`Reject Listing ${code}`);

    const reasonInput = new TextInputBuilder()
        .setCustomId('rejectReason')
        .setLabel('Reason for rejection')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true);

    modal.addComponents(new ActionRowBuilder().addComponents(reasonInput));
    await interaction.showModal(modal);
}

// Ensure the module exports the interaction handler
async function handleMarketInteraction(interaction) {
    if (interaction.isButton()) {
        if (interaction.customId === 'market_btn_sell') {
            await handleMarketSellInit(interaction);
        } else if (interaction.customId === 'market_btn_buy') {
            await handleMarketBuyInit(interaction);
        } else if (interaction.customId.startsWith('market_approve_')) {
            await handleMarketApprove(interaction);
        } else if (interaction.customId.startsWith('market_reject_')) {
            await handleMarketReject(interaction);
        } else if (interaction.customId.startsWith('market_buyoffer_')) {
            await handleMarketSendOffer(interaction);
        } else if (interaction.customId.startsWith('market_acceptoffer_')) {
            await handleMarketAcceptOffer(interaction);
        } else if (interaction.customId.startsWith('market_declineoffer_')) {
            await handleMarketDeclineOffer(interaction);
        } else if (interaction.customId.startsWith('market_feepaid_')) {
            await handleMarketFeeConfirmed(interaction);
        } else if (interaction.customId.startsWith('market_complete_')) {
            await handleMarketComplete(interaction);
        }
    } else if (interaction.isModalSubmit()) {
        if (interaction.customId.startsWith('modal_market_offer_')) {
            await handleMarketOfferSubmit(interaction);
        } else if (interaction.customId.startsWith('modal_market_accept_')) {
            await handleMarketAcceptSubmit(interaction);
        }
    }
}

async function handleMarketBuyInit(interaction) {
    const db = await getDb();
    const config = await db.get(`SELECT * FROM market_configs WHERE guildId = ?`, [interaction.guildId]);
    if (!config || !config.marketEnabled) return interaction.reply({ content: '❌ Market+ is disabled.', ephemeral: true });

    await interaction.reply({ content: '⏳ Creating your purchase ticket...', ephemeral: true });
    
    const guild = interaction.guild;
    const channelName = `buy-${interaction.user.username}`.toLowerCase().substring(0, 30);
    
    const ticketChannel = await guild.channels.create({
        name: channelName,
        type: ChannelType.GuildText,
        permissionOverwrites: [
            { id: guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
            { id: interaction.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] },
            { id: interaction.client.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory, PermissionsBitField.Flags.ManageChannels] }
        ]
    });

    await interaction.editReply({ content: `✅ Ticket created: ${ticketChannel}` });
    startBuyFlow(ticketChannel, interaction.user, config, guild);
}

async function startBuyFlow(channel, user, config, guild) {
    await channel.send(`${user} Welcome! Please enter the **Account Code** you wish to purchase (e.g. #ROK-12345):`);
    
    const filter = m => m.author.id === user.id;
    let codeMsg;
    try {
        const collected = await channel.awaitMessages({ filter, max: 1, time: 60000, errors: ['time'] });
        codeMsg = collected.first();
    } catch (e) {
        return channel.send('❌ You took too long. Ticket closing...').then(() => setTimeout(()=>channel.delete().catch(()=>null), 5000));
    }

    const db = await getDb();
    const code = codeMsg.content.trim().toUpperCase();
    const listing = await db.get(`SELECT * FROM market_listings WHERE code = ? AND status = 'active'`, [code]);

    if (!listing) {
        return channel.send('❌ Invalid code or listing is not active. Please open a new ticket.').then(() => setTimeout(()=>channel.delete().catch(()=>null), 10000));
    }

    const data = JSON.parse(listing.dataJson);
    const images = JSON.parse(listing.imagesJson);

    const embed = new EmbedBuilder()
        .setTitle(`Account Listing: ${code}`)
        .setDescription(`**Price:** ${data.price}\n**Power:** ${data.power}\n**Kill Points:** ${data.kp}\n**VIP:** ${data.vip}`)
        .setColor('#3498db');
    if (images.length > 0) embed.setImage(images[0]);

    await channel.send({ embeds: [embed] });

    await channel.send('Do you have a preferred Middleman? Mention them, or type `random` to assign one randomly.');
    let mmMsg;
    try {
        const collected = await channel.awaitMessages({ filter, max: 1, time: 60000, errors: ['time'] });
        mmMsg = collected.first();
    } catch (e) {
        return channel.send('❌ You took too long. Ticket closing...').then(() => setTimeout(()=>channel.delete().catch(()=>null), 5000));
    }

    let middlemanId = null;
    const mmRoleStr = config.middlemanRole || '';
    let mmList = [];
    if (mmRoleStr) {
        try {
            await guild.members.fetch();
            mmList = guild.members.cache.filter(m => m.roles.cache.has(mmRoleStr)).map(m => m.id);
        } catch (err) {}
    }

    const userInput = mmMsg.content.toLowerCase();
    const mentioned = mmMsg.mentions.users.first();

    if (mentioned) {
        middlemanId = mentioned.id;
    } else if (userInput === 'random' && mmList.length > 0) {
        middlemanId = mmList[Math.floor(Math.random() * mmList.length)];
    } else if (mmList.length > 0) {
        middlemanId = mmList[0]; // fallback
    }

    if (middlemanId) {
        await channel.permissionOverwrites.edit(middlemanId, { ViewChannel: true, SendMessages: true, ReadMessageHistory: true });
        await channel.send(`✅ Middleman assigned: <@${middlemanId}>`);
    } else {
        await channel.send(`⚠️ Could not assign an official middleman automatically. Staff will assist shortly.`);
    }

    // Initialize transaction in DB
    const txId = `TX-${crypto.randomInt(10000, 99999)}`;
    await db.run(
        `INSERT INTO market_transactions (id, listingCode, guildId, buyerId, sellerId, middlemanId) VALUES (?, ?, ?, ?, ?, ?)`,
        [txId, code, guild.id, user.id, listing.sellerId, middlemanId || 'pending']
    );

    const mmEmbed = new EmbedBuilder()
        .setTitle('🤝 Middleman Panel')
        .setDescription('Middleman: Please discuss with the buyer and then send the official offer to the seller.')
        .setColor('#9b59b6');

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`market_buyoffer_${txId}`).setLabel('Send Offer to Seller').setStyle(ButtonStyle.Primary)
    );

    await channel.send({ content: `<@${middlemanId || ''}>`, embeds: [mmEmbed], components: [row] });
}

async function handleMarketSendOffer(interaction) {
    const txId = interaction.customId.replace('market_buyoffer_', '');
    const { ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
    
    const modal = new ModalBuilder()
        .setCustomId(`modal_market_offer_${txId}`)
        .setTitle(`Send Offer to Seller`);

    const offerInput = new TextInputBuilder()
        .setCustomId('offerPrice')
        .setLabel('Final Agreed Price (e.g. 950$)')
        .setStyle(TextInputStyle.Short)
        .setRequired(true);

    modal.addComponents(new ActionRowBuilder().addComponents(offerInput));
    await interaction.showModal(modal);
}

async function handleMarketOfferSubmit(interaction) {
    const txId = interaction.customId.replace('modal_market_offer_', '');
    const price = interaction.fields.getTextInputValue('offerPrice');
    const db = await getDb();
    
    await db.run(`UPDATE market_transactions SET price = ?, status = 'offer_sent' WHERE id = ?`, [price, txId]);
    const tx = await db.get(`SELECT * FROM market_transactions WHERE id = ?`, [txId]);
    const config = await db.get(`SELECT * FROM market_configs WHERE guildId = ?`, [tx.guildId]);

    await interaction.reply({ content: `✅ Offer of **${price}** has been sent to the seller via DM. Awaiting their response.`, ephemeral: false });

    // Calculate Fees
    const mmFeePct = config.middlemanFeePct || 5;
    let numericPrice = parseFloat(price.replace(/[^0-9.]/g, '')) || 0;
    const mmFeeAmount = (numericPrice * (mmFeePct / 100)).toFixed(2);
    const totalBuyerPays = (numericPrice + parseFloat(mmFeeAmount)).toFixed(2);

    // Find Middleman Specific Payment Info
    let mmPaymentDetails = 'Please ask the Middleman for their payment details.';
    if (config.mmPaymentMethods) {
        try {
            const mmPayments = JSON.parse(config.mmPaymentMethods);
            const match = mmPayments.find(p => p.userId === tx.middlemanId);
            if (match && match.details) mmPaymentDetails = match.details;
        } catch(e) {}
    }

    await interaction.channel.send({
        content: `📝 **Purchase Summary for Buyer:**\n- Agreed Price: **${price}**\n- Middleman Fee (${mmFeePct}%): **$${mmFeeAmount}**\n- **Total to pay:** **$${totalBuyerPays}**\n\n**Middleman Payment Methods:**\n${mmPaymentDetails}\n\n*Buyer pays the Middleman Fee separately.*`
    });

    // DM the seller
    const seller = await interaction.client.users.fetch(tx.sellerId).catch(()=>null);
    if (seller) {
        const marketFeePct = config.marketFeePct || 5;
        const sellerMarketFee = (numericPrice * (marketFeePct / 100)).toFixed(2);
        const netToSeller = (numericPrice - parseFloat(sellerMarketFee)).toFixed(2);

        const embed = new EmbedBuilder()
            .setTitle(`💰 New Offer for your Account ${tx.listingCode}`)
            .setDescription(`A buyer, represented by Middleman <@${interaction.user.id}>, has sent you an offer.\n\n**Offer Amount:** ${price}\n\n**Note on Fees:**\n- Market Fee (${marketFeePct}%): -$${sellerMarketFee}\n- **Net amount you receive:** **$${netToSeller}**\n\nDo you accept this offer?`)
            .setColor('#2ecc71');
        
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`market_acceptoffer_${txId}`).setLabel('Accept').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId(`market_declineoffer_${txId}`).setLabel('Decline').setStyle(ButtonStyle.Danger)
        );

        await seller.send({ embeds: [embed], components: [row] }).catch(()=>null);
    }
}

async function handleMarketAcceptOffer(interaction) {
    const txId = interaction.customId.replace('market_acceptoffer_', '');
    const db = await getDb();
    const tx = await db.get(`SELECT * FROM market_transactions WHERE id = ?`, [txId]);
    if (!tx || tx.status !== 'offer_sent') return interaction.reply({ content: '❌ Invalid or expired transaction.', ephemeral: true });

    const { ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
    
    const modal = new ModalBuilder()
        .setCustomId(`modal_market_accept_${txId}`)
        .setTitle(`Accept Offer & Provide Credentials`);

    const emailInput = new TextInputBuilder()
        .setCustomId('accEmail')
        .setLabel('Account Email / Username')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('example@gmail.com')
        .setRequired(true);

    const passInput = new TextInputBuilder()
        .setCustomId('accPass')
        .setLabel('Email Password')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('Your password here')
        .setRequired(true);

    const providerInput = new TextInputBuilder()
        .setCustomId('accProvider')
        .setLabel('Email Provider')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('Gmail, Outlook, Yahoo, etc.')
        .setRequired(true);

    modal.addComponents(
        new ActionRowBuilder().addComponents(emailInput),
        new ActionRowBuilder().addComponents(passInput),
        new ActionRowBuilder().addComponents(providerInput)
    );

    await interaction.showModal(modal);
}

async function handleMarketAcceptSubmit(interaction) {
    const txId = interaction.customId.replace('modal_market_accept_', '');
    const email = interaction.fields.getTextInputValue('accEmail');
    const pass = interaction.fields.getTextInputValue('accPass');
    const provider = interaction.fields.getTextInputValue('accProvider');

    const db = await getDb();
    const tx = await db.get(`SELECT * FROM market_transactions WHERE id = ?`, [txId]);
    if (!tx) return interaction.reply({ content: '❌ Transaction not found.', ephemeral: true });

    const credentials = { email, pass, provider };
    await db.run(`UPDATE market_transactions SET status = 'fee_pending', offerJson = ? WHERE id = ?`, [JSON.stringify(credentials), txId]);
    
    const config = await db.get(`SELECT * FROM market_configs WHERE guildId = ?`, [tx.guildId]);
    const feePct = config.marketFeePct || 5;
    
    let numericPrice = parseFloat(tx.price.replace(/[^0-9.]/g, ''));
    if (isNaN(numericPrice)) numericPrice = 0;
    const feeAmount = (numericPrice * (feePct / 100)).toFixed(2);

    await interaction.reply({ 
        content: `✅ You have accepted the offer and provided the credentials.\n\n**Next Step:** You must pay the Market Fee of **${feePct}%** ($${feeAmount}) to the **Market Owner** before the Middleman proceeds.\n\n**Owner Payment Methods:**\n${config.paymentMethods || 'Please ask the Middleman for the owner\'s payment details.'}\n\nOnce paid, the Market Owner will verify it.`, 
        ephemeral: true 
    });

    // Notify Owner Channel (as before)
    if (config.ownerChannelId) {
        const ownerChannel = interaction.client.channels.cache.get(config.ownerChannelId);
        if (ownerChannel) {
            const embed = new EmbedBuilder()
                .setTitle(`💸 Fee Payment Pending: ${tx.listingCode}`)
                .setDescription(`**Transaction:** ${txId}\n**Seller:** <@${tx.sellerId}>\n**Expected Fee:** $${feeAmount} (${feePct}% of ${tx.price})\n\nClick below when you have successfully received the funds.`)
                .setColor('#f1c40f');
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`market_feepaid_${txId}`).setLabel('Confirm Fee Received').setStyle(ButtonStyle.Success)
            );
            await ownerChannel.send({ embeds: [embed], components: [row] });
        }
    }
}

async function handleMarketDeclineOffer(interaction) {
    const txId = interaction.customId.replace('market_declineoffer_', '');
    const db = await getDb();
    await db.run(`UPDATE market_transactions SET status = 'declined' WHERE id = ?`, [txId]);
    await interaction.update({ content: '❌ You declined the offer.', embeds: [], components: [] });
}

async function handleMarketFeeConfirmed(interaction) {
    const txId = interaction.customId.replace('market_feepaid_', '');
    const db = await getDb();
    await db.run(`UPDATE market_transactions SET status = 'fee_paid' WHERE id = ?`, [txId]);

    await interaction.update({ content: `✅ Fee confirmed for TX ${txId}. The Middleman has been notified to proceed.`, embeds: [], components: [] });

    const tx = await db.get(`SELECT * FROM market_transactions WHERE id = ?`, [txId]);
    let credsText = '';
    if (tx.offerJson) {
        try {
            const creds = JSON.parse(tx.offerJson);
            credsText = `\n\n🔐 **Seller Credentials:**\n- **Email/User:** ${creds.email}\n- **Password:** ${creds.pass}\n- **Provider:** ${creds.provider}`;
        } catch(e) {}
    }
    
    const mm = await interaction.client.users.fetch(tx.middlemanId).catch(()=>null);
    if (mm) {
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`market_complete_${txId}`).setLabel('Complete Transaction').setStyle(ButtonStyle.Success)
        );
        await mm.send({ 
            content: `✅ The **Market Fee** for TX ${txId} (${tx.listingCode}) has been confirmed by the owner!${credsText}\n\n**Middleman Instructions:**\n1. Verify the account credentials provided above.\n2. Receive the funds from the Buyer.\n3. Release account to Buyer and funds to Seller.\n\nOnce absolutely finished, click below:`,
            components: [row]
        }).catch(()=>null);
    }
}

async function handleMarketComplete(interaction) {
    const txId = interaction.customId.replace('market_complete_', '');
    const db = await getDb();
    const tx = await db.get(`SELECT * FROM market_transactions WHERE id = ?`, [txId]);
    if (!tx || tx.status !== 'fee_paid') return interaction.reply({ content: '❌ Invalid transaction state.', ephemeral: true });

    await db.run(`UPDATE market_transactions SET status = 'completed' WHERE id = ?`, [txId]);
    await db.run(`UPDATE market_listings SET status = 'sold' WHERE code = ?`, [tx.listingCode]);

    await interaction.update({ content: '✅ Transaction officially marked as COMPLETED. Good job!', embeds: [], components: [] });

    const listing = await db.get(`SELECT * FROM market_listings WHERE code = ?`, [tx.listingCode]);
    if (listing && listing.forumThreadId) {
        const guild = interaction.client.guilds.cache.get(tx.guildId);
        if (guild) {
            const thread = guild.channels.cache.get(listing.forumThreadId);
            if (thread) {
                await thread.send('🔒 This account has been successfully SOLD via the Market+ Middleman system.');
                await thread.setLocked(true).catch(()=>null);
                await thread.setArchived(true).catch(()=>null);
            }
        }
    }
}

module.exports = { handleMarketInteraction };
