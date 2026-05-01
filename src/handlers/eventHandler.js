const fs = require('fs');
const path = require('path');

module.exports = (client) => {
    const eventsPath = path.join(__dirname, '../events');
    
    if(!fs.existsSync(eventsPath)) fs.mkdirSync(eventsPath, {recursive: true});

    const eventFiles = fs.readdirSync(eventsPath).filter(file => file.endsWith('.js'));

    for (const file of eventFiles) {
        const filePath = path.join(eventsPath, file);
        const event = require(filePath);
        if (event.once) {
            client.once(event.name, async (...args) => {
                try { await event.execute(...args, client); }
                catch (err) { console.error(`[EVENT ERROR] ${event.name}:`, err); }
            });
        } else {
            client.on(event.name, async (...args) => {
                try { await event.execute(...args, client); }
                catch (err) { console.error(`[EVENT ERROR] ${event.name}:`, err); }
            });
        }
    }
};
