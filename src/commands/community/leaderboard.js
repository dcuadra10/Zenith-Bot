const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getDb } = require('../../config/database');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('leaderboard')
    .setDescription('Displays the top 10 users by XP.'),
            
  async execute(interaction) {
    await interaction.deferReply();
    const db = await getDb();
    
    const topUsers = await db.all(`SELECT userId, xp, level FROM users ORDER BY level DESC, xp DESC LIMIT 10`);
    const conf = await db.get(`SELECT levelingBackground FROM module_configs WHERE guildId = ?`, [interaction.guild.id]);
    
    const path = require('path');
    const defaultBgPath = path.join(process.cwd(), 'zenith_bg - Copy.png');
    const background = conf?.levelingBackground || null;

    const { AttachmentBuilder } = require('discord.js');
    const files = [];
    let imageUrl = background;

    if (!background) {
        const attachment = new AttachmentBuilder(defaultBgPath, { name: 'leaderboard_bg.png' });
        files.push(attachment);
        imageUrl = 'attachment://leaderboard_bg.png';
    }

    const embed = new EmbedBuilder()
        .setTitle('🏆 Zenith Leaderboard')
        .setColor('#FFD700')
        .setThumbnail(interaction.guild.iconURL())
        .setImage(imageUrl)
        .setDescription(topUsers.length > 0 
            ? topUsers.map((u, i) => `**${i + 1}.** <@${u.userId}> - Level **${u.level}** (${u.xp} XP)`).join('\n')
            : 'No users found in the leaderboard.');

    interaction.editReply({ embeds: [embed], files });
  }
};
