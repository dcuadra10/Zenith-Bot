const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('help')
        .setDescription('Complete Guide to Zenith City & Bot Systems'),
    
    async execute(interaction) {
        const embed = new EmbedBuilder()
            .setTitle('Zenith City — Master Guide')
            .setDescription('Welcome to the Zenith experience. Use the menu below to explore bot systems.')
            .setThumbnail(interaction.client.user.displayAvatarURL())
            .addFields(
                { name: 'Mafia & Basic Economy', value: 'Jobs, salaries, criminality, and the city legal system.\n*Category: Mafia & Economy*' },
                { name: 'Social & Relationships', value: 'Marriage, families, and social status.\n*Category: Social*' },
                { name: 'Stats & Rankings', value: 'Track your progress and compete for the top spot.\n*Category: Community*' },
                { name: 'Management & Utility', value: 'Tools for staff and kingdom administration.\n*Category: Staff*' }
            )
            .setColor('#111827')
            .setFooter({ text: 'Zenith Bot • Master Guide' })
            .setTimestamp();

        const menu = new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
                .setCustomId('help_category')
                .setPlaceholder('Select a category to see commands...')
                .addOptions([
                    { label: 'Mafia & Economy', description: 'Heists, Businesses, Jail, and Market', value: 'help_mafia', emoji: '🌑' },
                    { label: 'Social & Family', description: 'Marriage, Divorce, and Adoption', value: 'help_social', emoji: '💍' },
                    { label: 'Community & Stats', description: 'Leaderboard, Rank, and Balance', value: 'help_community', emoji: '📊' },
                    { label: 'Staff & Admin', description: 'Ads Panel, Activity, and Setup', value: 'help_staff', emoji: '⚙️' }
                ])
        );

        return await interaction.editReply({ embeds: [embed], components: [menu] });
    }
};
