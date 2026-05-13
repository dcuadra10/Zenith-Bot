/**
 * Utility helpers for building Discord Components V2 messages.
 * Provides a unified way to send either classic Embeds or V2 Container-based messages.
 */
const {
    ContainerBuilder,
    TextDisplayBuilder,
    MediaGalleryBuilder,
    MediaGalleryItemBuilder,
    SeparatorBuilder,
    ActionRowBuilder,
    MessageFlags,
    EmbedBuilder
} = require('discord.js');

/**
 * Build a V2 Components message payload.
 * @param {Object} opts
 * @param {string} opts.title - Bold title text
 * @param {string} opts.description - Body text (supports markdown)
 * @param {string} [opts.imageUrl] - Optional image URL
 * @param {string} [opts.thumbnailUrl] - Optional thumbnail URL (avatar etc)
 * @param {string} [opts.color] - Hex color for accent (e.g. '#FFD700')
 * @param {Array} [opts.fields] - Array of {name, value} field pairs
 * @param {Array} [opts.actionRows] - ActionRow components (buttons, selects)
 * @param {string} [opts.footer] - Footer text
 * @returns {Object} message payload ready for channel.send() or interaction.reply()
 */
function buildV2Message(opts) {
    const container = new ContainerBuilder();

    // Set accent color if provided
    if (opts.color) {
        const colorInt = parseInt(opts.color.replace('#', ''), 16);
        container.setAccentColor(colorInt);
    }

    // If we have dynamic components, use them
    if (opts.v2Components && opts.v2Components.length > 0) {
        opts.v2Components.forEach(comp => {
            if (comp.type === 'text') {
                container.addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(comp.content || '_ _')
                );
            } else if (comp.type === 'separator') {
                container.addSeparatorComponents(
                    new SeparatorBuilder()
                        .setSize(comp.size === 'large' ? 'Large' : 'Small')
                        .setDivider(!!comp.dividerLine)
                );
            } else if (comp.type === 'section') {
                const section = new SectionBuilder().setText(
                    new TextDisplayBuilder().setContent(comp.content || '_ _')
                );
                if (comp.accessory && comp.accessory.type === 'thumbnail' && comp.accessory.url) {
                    section.setAccessory(
                        new MediaGalleryBuilder().addItems(
                            new MediaGalleryItemBuilder().setURL(comp.accessory.url)
                        )
                    );
                }
                container.addSectionComponents(section);
            } else if (comp.type === 'mediaGallery') {
                if (comp.items && comp.items.length > 0) {
                    const gallery = new MediaGalleryBuilder();
                    comp.items.forEach(item => {
                        if (item.url) gallery.addItems(new MediaGalleryItemBuilder().setURL(item.url));
                    });
                    container.addMediaGalleryComponents(gallery);
                }
            }
        });
    } else {
        // Fallback to classic title/desc for simple V2
        if (opts.title) {
            container.addTextDisplayComponents(
                new TextDisplayBuilder().setContent(`### ${opts.title}`)
            );
        }
        if (opts.description) {
            container.addTextDisplayComponents(
                new TextDisplayBuilder().setContent(opts.description)
            );
        }
        if (opts.imageUrl) {
            container.addMediaGalleryComponents(
                new MediaGalleryBuilder().addItems(
                    new MediaGalleryItemBuilder().setURL(opts.imageUrl)
                )
            );
        }
    }

    // Footer
    if (opts.footer) {
        container.addSeparatorComponents(new SeparatorBuilder());
        container.addTextDisplayComponents(
            new TextDisplayBuilder().setContent(`-# ${opts.footer}`)
        );
    }

    // Action rows go inside the container in V2
    if (opts.actionRows && opts.actionRows.length > 0) {
        opts.actionRows.forEach(row => {
            container.addActionRowComponents(row);
        });
    }

    return {
        components: [container],
        flags: MessageFlags.IsComponentsV2
    };
}

/**
 * Build a classic Embed message payload.
 * @param {Object} opts - Same options as buildV2Message
 * @returns {Object} message payload
 */
function buildEmbedMessage(opts) {
    const embed = new EmbedBuilder();

    if (opts.title) embed.setTitle(opts.title);
    if (opts.description) embed.setDescription(opts.description);
    if (opts.color) embed.setColor(opts.color);
    if (opts.imageUrl) embed.setImage(opts.imageUrl);
    if (opts.thumbnailUrl) embed.setThumbnail(opts.thumbnailUrl);
    if (opts.footer) embed.setFooter({ text: opts.footer });
    if (opts.fields) {
        opts.fields.forEach(f => embed.addFields({ name: f.name, value: f.value.substring(0, 1024) }));
    }

    const payload = { embeds: [embed] };
    if (opts.actionRows && opts.actionRows.length > 0) {
        payload.components = opts.actionRows;
    }

    return payload;
}

/**
 * Build a message payload based on the useEmbed flag.
 * @param {boolean} useEmbed - If true, use classic embed. If false, use Components V2.
 * @param {Object} opts - Message options
 * @returns {Object} message payload
 */
function buildMessage(useEmbed, opts) {
    if (useEmbed) {
        return buildV2Message(opts);
    } else {
        return buildEmbedMessage(opts);
    }
}

module.exports = { buildV2Message, buildEmbedMessage, buildMessage };
