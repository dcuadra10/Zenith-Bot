const { Pool } = require('pg');

let dbInstance = null;

function convertSqliteToPg(query, params = []) {
    let i = 1;
    // Replace SQLite parameter bindings (?) with Postgres bindings ($1, $2, ...)
    const text = query.replace(/\?/g, () => `$${i++}`);
    return { text, values: params };
}

// Convert SQLite schema specifically
function convertSqliteSchemaToPg(query) {
    let pgQuery = query.replace(/DATETIME/gi, 'TIMESTAMP');
    // keep INTEGER DEFAULT 0 etc
    return pgQuery;
}

// Map of lowercase PG column names to their original camelCase names
const columnNameMap = {};
function buildColumnMap(cols) {
    // Known camelCase column names used throughout the codebase
    const knownColumns = [
        'guildId', 'userId', 'statName',
        'welcomeEnabled', 'welcomeChannel', 'welcomeEmbedTitle', 'welcomeEmbedDesc', 'welcomeColor', 'welcomeImage', 'welcomeUseEmbed',
        'levelingEnabled', 'xpMin', 'xpMax', 'xpCooldown', 'levelUpChannel', 'roleRewards',
        'ticketsEnabled', 'ticketsMaxActive', 'ticketsTranscriptChannel', 'ticketCategoryId', 'ticketsApprovalChannel',
        'automodEnabled', 'automodSpam', 'automodLinks', 'automodMentions', 'automodCaps', 'automodWords',
        'automodWordList', 'automodMaxMentions', 'automodLogChannel',
        'loggingEnabled', 'loggingChannel', 'logEdits', 'logDeletes', 'logMembers', 'logRoles', 'logChannels', 'logBans',
        'autoroleEnabled', 'autoroleIds',
        'countingEnabled', 'countingChannel', 'countingCurrent', 'countingSameUser', 'countingReset', 'countingMath', 'countingLastUser',
        'serverStatsEnabled', 'statsTotalMembers', 'statsOnline', 'statsBots', 'statsChannels', 'statsCategoryId',
        'antinukeEnabled', 'antinukeBan', 'antinukeChannel', 'antinukeRole', 'antinukeWebhook', 'antinukeThreshold', 'antinukeWhitelist',
        'r4TrackingEnabled', 'r4TrackingRole', 'r4TrackingAdQuota', 'r4TrackingMsgQuota',
        'swearJarEnabled', 'swearJarChannel', 'swearJarWords', 'swearJarPing',
        'spreadsheetId', 'leadershipChannelId', 'welcomeChannelId', 'logChannelId',
        'brandingName', 'brandingAvatar',
        'panelData', 'channelId', 'messageId',
        'ticketId', 'logContent', 'closedAt',
        'weekId', 'messages', 'ads', 'excused',
        'uuid', 'optJson', 'answersJson',
        'winnersCount', 'endTime', 'prize', 'requiredRole', 'pingRole', 'durationMs', 'status',
        'botToken', 'clientId', 'errorMessage',
        'marketEnabled', 'forumChannelId', 'approvalChannelId', 'ownerChannelId', 'paymentMethods', 'middlemanRole', 'feePercentage',
        'sellerId', 'dataJson', 'imagesJson', 'forumThreadId', 'buyerId', 'middlemanId', 'offerJson', 'listingCode'
    ];
    knownColumns.forEach(col => {
        columnNameMap[col.toLowerCase()] = col;
    });
}
buildColumnMap();

// Restore camelCase keys on a row object
function restoreKeys(row) {
    if (!row) return row;
    const restored = {};
    for (const key of Object.keys(row)) {
        restored[columnNameMap[key] || key] = row[key];
    }
    return restored;
}

