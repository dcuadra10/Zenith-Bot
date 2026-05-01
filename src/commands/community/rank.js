const { SlashCommandBuilder, AttachmentBuilder } = require('discord.js');
const canvacord = require('canvacord');
const { getDb } = require('../../config/database');
const { sendBranded } = require('../../utils/brandedSender');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('rank')
    .setDescription('Displays the rank card for you or another user.')
    .addUserOption(option => 
        option.setName('user')
            .setDescription('User to view their rank.')),
            
  async execute(interaction) {
    await interaction.deferReply();
    const target = interaction.options.getUser('user') || interaction.user;
    
    if (target.bot) return interaction.editReply('Bots do not have a rank.');

    const db = await getDb();
    const userProfile = await db.get(`SELECT * FROM users WHERE userId = ?`, [target.id]);
    if (!userProfile) return interaction.editReply(`${target.username} currently has no XP.`);

    const requiredXP = 5 * (userProfile.level ** 2) + 50 * userProfile.level + 100;

    const path = require('path');
    const imagePath = path.join(process.cwd(), 'zenith_bg - Copy.png');

    canvacord.Font.loadDefault();
    const rank = new canvacord.RankCardBuilder()
        .setBackground(imagePath)
        .setAvatar(target.displayAvatarURL({ forceStatic: true, extension: 'png' }))
        .setCurrentXP(userProfile.xp)
        .setRequiredXP(requiredXP)
        .setStatus(interaction.guild.members.cache.get(target.id)?.presence?.status || 'offline')
        .setUsername(target.username)
        .setDisplayName(target.globalName || target.username)
        .setLevel(userProfile.level)
        .setRank(0);

    rank.build()
        .then(async data => {
            const attachment = new AttachmentBuilder(data, { name: 'rank.png' });
            const payload = { files: [attachment] };
            
            // Check if branding is configured
            const { getBranding } = require('../../utils/brandedSender');
            const branding = await getBranding(interaction.guild.id);
            
            if (branding.brandingName || branding.brandingAvatar) {
                // If branded, delete the interaction reply (placeholder) and send via webhook
                await interaction.editReply({ content: 'Rank card generated!', embeds: [], components: [] });
                await sendBranded(interaction.channel, payload);
                // Optionally delete the "Rank card generated" message after a bit
                setTimeout(() => interaction.deleteReply().catch(() => {}), 3000);
            } else {
                // Normal interaction reply
                interaction.editReply(payload);
            }
        })
        .catch(err => {
            console.error(err);
            interaction.editReply('There was an error building your rank card.');
        });
  }
};
