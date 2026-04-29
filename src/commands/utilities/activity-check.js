const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const ms = require('ms');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('activity-check')
    .setDescription('Starts an Activity Check for a specific role.')
    .addRoleOption(option => 
        option.setName('role')
            .setDescription('Target role for the check')
            .setRequired(true))
    .addStringOption(option =>
        option.setName('duration')
            .setDescription('Duration of the check (e.g. 1h, 30m)')
            .setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    const role = interaction.options.getRole('role');
    const timeStr = interaction.options.getString('duration');
    const timeMs = ms(timeStr);

    if (!timeMs) {
        return interaction.reply({ content: '❌ Invalid duration format.', ephemeral: true });
    }

    await interaction.deferReply();
    await interaction.guild.members.fetch();
    const membersWithRole = interaction.guild.members.cache.filter(m => m.roles.cache.has(role.id) && !m.user.bot);

    if (membersWithRole.size === 0) {
        return interaction.editReply(`There are no members with the role ${role.name}.`);
    }

    const endUnix = Math.floor((Date.now() + timeMs) / 1000);
    const embed = new EmbedBuilder()
        .setTitle('✅ Activity Check')
        .setDescription(`Please react to this message <t:${endUnix}:R>.\n\nTarget Role: ${role}`)
        .setColor('Green')
        .setTimestamp(Date.now() + timeMs);

    // Ensure role is mentionable to trigger notification
    const originalMentionable = role.mentionable;
    if (!originalMentionable) {
        try {
            await role.setMentionable(true, 'Temporary mention for Activity Check');
        } catch (e) {
            console.error('Could not set role mentionable:', e);
        }
    }

    const checkMessage = await interaction.editReply({ 
        content: `${role}`, 
        embeds: [embed],
        allowedMentions: { roles: [role.id] } 
    });

    if (!originalMentionable) {
        try {
            await role.setMentionable(false).catch(() => {});
        } catch (e) {}
    }

    await checkMessage.react('✅').catch(() => {});

    const filter = (reaction, user) => reaction.emoji.name === '✅' && !user.bot;
    const collector = checkMessage.createReactionCollector({ filter, time: timeMs });

    const reactedUsers = new Set();

    collector.on('end', async () => {
        try {
            // Guarantee we get the latest reactions by fetching the message directly at the end
            const finalMessage = await interaction.channel.messages.fetch(checkMessage.id);
            const checkReaction = finalMessage.reactions.cache.get('✅');
            
            if (checkReaction) {
                const users = await checkReaction.users.fetch();
                users.forEach(u => {
                    if (!u.bot) reactedUsers.add(u.id);
                });
            }
        } catch (e) {
            console.error('Error fetching final reactions:', e);
        }

        const inactiveMembers = membersWithRole.filter(member => !reactedUsers.has(member.id));
        
        const reportEmbed = new EmbedBuilder()
            .setTitle(`Inactivity Report - ${role.name}`)
            .setDescription(`Found **${inactiveMembers.size}** inactive users out of ${membersWithRole.size} total.`)
            .setColor('Red');

        if(inactiveMembers.size > 0 && inactiveMembers.size <= 50) {
            reportEmbed.addFields({ name: 'Inactive Users', value: inactiveMembers.map(m => `<@${m.id}>`).join(', ') });
        } else if (inactiveMembers.size > 50) {
            reportEmbed.addFields({ name: 'Inactive Users', value: 'Too many to list in this Embed. Verify by exporting the general list.' });
        }

        await interaction.channel.send({ embeds: [reportEmbed] });
    });
  }
};