async function getDb() {
    if (!dbInstance) {
        if (!process.env.DATABASE_URL) {
            console.warn("[WARNING] DATABASE_URL no está definido en el archivo .env. Asegúrate de configurarlo para NeonDB.");
        }
        
        const pool = new Pool({
            connectionString: process.env.DATABASE_URL || "postgresql://user:pass@host/db",
            ssl: {
                rejectUnauthorized: false
            },
            max: 1
        });

        const wrapper = {
            run: async (query, params = []) => {
                const { text, values } = convertSqliteToPg(query, params);
                return pool.query(text, values);
            },
            get: async (query, params = []) => {
                const { text, values } = convertSqliteToPg(query, params);
                const res = await pool.query(text, values);
                return restoreKeys(res.rows[0]);
            },
            all: async (query, params = []) => {
                const { text, values } = convertSqliteToPg(query, params);
                const res = await pool.query(text, values);
                return res.rows.map(restoreKeys);
            },
            exec: async (query) => {
                const pgQuery = convertSqliteSchemaToPg(query);
                return pool.query(pgQuery);
            }
        };
        
        dbInstance = wrapper;

        // Initialize tables
        await dbInstance.exec(`
            CREATE TABLE IF NOT EXISTS users (
                userId TEXT PRIMARY KEY,
                xp INTEGER DEFAULT 0,
                level INTEGER DEFAULT 0,
                invites INTEGER DEFAULT 0
            );
            
            CREATE TABLE IF NOT EXISTS global_stats (
                statName TEXT PRIMARY KEY,
                value INTEGER DEFAULT 0
            );

            CREATE TABLE IF NOT EXISTS guild_configs (
                guildId TEXT PRIMARY KEY,
                spreadsheetId TEXT,
                leadershipChannelId TEXT,
                welcomeChannelId TEXT,
                logChannelId TEXT,
                ticketCategoryId TEXT
            );

            CREATE TABLE IF NOT EXISTS ticket_panels (
                id TEXT PRIMARY KEY,
                guildId TEXT,
                channelId TEXT,
                messageId TEXT,
                panelData TEXT
            );
            
            CREATE TABLE IF NOT EXISTS ticket_transcripts (
                ticketId TEXT PRIMARY KEY,
                guildId TEXT,
                userId TEXT,
                closedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                logContent TEXT
            );
            
            CREATE TABLE IF NOT EXISTS giveaways (
                id TEXT PRIMARY KEY,
                guildId TEXT,
                channelId TEXT,
                prize TEXT,
                winnersCount INTEGER,
                endTime BIGINT,
                hostedBy TEXT,
                requiredRole TEXT,
                pingRole TEXT,
                status TEXT DEFAULT 'active'
            );

            CREATE TABLE IF NOT EXISTS pending_tickets (
                uuid TEXT PRIMARY KEY,
                guildId TEXT,
                userId TEXT,
                optJson TEXT,
                answersJson TEXT,
                createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS r4_tracking (
                userId TEXT,
                guildId TEXT,
                weekId TEXT,
                messages INTEGER DEFAULT 0,
                ads INTEGER DEFAULT 0,
                excused INTEGER DEFAULT 0,
                isProcessed INTEGER DEFAULT 0,
                PRIMARY KEY (userId, guildId, weekId)
            );

            CREATE TABLE IF NOT EXISTS module_configs (
                guildId TEXT PRIMARY KEY,
                -- Welcome
                welcomeEnabled INTEGER DEFAULT 0,
                welcomeChannel TEXT,
                welcomeEmbedTitle TEXT,
                welcomeEmbedDesc TEXT,
                welcomeColor TEXT DEFAULT '#6366f1',
                welcomeImage TEXT,
                welcomeUseEmbed INTEGER DEFAULT 1,
                -- Leveling
                levelingEnabled INTEGER DEFAULT 0,
                xpMin INTEGER DEFAULT 5,
                xpMax INTEGER DEFAULT 15,
                xpCooldown INTEGER DEFAULT 60,
                levelUpChannel TEXT,
                roleRewards TEXT DEFAULT '[]',
                -- Tickets
                ticketsEnabled INTEGER DEFAULT 1,
                ticketsMaxActive INTEGER DEFAULT 2,
                ticketsTranscriptChannel TEXT,
                ticketCategoryId TEXT,
                ticketsApprovalChannel TEXT,
                -- Automod
                automodEnabled INTEGER DEFAULT 0,
                automodSpam INTEGER DEFAULT 0,
                automodLinks INTEGER DEFAULT 0,
                automodMentions INTEGER DEFAULT 0,
                automodCaps INTEGER DEFAULT 0,
                automodWords INTEGER DEFAULT 0,
                automodWordList TEXT,
                automodMaxMentions INTEGER DEFAULT 5,
                automodLogChannel TEXT,
                -- Logging
                loggingEnabled INTEGER DEFAULT 0,
                loggingChannel TEXT,
                logEdits INTEGER DEFAULT 1,
                logDeletes INTEGER DEFAULT 1,
                logMembers INTEGER DEFAULT 1,
                logRoles INTEGER DEFAULT 0,
                logChannels INTEGER DEFAULT 0,
                logBans INTEGER DEFAULT 1,
                -- Auto-Role
                autoroleEnabled INTEGER DEFAULT 0,
                autoroleIds TEXT DEFAULT '[]',
                -- Counting
                countingEnabled INTEGER DEFAULT 0,
                countingChannel TEXT,
                countingCurrent INTEGER DEFAULT 0,
                countingSameUser INTEGER DEFAULT 0,
                countingReset INTEGER DEFAULT 1,
                countingMath INTEGER DEFAULT 0,
                countingLastUser TEXT,
                -- Server Stats
                serverStatsEnabled INTEGER DEFAULT 0,
                statsTotalMembers INTEGER DEFAULT 1,
                statsOnline INTEGER DEFAULT 0,
                statsBots INTEGER DEFAULT 0,
                statsChannels INTEGER DEFAULT 0,
                statsCategoryId TEXT,
                -- Anti-Nuke
                antinukeEnabled INTEGER DEFAULT 0,
                antinukeBan INTEGER DEFAULT 1,
                antinukeChannel INTEGER DEFAULT 1,
                antinukeRole INTEGER DEFAULT 1,
                antinukeWebhook INTEGER DEFAULT 0,
                antinukeThreshold INTEGER DEFAULT 5,
                antinukeWhitelist TEXT,
                -- R4 Tracking
                r4TrackingEnabled INTEGER DEFAULT 0,
                r4TrackingRole TEXT,
                r4TrackingAdQuota INTEGER DEFAULT 40,
                r4TrackingMsgQuota INTEGER DEFAULT 245
            );

            CREATE TABLE IF NOT EXISTS custom_bots (
                guildId TEXT PRIMARY KEY,
                botToken TEXT NOT NULL,
                clientId TEXT,
                status TEXT DEFAULT 'inactive',
                errorMessage TEXT
            );

            CREATE TABLE IF NOT EXISTS market_configs (
                guildId TEXT PRIMARY KEY,
                marketEnabled INTEGER DEFAULT 0,
                forumChannelId TEXT,
                approvalChannelId TEXT,
                ownerChannelId TEXT,
                paymentMethods TEXT,
                middlemanRole TEXT,
                marketFeePct INTEGER DEFAULT 5,
                middlemanFeePct INTEGER DEFAULT 5,
                marketQuestions TEXT
            );

            CREATE TABLE IF NOT EXISTS market_listings (
                code TEXT PRIMARY KEY,
                guildId TEXT,
                sellerId TEXT,
                status TEXT DEFAULT 'pending',
                price TEXT,
                dataJson TEXT,
                imagesJson TEXT,
                forumThreadId TEXT,
                createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS market_transactions (
                id TEXT PRIMARY KEY,
                listingCode TEXT,
                guildId TEXT,
                buyerId TEXT,
                sellerId TEXT,
                middlemanId TEXT,
                status TEXT DEFAULT 'offer_sent',
                price TEXT,
                offerJson TEXT,
                createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);
        
        const ticketCols = ['ticketsMaxActive INTEGER DEFAULT 2', 'ticketsTranscriptChannel TEXT', 'countingMath INTEGER DEFAULT 0', 'countingLastUser TEXT', 'ticketCategoryId TEXT', 'ticketsApprovalChannel TEXT', 'r4TrackingEnabled INTEGER DEFAULT 0', 'r4TrackingRole TEXT', 'r4TrackingAdQuota INTEGER DEFAULT 40', 'r4TrackingMsgQuota INTEGER DEFAULT 245', 'welcomeImage TEXT', 'welcomeUseEmbed INTEGER DEFAULT 1', 'swearJarEnabled INTEGER DEFAULT 0', 'swearJarChannel TEXT', 'swearJarWords TEXT', 'swearJarPing INTEGER DEFAULT 1'];
        for (const col of ticketCols) {
            try { await dbInstance.exec(`ALTER TABLE module_configs ADD COLUMN ${col}`); } catch (e) {}
        }
        try { await dbInstance.exec(`ALTER TABLE market_configs ADD COLUMN marketQuestions TEXT`); } catch (e) {}

        // Auto-migrate guild_configs columns
        const guildCols = ['welcomeChannelId', 'logChannelId', 'ticketCategoryId', 'brandingName', 'brandingAvatar'];
        for (const col of guildCols) {
            try { await dbInstance.exec(`ALTER TABLE guild_configs ADD COLUMN ${col} TEXT`); } catch (e) {}
        }
        
        // Auto-migrate giveaways columns
        const giveawayCols = ['requiredRole', 'pingRole'];
        for (const col of giveawayCols) {
            try { await dbInstance.exec(`ALTER TABLE giveaways ADD COLUMN ${col} TEXT`); } catch (e) {}
        }
    }
    return dbInstance;
}

module.exports = { getDb };
