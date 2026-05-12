const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('market-setup')
        .setDescription('Set up the Market+ panel in the current channel (Admins only).')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    async execute(interaction) {
        const embed = new EmbedBuilder()
            .setTitle('🛒 RoK Market+')
            .setDescription('Welcome to the **Official Account Market**!\n\nWhether you are looking to securely sell your account or safely purchase a new one with the help of verified Middlemen, you are in the right place.\n\nClick one of the buttons below to begin.')
            .setColor('#ffd700');

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('market_btn_sell')
                .setLabel('Sell Account')
                .setEmoji('💰')
                .setStyle(ButtonStyle.Success),
            new ButtonBuilder()
                .setCustomId('market_btn_buy')
                .setLabel('Buy Account')
                .setEmoji('🛒')
                .setStyle(ButtonStyle.Primary)
        );

        await interaction.channel.send({ embeds: [embed], components: [row] });
        await interaction.reply({ content: '✅ Market+ panel created successfully!', ephemeral: true });
    },
};
