const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType } = require('discord.js');
const { getDb } = require('../../config/database');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('marry')
        .setDescription('Propose marriage to another user')
        .addUserOption(opt => opt.setName('user').setDescription('The user you want to marry').setRequired(true)),
    async execute(interaction) {
        const target = interaction.options.getUser('user');
        const db = await getDb();

        if (target.id === interaction.user.id) return await interaction.reply({ content: '❌ You cannot marry yourself!', ephemeral: true });
        if (target.bot) return await interaction.reply({ content: '❌ You cannot marry bots!', ephemeral: true });

        // Check if either is already married
        const user1 = await db.get(`SELECT partnerId FROM users WHERE userId = ?`, [interaction.user.id]);
        const user2 = await db.get(`SELECT partnerId FROM users WHERE userId = ?`, [target.id]);

        if (user1 && user1.partnerId) return await interaction.reply({ content: '❌ You are already married! Divorce first.', ephemeral: true });
        if (user2 && user2.partnerId) return await interaction.reply({ content: `❌ ${target.username} is already married!`, ephemeral: true });

        const embed = new EmbedBuilder()
            .setTitle('💍 Marriage Proposal')
            .setDescription(`<@${interaction.user.id}> has proposed to <@${target.id}>!\n\n**${target.username}**, do you accept?`)
            .setColor('#f472b6')
            .setTimestamp();

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('marry_accept').setLabel('Accept').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId('marry_deny').setLabel('Deny').setStyle(ButtonStyle.Danger)
        );

        const response = await interaction.reply({ content: `<@${target.id}>`, embeds: [embed], components: [row] });

        const collector = response.createMessageComponentCollector({ 
            componentType: ComponentType.Button, 
            time: 60000 
        });

        collector.on('collect', async i => {
            if (i.user.id !== target.id) {
                return i.reply({ content: '❌ This proposal is not for you!', ephemeral: true });
            }

            if (i.customId === 'marry_accept') {
                await db.run(
                    `INSERT INTO social_marriages (guildId, user1Id, user2Id) VALUES (?, ?, ?)`,
                    [interaction.guild.id, interaction.user.id, target.id]
                );
                await db.run(`UPDATE users SET partnerId = ? WHERE userId = ?`, [target.id, interaction.user.id]);
                await db.run(`UPDATE users SET partnerId = ? WHERE userId = ?`, [interaction.user.id, target.id]);

                const successEmbed = new EmbedBuilder()
                    .setTitle('🎊 Just Married!')
                    .setDescription(`Congratulations to the new couple: <@${interaction.user.id}> and <@${target.id}>!\n\nBoth of you now receive a **+10% coin bonus** on all activities!`)
                    .setColor('#f472b6')
                    .setTimestamp();

                await i.update({ embeds: [successEmbed], components: [] });
            } else {
                await i.update({ content: `💔 <@${interaction.user.id}>, your proposal was denied.`, embeds: [], components: [] });
            }
            collector.stop();
        });

        collector.on('end', collected => {
            if (collected.size === 0) {
                interaction.editReply({ content: '⏰ Proposal expired.', embeds: [], components: [] });
            }
        });
    },
};
