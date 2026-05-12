const { EmbedBuilder } = require('discord.js');
const { getDb } = require('../config/database');

async function startTicketFlow(interaction) {
  let dmChannel;
  try {
    dmChannel = await interaction.user.createDM();
    await interaction.reply({ content: '📬 I have sent you a DM to continue your ticket.', ephemeral: true });
  } catch (error) {
    await interaction.reply({ content: '⚠️ Your DMs are disabled. We will continue the ticket in this channel.', ephemeral: true });
    dmChannel = interaction.channel;
  }

  const filter = m => m.author.id === interaction.user.id;
  const collector = dmChannel.createMessageCollector({ filter, time: 600000 }); // 10 minutes

  const questions = [
    '📝 **Step 1:** What is your inquiry or problem?', 
    '📎 **Step 2:** Do you have any receipt or screenshot? (Include it in your response and type "next" in a separate message to finish)'
  ];
  let currentQuestion = 0;
  const answers = [];

  await dmChannel.send(questions[currentQuestion]);

  collector.on('collect', async (m) => {
    try {
      if (m.content.toLowerCase() === 'next') {
        currentQuestion++;
        if (currentQuestion < questions.length) {
          await dmChannel.send(questions[currentQuestion]);
        } else {
          collector.stop('completed');
        }
      } else {
        let content = m.content;
        if (m.attachments.size > 0) {
            content += '\n' + m.attachments.map(a => a.url).join('\n');
        }
        answers[currentQuestion] = (answers[currentQuestion] || '') + '\n' + content;
      }
    } catch (err) {
      console.error('Error in ticket collector', err);
    }
  });

  collector.on('end', async (collected, reason) => {
    if (reason === 'completed') {
      await dmChannel.send('✅ Thank you! We have registered your ticket.');
      
      const embed = new EmbedBuilder()
        .setTitle(`Ticket from ${interaction.user.username}`)
        .addFields(
          { name: 'Problem', value: answers[0] || 'N/A' },
          { name: 'Evidence', value: answers[1] || 'N/A' }
        )
        .setColor('Blue');
        
      const db = await getDb();
      const config = await db.get(`SELECT * FROM guild_configs WHERE guildId = ?`, [interaction.guild.id]);
      if (config && config.leadershipChannelId) {
          const leaderChannel = interaction.guild.channels.cache.get(config.leadershipChannelId);
          if (leaderChannel) await leaderChannel.send({ embeds: [embed] });
      } else {
          await dmChannel.send('⚠️ Your ticket was saved locally because no Leadership Channel is configured on the dashboard.');
      }
    } else {
      await dmChannel.send('⏳ The time to respond has expired or the request was cancelled.');
    }
  });
}

module.exports = { startTicketFlow };
