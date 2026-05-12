const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, AttachmentBuilder } = require('discord.js');
const path = require('path');
const { getDb } = require('../../config/database');
const { sendBranded } = require('../../utils/brandedSender');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('setup-ads-panel')
    .setDescription('Spawns the interactive Ads Tracking panel and Leaderboard.')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    const db = await getDb();
    
    const leaderboardEmbed = new EmbedBuilder()
      .setTitle('🏆 Top Ad Publishers')
      .setColor('Gold');
      
    const topUsers = await db.all(`SELECT userId, SUM(ads) as totalAds FROM r4_tracking WHERE guildId = ? GROUP BY userId ORDER BY totalAds DESC LIMIT 10`, [interaction.guild.id]);
    
    if (!topUsers || topUsers.length === 0) {
        leaderboardEmbed.setDescription('No ads have been registered yet. Be the first!');
    } else {
        let desc = '';
        topUsers.forEach((u, i) => {
            const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : '🏅';
            desc += `${medal} **<@${u.userId}>**: ${u.totalAds} Ads\n`;
        });
        leaderboardEmbed.setDescription(desc);
    }

    const imagePath = path.join(process.cwd(), 'zenith_bg - Copy.png');
    const attachment = new AttachmentBuilder(imagePath, { name: 'zenith_bg.png' });
    leaderboardEmbed.setImage('attachment://zenith_bg.png');

    const embed = new EmbedBuilder()
      .setTitle('📊 Ad Tracking Panel')
      .setDescription('Click the **Register Ads** button below to log the number of ads you have sent. Your stats will automatically sync with our Google Sheets and global database.')
      .setColor('Blurple')
      .setFooter({ text: 'Zenith Global Tracking' });

    const row = new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId('btn_register_ads')
          .setLabel('➕ Register Ads')
          .setStyle(ButtonStyle.Primary),
      );

    const payload = { embeds: [leaderboardEmbed, embed], components: [row], files: [attachment] };
    await sendBranded(interaction.channel, payload);
    await interaction.reply({ content: 'Panel deployed successfully.', ephemeral: true });
  }
};
