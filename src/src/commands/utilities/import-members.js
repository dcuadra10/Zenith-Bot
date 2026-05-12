const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const axios = require('axios');
const ExcelJS = require('exceljs');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('import-members')
    .setDescription('Imports users from an Excel file (.xlsx) and assigns them a specific role.')
    .addRoleOption(option => 
        option.setName('role')
            .setDescription('The role to assign to the imported users.')
            .setRequired(true))
    .addAttachmentOption(option => 
        option.setName('file')
            .setDescription('The backup Excel file (.xlsx) to import from.')
            .setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    const role = interaction.options.getRole('role');
    const attachment = interaction.options.getAttachment('file');

    if (!attachment.name.endsWith('.xlsx')) {
        return interaction.reply({ content: '❌ Please upload a valid `.xlsx` Excel file.', ephemeral: true });
    }

    await interaction.deferReply({ ephemeral: true });

    try {
        const response = await axios.get(attachment.url, { responseType: 'arraybuffer' });
        const buffer = Buffer.from(response.data);
        
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(buffer);
        const worksheet = workbook.getWorksheet(1); // Get first sheet

        const userIds = [];
        worksheet.eachRow((row, rowNumber) => {
            if (rowNumber === 1) return; // Skip header
            const idValue = row.getCell(1).value; // ID is in column 1
            if (idValue) {
                // Ensure ID is a string (sometimes Excel converts large numbers to scientific notation or numbers)
                userIds.push(idValue.toString().trim());
            }
        });

        if (userIds.length === 0) {
            return interaction.editReply('❌ No member IDs found in the uploaded Excel file. Ensure the first column contains Discord IDs.');
        }

        await interaction.editReply(`⏳ Found **${userIds.length}** members in Excel. Synchronizing roles...`);

        // Bulk fetch all members in the list to avoid rate limits
        const membersFetched = await interaction.guild.members.fetch({ user: userIds }).catch(e => {
            console.error('[IMPORT] Bulk fetch error:', e);
            return new Map();
        });

        let successCount = 0;
        let failCount = userIds.length - membersFetched.size;

        for (const [memberId, member] of membersFetched) {
            try {
                if (!member.roles.cache.has(role.id)) {
                    await member.roles.add(role);
                }
                successCount++;
            } catch (err) {
                console.error(`[IMPORT] Error adding role to ${memberId}:`, err.message);
                failCount++;
            }
        }

        const embed = new EmbedBuilder()
            .setTitle('📥 Excel Import Complete')
            .setDescription(`Processed file: \`${attachment.name}\``)
            .addFields(
                { name: 'Target Role', value: `${role}`, inline: true },
                { name: 'Total Found', value: `${userIds.length}`, inline: true },
                { name: 'Restored/Confirmed', value: `✅ ${successCount}`, inline: true },
                { name: 'Not in Server', value: `❌ ${failCount}`, inline: true }
            )
            .setColor('Gold')
            .setTimestamp();

        await interaction.editReply({ content: '✅ Process complete.', embeds: [embed] });

    } catch (error) {
        console.error('[IMPORT] Excel Error:', error);
        await interaction.editReply({ content: `❌ Error reading the Excel file: ${error.message}` });
    }
  }
};
