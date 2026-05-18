const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getDb } = require('../../config/database');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('balance')
        .setDescription('Check your current coin balance')
        .addUserOption(option => 
            option.setName('user')
                .setDescription('The user to check balance for')
                .setRequired(false)),
    async execute(interaction) {
        const target = interaction.options.getUser('user') || interaction.user;
        const db = await getDb();
        const user = await db.get(`SELECT balance, bank, bankCapacity FROM users WHERE userId = ?`, [target.id]);
        const wallet = user ? user.balance : 0;
        const bank = user ? user.bank : 0;
        const capacity = user ? user.bankCapacity : 5000;

        const embed = new EmbedBuilder()
            .setTitle(`💰 Financial Status: ${target.username}`)
            .addFields(
                { name: '👛 Wallet (Cash)', value: `**${wallet}** 🪙`, inline: true },
                { name: '🏦 Bank (Safe)', value: `**${bank}** / ${capacity} 🪙`, inline: true }
            )
            .setColor('#10b981')
            .setThumbnail(target.displayAvatarURL())
            .setTimestamp()
            .setFooter({ text: 'Use /bank deposit to save your coins!' });

        if (interaction.replied || interaction.deferred) {
            await interaction.editReply({ embeds: [embed] });
        } else {
            await interaction.reply({ embeds: [embed] });
        }
    },
};
