const { SlashCommandBuilder, EmbedBuilder, AttachmentBuilder } = require('discord.js');
const { getDb } = require('../../config/database');
const { generateFamilyTree } = require('../../utils/imageGenerator');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('family')
        .setDescription('View your family lineage and visual tree'),
    async execute(interaction) {
        const db = await getDb();
        const user = await db.get(`SELECT partnerId FROM users WHERE userId = ?`, [interaction.user.id]);
        const childrenRecs = await db.all(`SELECT childId FROM social_adoptions WHERE parentId = ? AND guildId = ?`, [interaction.user.id, interaction.guild.id]);
        const parentRec = await db.get(`SELECT parentId FROM social_adoptions WHERE childId = ? AND guildId = ?`, [interaction.user.id, interaction.guild.id]);

        const mainUser = {
            username: interaction.user.username,
            avatarUrl: interaction.user.displayAvatarURL({ extension: 'png' })
        };

        const familyData = {};

        // Fetch Spouse
        if (user && user.partnerId) {
            const spouse = await interaction.client.users.fetch(user.partnerId).catch(() => null);
            if (spouse) {
                familyData.spouse = { username: spouse.username, avatarUrl: spouse.displayAvatarURL({ extension: 'png' }) };
            }
        }

        // Fetch Parent
        if (parentRec) {
            const parent = await interaction.client.users.fetch(parentRec.parentId).catch(() => null);
            if (parent) {
                familyData.parent = { username: parent.username, avatarUrl: parent.displayAvatarURL({ extension: 'png' }) };
            }
        }

        // Fetch Children
        familyData.children = [];
        for (const rec of childrenRecs) {
            const child = await interaction.client.users.fetch(rec.childId).catch(() => null);
            if (child) {
                familyData.children.push({ username: child.username, avatarUrl: child.displayAvatarURL({ extension: 'png' }) });
            }
        }

        try {
            const imageBuffer = await generateFamilyTree(mainUser, familyData);
            const attachment = new AttachmentBuilder(imageBuffer, { name: 'family_tree.png' });

            const embed = new EmbedBuilder()
                .setTitle(`🏘️ Family Tree: ${interaction.user.username}`)
                .setImage('attachment://family_tree.png')
                .setColor('#6366f1')
                .setTimestamp();

            // Calculate Buffs
            let multiplier = 0;
            if (user && user.partnerId) multiplier += 10;
            multiplier += Math.min(childrenRecs.length * 5, 25);
            embed.setDescription(`✨ **Active Buffs:** +${multiplier}% Coin Bonus`);

            await interaction.editReply({ embeds: [embed], files: [attachment] });
        } catch (e) {
            console.error('Error generating family tree:', e);
            await interaction.editReply({ content: '❌ There was an error generating your family tree image.' });
        }
    },
};
