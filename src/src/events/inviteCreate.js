module.exports = {
    name: 'inviteCreate',
    async execute(invite, client) {
        const guildInvites = client.invites.get(invite.guild.id);
        if (guildInvites) {
            guildInvites.set(invite.code, invite.uses);
        }
    }
};
