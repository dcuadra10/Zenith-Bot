const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { GoogleSpreadsheet } = require('google-spreadsheet');
const fs = require('fs');
const path = require('path');
const { getDb } = require('../../config/database');
const { JWT } = require('google-auth-library');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('export-members')
    .setDescription('Exports all users with a specific role to Google Sheets.')
    .addRoleOption(option => 
        option.setName('role')
            .setDescription('Optional: Filter by a specific role. Leave empty to export all members.')
            .setRequired(false))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    const role = interaction.options.getRole('role');
    console.log(`[EXPORT] Started by ${interaction.user.tag} for ${role ? `role ${role.name}` : 'ALL members'}`);
    
    await interaction.deferReply({ ephemeral: true });

    try {
        let membersData;
        
        if (role) {
            console.log(`[EXPORT] Selective fetch for role ${role.id} (${role.name})...`);
            try {
                const fetched = await interaction.guild.members.fetch({ role: role.id });
                membersData = fetched.filter(m => m.roles.cache.has(role.id));
            } catch (roleFetchErr) {
                console.warn(`[EXPORT] Role fetch failed, using cache filter:`, roleFetchErr.message);
                membersData = interaction.guild.members.cache.filter(m => m.roles.cache.has(role.id));
            }
        } else {
            console.log(`[EXPORT] Fetching ALL members from server...`);
            try {
                membersData = await interaction.guild.members.fetch();
            } catch (fullFetchErr) {
                console.error(`[EXPORT] Full fetch failed (possible rate limit):`, fullFetchErr.message);
                // Fallback to cache if possible, but warn the user
                membersData = interaction.guild.members.cache;
                await interaction.followUp({ content: '⚠️ Server is too large for a full real-time fetch. The exported list contains all currently cached members (approximate list).', ephemeral: true }).catch(() => {});
            }
        }
        
        if (membersData.size === 0) {
            return interaction.editReply(`No members found to export.`);
        }

        const ExcelJS = require('exceljs');
        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Members');

        worksheet.columns = [
            { header: 'ID', key: 'id', width: 25 },
            { header: 'Username', key: 'username', width: 30 },
            { header: 'Display Name', key: 'displayName', width: 30 }
        ];

        membersData.forEach(m => {
            worksheet.addRow({
                id: m.id,
                username: m.user.tag,
                displayName: m.displayName
            });
        });

        const buffer = await workbook.xlsx.writeBuffer();
        const { AttachmentBuilder } = require('discord.js');
        const fileName = role 
            ? `backup-${role.name.replace(/[^a-z0-9]/gi, '_')}.xlsx`
            : `backup-FULL-SERVER-${Date.now()}.xlsx`;
            
        const attachment = new AttachmentBuilder(buffer, { name: fileName });

        await interaction.editReply({ 
            content: `✅ Successfully exported **${membersData.size}** members ${role ? `from role **${role.name}**` : 'from the entire server'}.`, 
            files: [attachment] 
        });

    } catch (error) {
        console.error('[EXPORT] ERROR:', error);
        await interaction.editReply({ content: '❌ An error occurred during export.' });
    }
  }
};
