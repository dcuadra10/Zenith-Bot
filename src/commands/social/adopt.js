const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType } = require('discord.js');
const { getDb } = require('../../config/database');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('adopt')
        .setDescription('Adopt another user into your family')
        .addUserOption(opt => opt.setName('user').setDescription('The user you want to adopt').setRequired(true)),
    async execute(interaction) {
        const target = interaction.options.getUser('user');
        const db = await getDb();

        if (target.id === interaction.user.id) return await interaction.reply({ content: '❌ You cannot adopt yourself!', ephemeral: true });
        if (target.bot) return await interaction.reply({ content: '❌ You cannot adopt bots!', ephemeral: true });

        // Check if already adopted
        const existing = await db.get(`SELECT parentId FROM social_adoptions WHERE childId = ? AND guildId = ?`, [target.id, interaction.guild.id]);
        if (existing) return await interaction.reply({ content: `❌ ${target.username} already has a family!`, ephemeral: true });

        const embed = new EmbedBuilder()
            .setTitle('🏠 Adoption Request')
            .setDescription(`<@${interaction.user.id}> wants to adopt <@${target.id}>!\n\n**${target.username}**, do you accept this family?`)
            .setColor('#60a5fa')
            .setTimestamp();

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('adopt_accept').setLabel('Accept').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId('adopt_deny').setLabel('Deny').setStyle(ButtonStyle.Danger)
        );

        const response = await interaction.reply({ content: `<@${target.id}>`, embeds: [embed], components: [row] });

        const collector = response.createMessageComponentCollector({ 
            componentType: ComponentType.Button, 
            time: 60000 
        });

        collector.on('collect', async i => {
            if (i.user.id !== target.id) return i.reply({ content: '❌ This request is not for you!', ephemeral: true });

            if (i.customId === 'adopt_accept') {
                await db.run(
                    `INSERT INTO social_adoptions (guildId, parentId, childId) VALUES (?, ?, ?)`,
                    [interaction.guild.id, interaction.user.id, target.id]
                );

                const successEmbed = new EmbedBuilder()
                    .setTitle('👨‍👩‍👧 Family Expanded!')
                    .setDescription(`<@${target.id}> has been adopted by <@${interaction.user.id}>!\n\nThe parent now receives a **+5% coin bonus**!`)
                    .setColor('#10b981')
                    .setTimestamp();

                await i.update({ embeds: [successEmbed], components: [] });
            } else {
                await i.update({ content: `❌ <@${interaction.user.id}>, your adoption request was denied.`, embeds: [], components: [] });
            }
            collector.stop();
        });

        collector.on('end', collected => {
            if (collected.size === 0) {
                interaction.editReply({ content: '⏰ Request expired.', embeds: [], components: [] });
            }
        });
    },
};
