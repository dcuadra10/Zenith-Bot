const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getDb } = require('../../config/database');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('divorce')
        .setDescription('End your current marriage'),
    async execute(interaction) {
        const db = await getDb();
        const user = await db.get(`SELECT partnerId FROM users WHERE userId = ?`, [interaction.user.id]);

        if (!user || !user.partnerId) {
            return await interaction.reply({ content: '❌ You are not married!', ephemeral: true });
        }

        const partnerId = user.partnerId;

        await db.run(`DELETE FROM social_marriages WHERE (user1Id = ? AND user2Id = ?) OR (user1Id = ? AND user2Id = ?)`, 
            [interaction.user.id, partnerId, partnerId, interaction.user.id]);
        
        await db.run(`UPDATE users SET partnerId = NULL WHERE userId = ? OR userId = ?`, [interaction.user.id, partnerId]);

        const embed = new EmbedBuilder()
            .setTitle('💔 Divorce Finalized')
            .setDescription(`You and <@${partnerId}> are no longer married. Social bonuses have been removed.`)
            .setColor('#6b7280')
            .setTimestamp();

        await interaction.reply({ embeds: [embed] });
    },
};
