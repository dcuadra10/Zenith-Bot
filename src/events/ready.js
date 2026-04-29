module.exports = {
    name: 'ready',
    once: true,
    async execute(client) {
        console.log(`🤖 Logged in as ${client.user.tag}!`);
        
        // Registrar Comandos
        try {
            await client.application.commands.set(client.commands.map(c => c.data));
            console.log('✅ Slash Commands Cargados');
        } catch(e) {
            console.error('Error cargando comandos', e);
        }
        
        // Cachear invitaciones
        client.invites = new Map();
        try {
            const guilds = client.guilds.cache.map(guild => guild);
            for (const guild of guilds) {
                const firstInvites = await guild.invites.fetch().catch(() => null);
                if (firstInvites) {
                    client.invites.set(guild.id, new Map(firstInvites.map((invite) => [invite.code, invite.uses])));
                }
            }
            console.log('✅ Sistema de Invitaciones Cacheado');
        } catch (e) {
            console.error('Error cacheando invitaciones', e);
        }
    },
};
