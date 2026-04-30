// ============================================
// ZENITH COMMAND CENTER — Full Dashboard Logic
// ============================================

const API_URL = '/api';
let activeGuild = null;
let editingPanelId = null;
let editingMessageId = null;

// ===== UTILITIES =====
function getCookie(name) {
    const v = `; ${document.cookie}`;
    const parts = v.split(`; ${name}=`);
    if (parts.length === 2) return parts.pop().split(';').shift();
}

function animateValue(el, start, end, duration) {
    if (typeof el === 'string') el = document.getElementById(el);
    if (!el) return;
    let startTs = null;
    const step = (ts) => {
        if (!startTs) startTs = ts;
        const p = Math.min((ts - startTs) / duration, 1);
        el.textContent = Math.floor(p * (end - start) + start);
        if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
}

function closeModal(id) {
    document.getElementById(id).classList.remove('active');
}

// ===== SCREEN MANAGEMENT =====
function showScreen(id) {
    ['loginScreen', 'guildScreen', 'dashboardScreen'].forEach(s => {
        document.getElementById(s).style.display = 'none';
    });
    document.getElementById(id).style.display = '';
}

// ===== INIT =====
window.addEventListener('DOMContentLoaded', () => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('token') === 'success') {
        window.history.replaceState({}, document.title, '/');
        showScreen('guildScreen');
        fetchGuilds();
    } else if (getCookie('discord_token')) {
        showScreen('guildScreen');
        fetchGuilds();
    }

    // Sidebar navigation
    document.querySelectorAll('.sidebar-link').forEach(link => {
        link.addEventListener('click', () => {
            const page = link.dataset.page;
            if (!page) return;
            document.querySelectorAll('.sidebar-link').forEach(l => l.classList.remove('active'));
            link.classList.add('active');
            document.querySelectorAll('.page-section').forEach(s => s.classList.remove('active'));
            const target = document.getElementById('page-' + page);
            if (target) target.classList.add('active');

            if (page === 'transcripts') {
                fetchTranscripts();
            }
        });
    });

    // Color pickers sync
    setupColorSync('panelColor', 'panelColorHex');
    setupColorSync('welcomeColor', 'welcomeColorHex');
});

function setupColorSync(inputId, hexId) {
    const input = document.getElementById(inputId);
    const hex = document.getElementById(hexId);
    if (input && hex) {
        input.addEventListener('input', () => { hex.textContent = input.value; });
    }
}

// ===== GUILD LOADING =====
async function fetchGuilds() {
    const list = document.getElementById('guildList');
    try {
        const res = await fetch(`${API_URL}/guilds`);
        if (!res.ok) throw new Error('Auth');
        const guilds = await res.json();

        if (guilds.length === 0) {
            list.innerHTML = '<p style="color:var(--text-muted);text-align:center;width:100%;">No shared admin servers found.</p>';
            return;
        }

        list.innerHTML = '';
        guilds.forEach(g => {
            const iconUrl = g.icon ? `https://cdn.discordapp.com/icons/${g.id}/${g.icon}.png` : '';
            const el = document.createElement('div');
            el.className = 'guild-item';
            el.innerHTML = `
                <div class="guild-avatar">
                    ${iconUrl ? `<img src="${iconUrl}" alt="${g.name}">` : g.name[0]}
                </div>
                <div class="guild-info">
                    <h3>${g.name}</h3>
                    <small>${g.owner ? 'Owner' : 'Admin'}</small>
                </div>
            `;
            el.onclick = () => selectGuild(g);
            list.appendChild(el);
        });
    } catch (e) {
        document.cookie = 'discord_token=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;';
        window.location.reload();
    }
}

function selectGuild(guild) {
    activeGuild = guild;
    document.getElementById('sidebarGuildName').textContent = guild.name;
    
    // Sidebar server avatar
    const avatarEl = document.getElementById('sidebarAvatar');
    if (guild.icon) {
        avatarEl.innerHTML = `<img src="https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.png" alt="${guild.name}">`;
    } else {
        avatarEl.textContent = guild.name[0];
        avatarEl.style.display = 'flex';
        avatarEl.style.alignItems = 'center';
        avatarEl.style.justifyContent = 'center';
        avatarEl.style.fontWeight = '700';
        avatarEl.style.color = 'var(--primary)';
    }

    // Topbar user
    document.getElementById('topbarUsername').textContent = guild.owner ? 'Owner' : 'Admin';

    showScreen('dashboardScreen');
    loadDashboardData();
}

function goBackToGuilds() {
    activeGuild = null;
    showScreen('guildScreen');
    // Reset to overview
    document.querySelectorAll('.sidebar-link').forEach(l => l.classList.remove('active'));
    document.querySelector('.sidebar-link[data-page="overview"]').classList.add('active');
    document.querySelectorAll('.page-section').forEach(s => s.classList.remove('active'));
    document.getElementById('page-overview').classList.add('active');
}

// ===== LOAD ALL DASHBOARD DATA =====
async function loadDashboardData() {
    if (!activeGuild) return;
    const gid = activeGuild.id;

    // Stats
    try {
        const res = await fetch(`${API_URL}/stats`);
        const data = await res.json();
        animateValue('statAds', 0, data.totalAds || 0, 800);
        animateValue('statUsers', 0, data.totalUsers || 0, 800);
    } catch (e) { console.error(e); }

    // Config
    try {
        const res = await fetch(`${API_URL}/config/${gid}`);
        const cfg = await res.json();
        setVal('cfgWelcomeChannel', cfg.welcomeChannelId);
        setVal('cfgLogChannel', cfg.logChannelId);
        setVal('cfgLeadershipChannel', cfg.leadershipChannelId);
        setVal('cfgTicketCategory', cfg.ticketCategoryId);
        setVal('cfgSpreadsheetId', cfg.spreadsheetId);
    } catch (e) { console.error(e); }

    // Module configs
    try {
        const res = await fetch(`${API_URL}/modules/${gid}`);
        const mods = await res.json();
        loadModuleToggles(mods);
    } catch (e) { console.error(e); }

    // Panels
    fetchPanels();
    fetchTranscripts();
    fetchGiveaways();
    fetchR4Tracking();
}

function setVal(id, val) {
    const el = document.getElementById(id);
    if (el) el.value = val || '';
}

function loadModuleToggles(mods) {
    if (!mods) return;
    // Welcome
    setCheck('toggleWelcome', mods.welcomeEnabled);
    setVal('welcomeChannelCfg', mods.welcomeChannel);
    setVal('welcomeTitle', mods.welcomeEmbedTitle);
    setVal('welcomeMessage', mods.welcomeEmbedDesc);
    if (mods.welcomeColor) {
        setVal('welcomeColor', mods.welcomeColor);
        const hex = document.getElementById('welcomeColorHex');
        if (hex) hex.textContent = mods.welcomeColor;
    }
    setVal('welcomeImage', mods.welcomeImage);
    setCheck('welcomeUseEmbed', mods.welcomeUseEmbed === undefined || mods.welcomeUseEmbed === null ? true : !!mods.welcomeUseEmbed);
    // Leveling
    setCheck('toggleLeveling', mods.levelingEnabled);
    setVal('xpMin', mods.xpMin ?? 5);
    setVal('xpMax', mods.xpMax ?? 15);
    setVal('xpCooldown', mods.xpCooldown ?? 60);
    setVal('levelUpChannel', mods.levelUpChannel);
    // Tickets
    setCheck('toggleTickets', mods.ticketsEnabled);
    if(mods.ticketsMaxActive) setVal('ticketsMaxActive', mods.ticketsMaxActive ?? 2);
    setVal('ticketsTranscriptChannel', mods.ticketsTranscriptChannel);
    setVal('ticketCategoryId', mods.ticketCategoryId);
    setVal('ticketsApprovalChannel', mods.ticketsApprovalChannel);
    // Automod
    setCheck('toggleAutomod', mods.automodEnabled);
    setCheck('automodSpam', mods.automodSpam);
    setCheck('automodLinks', mods.automodLinks);
    setCheck('automodMentions', mods.automodMentions);
    setCheck('automodCaps', mods.automodCaps);
    setCheck('automodWords', mods.automodWords);
    setVal('automodWordList', mods.automodWordList);
    setVal('automodMaxMentions', mods.automodMaxMentions ?? 5);
    setVal('automodLogChannel', mods.automodLogChannel);
    // Logging
    setCheck('toggleLogging', mods.loggingEnabled);
    setVal('loggingChannel', mods.loggingChannel);
    setCheck('logEdits', mods.logEdits);
    setCheck('logDeletes', mods.logDeletes);
    setCheck('logMembers', mods.logMembers);
    setCheck('logRoles', mods.logRoles);
    setCheck('logChannels', mods.logChannels);
    setCheck('logBans', mods.logBans);
    // Auto-Role
    setCheck('toggleAutorole', mods.autoroleEnabled);
    if (mods.autoroleIds) {
        renderAutoRoles(JSON.parse(mods.autoroleIds || '[]'));
    }
    // Counting
    setCheck('toggleCounting', mods.countingEnabled);
    setVal('countingChannel', mods.countingChannel);
    setVal('countingCurrent', mods.countingCurrent);
    setCheck('countingSameUser', mods.countingSameUser);
    setCheck('countingReset', mods.countingReset);
    setCheck('countingMath', mods.countingMath);
    // Server Stats
    setCheck('toggleServerStats', mods.serverStatsEnabled);
    setCheck('statsTotalMembers', mods.statsTotalMembers);
    setCheck('statsOnline', mods.statsOnline);
    setCheck('statsBots', mods.statsBots);
    setCheck('statsChannels', mods.statsChannels);
    setVal('statsCategoryId', mods.statsCategoryId);
    // Anti-Nuke
    setCheck('toggleAntinuke', mods.antinukeEnabled);
    setCheck('antinukeBan', mods.antinukeBan);
    setCheck('antinukeChannel', mods.antinukeChannel);
    setCheck('antinukeRole', mods.antinukeRole);
    setCheck('antinukeWebhook', mods.antinukeWebhook);
    setVal('antinukeThreshold', mods.antinukeThreshold ?? 5);
    setVal('antinukeWhitelist', mods.antinukeWhitelist);
    // R4 Tracking
    setCheck('toggleR4Tracking', mods.r4TrackingEnabled);
    setVal('r4TrackingRole', mods.r4TrackingRole);
    setVal('r4TrackingAdQuota', mods.r4TrackingAdQuota ?? 40);
    setVal('r4TrackingMsgQuota', mods.r4TrackingMsgQuota ?? 245);
}

function setCheck(id, val) {
    const el = document.getElementById(id);
    if (el) el.checked = !!val;
}

function getCheck(id) {
    const el = document.getElementById(id);
    return el ? (el.checked ? 1 : 0) : 0;
}

function getVal(id) {
    const el = document.getElementById(id);
    return el ? el.value.trim() : '';
}

// ===== SAVE GENERAL CONFIG =====
async function saveGeneralConfig() {
    if (!activeGuild) return;
    const btn = document.getElementById('btnSaveGeneral');
    btn.textContent = 'Saving...';
    btn.disabled = true;

    try {
        await fetch(`${API_URL}/config/${activeGuild.id}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                welcomeChannelId: getVal('cfgWelcomeChannel'),
                logChannelId: getVal('cfgLogChannel'),
                leadershipChannelId: getVal('cfgLeadershipChannel'),
                ticketCategoryId: getVal('cfgTicketCategory'),
                spreadsheetId: getVal('cfgSpreadsheetId')
            })
        });
        btn.textContent = '✅ Saved';
        btn.style.background = 'var(--accent-green)';
    } catch (e) {
        btn.textContent = '❌ Error';
        btn.style.background = 'var(--accent-red)';
    }
    setTimeout(() => {
        btn.textContent = '💾 Save Settings';
        btn.style.background = '';
        btn.disabled = false;
    }, 2000);
}

// ===== SAVE MODULE CONFIGS =====
async function saveModuleConfig(moduleName) {
    if (!activeGuild) return;

    const payload = {
        // Welcome
        welcomeEnabled: getCheck('toggleWelcome'),
        welcomeChannel: getVal('welcomeChannelCfg'),
        welcomeEmbedTitle: getVal('welcomeTitle'),
        welcomeEmbedDesc: getVal('welcomeMessage'),
        welcomeColor: getVal('welcomeColor'),
        welcomeImage: getVal('welcomeImage'),
        welcomeUseEmbed: getCheck('welcomeUseEmbed'),
        // Leveling
        levelingEnabled: getCheck('toggleLeveling'),
        xpMin: parseInt(getVal('xpMin')) || 5,
        xpMax: parseInt(getVal('xpMax')) || 15,
        xpCooldown: parseInt(getVal('xpCooldown')) || 60,
        levelUpChannel: getVal('levelUpChannel'),
        // Tickets
        ticketsEnabled: getCheck('toggleTickets'),
        ticketsMaxActive: parseInt(getVal('ticketsMaxActive'), 10) || 2,
        ticketsTranscriptChannel: getVal('ticketsTranscriptChannel'),
        ticketCategoryId: getVal('ticketCategoryId'),
        ticketsApprovalChannel: getVal('ticketsApprovalChannel'),
        // Automod
        automodEnabled: getCheck('toggleAutomod'),
        automodSpam: getCheck('automodSpam'),
        automodLinks: getCheck('automodLinks'),
        automodMentions: getCheck('automodMentions'),
        automodCaps: getCheck('automodCaps'),
        automodWords: getCheck('automodWords'),
        automodWordList: getVal('automodWordList'),
        automodMaxMentions: parseInt(getVal('automodMaxMentions')) || 5,
        automodLogChannel: getVal('automodLogChannel'),
        // Logging
        loggingEnabled: getCheck('toggleLogging'),
        loggingChannel: getVal('loggingChannel'),
        logEdits: getCheck('logEdits'),
        logDeletes: getCheck('logDeletes'),
        logMembers: getCheck('logMembers'),
        logRoles: getCheck('logRoles'),
        logChannels: getCheck('logChannels'),
        logBans: getCheck('logBans'),
        // Auto-Role
        autoroleEnabled: getCheck('toggleAutorole'),
        autoroleIds: JSON.stringify(autoRoles),
        // Counting
        countingEnabled: getCheck('toggleCounting'),
        countingChannel: getVal('countingChannel'),
        countingCurrent: parseInt(getVal('countingCurrent')) || 0,
        countingSameUser: getCheck('countingSameUser'),
        countingReset: getCheck('countingReset'),
        countingMath: getCheck('countingMath'),
        // Server Stats
        serverStatsEnabled: getCheck('toggleServerStats'),
        statsTotalMembers: getCheck('statsTotalMembers'),
        statsOnline: getCheck('statsOnline'),
        statsBots: getCheck('statsBots'),
        statsChannels: getCheck('statsChannels'),
        statsCategoryId: getVal('statsCategoryId'),
        // Anti-Nuke
        antinukeEnabled: getCheck('toggleAntinuke'),
        antinukeBan: getCheck('antinukeBan'),
        antinukeChannel: getCheck('antinukeChannel'),
        antinukeRole: getCheck('antinukeRole'),
        antinukeWebhook: getCheck('antinukeWebhook'),
        antinukeThreshold: parseInt(getVal('antinukeThreshold')) || 5,
        antinukeWhitelist: getVal('antinukeWhitelist'),
        // R4 Tracking
        r4TrackingEnabled: getCheck('toggleR4Tracking'),
        r4TrackingRole: getVal('r4TrackingRole'),
        r4TrackingAdQuota: parseInt(getVal('r4TrackingAdQuota')) || 40,
        r4TrackingMsgQuota: parseInt(getVal('r4TrackingMsgQuota')) || 245
    };

    try {
        const res = await fetch(`${API_URL}/modules/${activeGuild.id}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        if (res.ok) {
            showToast(`✅ ${moduleName} config saved!`);
        }
    } catch (e) {
        showToast(`❌ Error saving ${moduleName}`, true);
    }
}

// ===== TOAST NOTIFICATIONS =====
function showToast(msg, isError = false) {
    const toast = document.createElement('div');
    toast.style.cssText = `position:fixed;bottom:24px;right:24px;background:${isError ? 'var(--accent-red)' : 'var(--accent-green)'};color:white;padding:12px 24px;border-radius:var(--radius-md);font-weight:600;font-size:0.9rem;z-index:999;animation:fadeIn 0.3s ease;box-shadow:0 4px 20px rgba(0,0,0,0.3);`;
    toast.textContent = msg;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
}

// ===== AUTO-ROLE =====
let autoRoles = [];

function addAutoRole() {
    const val = getVal('autoRoleInput');
    if (!val) return;
    autoRoles.push(val);
    document.getElementById('autoRoleInput').value = '';
    renderAutoRoles(autoRoles);
}

function removeAutoRole(index) {
    autoRoles.splice(index, 1);
    renderAutoRoles(autoRoles);
}

function renderAutoRoles(roles) {
    autoRoles = roles;
    const list = document.getElementById('autoRoleList');
    if (roles.length === 0) {
        list.innerHTML = '<div class="empty-state"><div class="empty-icon">🏷️</div><p>No auto-roles configured.</p></div>';
        return;
    }
    list.innerHTML = roles.map((r, i) => `
        <div class="panel-item">
            <div class="panel-item-info">
                <span class="panel-item-dot"></span>
                <span>Role ID: <strong>${r}</strong></span>
            </div>
            <button class="z-btn z-btn-danger" onclick="removeAutoRole(${i})">Remove</button>
        </div>
    `).join('');
}

// ===== LEVEL MILESTONES (Inline Table Rows) =====
let levelMilestones = [];

function addLevelMilestone() {
    levelMilestones.push({ level: '', emoji: '', title: '', roleId: '' });
    renderMilestones();
}

function removeMilestone(i) {
    levelMilestones.splice(i, 1);
    renderMilestones();
}

function updateMilestone(i, field, val) {
    levelMilestones[i][field] = val;
}

function renderMilestones() {
    const list = document.getElementById('levelMilestonesList');
    if (levelMilestones.length === 0) {
        list.innerHTML = '<div class="empty-state"><div class="empty-icon">🎖️</div><p>No milestones configured. Click + ADD NEW above.</p></div>';
        return;
    }
    list.innerHTML = levelMilestones.map((m, i) => `
        <div style="display:grid; grid-template-columns: 80px 120px 1fr 1fr 40px; gap:10px; align-items:center; padding:6px 0; border-bottom:1px solid var(--border-subtle);">
            <input class="z-input" type="number" value="${m.level}" placeholder="10" min="1" onchange="updateMilestone(${i},'level',this.value)" style="padding:8px; text-align:center; font-weight:700;">
            <input class="z-input" type="text" value="${m.emoji}" placeholder="✨ or <:id>" onchange="updateMilestone(${i},'emoji',this.value)" style="padding:8px; font-size:0.8rem;">
            <input class="z-input" type="text" value="${m.title}" placeholder="Bronze Age" onchange="updateMilestone(${i},'title',this.value)" style="padding:8px;">
            <input class="z-input" type="text" value="${m.roleId}" placeholder="@ · >> Role Name" onchange="updateMilestone(${i},'roleId',this.value)" style="padding:8px; font-size:0.8rem;">
            <button class="z-btn z-btn-danger" style="padding:6px; font-size:0.7rem; width:32px; height:32px; display:flex; align-items:center; justify-content:center;" onclick="removeMilestone(${i})">✕</button>
        </div>
    `).join('');
}

// ===== VIP MULTIPLIERS =====
let vipMultipliers = [];

function addVipMultiplier() {
    vipMultipliers.push({ type: 'ROLE', value: '', multiplier: '1.5' });
    renderVipMultipliers();
}

function removeVipMultiplier(i) {
    vipMultipliers.splice(i, 1);
    renderVipMultipliers();
}

function updateVipMultiplier(i, field, val) {
    vipMultipliers[i][field] = val;
}

function renderVipMultipliers() {
    const list = document.getElementById('vipMultipliersList');
    if (vipMultipliers.length === 0) {
        list.innerHTML = '<div class="empty-state"><p style="font-size:0.82rem;">No VIP multipliers configured.</p></div>';
        return;
    }
    list.innerHTML = vipMultipliers.map((m, i) => `
        <div style="display:grid; grid-template-columns: 80px 1fr 100px 40px; gap:10px; align-items:center; padding:6px 0; border-bottom:1px solid var(--border-subtle);">
            <select class="z-input" onchange="updateVipMultiplier(${i},'type',this.value)" style="padding:8px; font-size:0.8rem;">
                <option value="ROLE" ${m.type==='ROLE'?'selected':''}>ROLE</option>
                <option value="USER" ${m.type==='USER'?'selected':''}>USER</option>
            </select>
            <input class="z-input" type="text" value="${m.value}" placeholder="Role or User ID" onchange="updateVipMultiplier(${i},'value',this.value)" style="padding:8px;">
            <input class="z-input" type="text" value="${m.multiplier}" placeholder="1.5" onchange="updateVipMultiplier(${i},'multiplier',this.value)" style="padding:8px; text-align:center; font-weight:700;">
            <button class="z-btn z-btn-danger" style="padding:6px; font-size:0.7rem; width:32px; height:32px; display:flex; align-items:center; justify-content:center;" onclick="removeVipMultiplier(${i})">✕</button>
        </div>
    `).join('');
}

// ===== DISCORD PREVIEW (for Ticket Panel) =====
function formatDiscordText(text) {
    if (!text) return '';
    // Custom Emojis <:name:id> -> Icon
    let html = text.replace(/<a?:(\w+):(\d+)>/g, '<span class="discord-emoji-placeholder" title="$1"></span>');
    
    // Basic Markdown
    html = html.replace(/^# (.*$)/gim, '<h3>$1</h3>');
    html = html.replace(/^## (.*$)/gim, '<h4>$1</h4>');
    html = html.replace(/\*\*(.*?)\*\*/g, '<b>$1</b>');
    html = html.replace(/\*(.*?)\*/g, '<i>$1</i>');
    html = html.replace(/__(.*?)__/g, '<u>$1</u>');
    
    // Newlines
    html = html.replace(/\n/g, '<br>');
    return html;
}

function updatePanelPreview() {
    const titleVal = getVal('panelTitle') || 'Support Center';
    const emojiVal = getVal('panelEmoji') || '';
    const descVal = getVal('panelDescription') || 'Please select a category below to open a ticket...';
    const descEmojiVal = getVal('panelDescEmoji') || '';
    const color = getVal('panelColor') || '#a855f7';

    const fullTitle = (emojiVal ? emojiVal + ' ' : '') + titleVal;
    const fullDesc = (descEmojiVal ? descEmojiVal + ' ' : '') + descVal;

    document.getElementById('previewTitle').innerHTML = formatDiscordText(fullTitle);
    document.getElementById('previewDesc').innerHTML = formatDiscordText(fullDesc);
    document.getElementById('previewColorBar').style.background = color;

    // Update select menu previews
    const menusContainer = document.getElementById('previewMenus');
    if (panelDraft.dropdowns.length === 0) {
        menusContainer.innerHTML = '<div style="background:#1e1f22;border:1px solid #3f4147;border-radius:4px;padding:8px 12px;font-size:0.82rem;color:#949ba4;">Select an option...</div>';
    } else {
        menusContainer.innerHTML = panelDraft.dropdowns.map(dd =>
            `<div style="background:#1e1f22;border:1px solid #3f4147;border-radius:4px;padding:8px 12px;font-size:0.82rem;color:#949ba4;margin-bottom:4px;">${dd.placeholder || 'Select an option...'}</div>`
        ).join('');
    }
}

// =============================================
// TICKET PANELS & TRANSCRIPTS
// =============================================
let panelDraft = { dropdowns: [], buttonRows: [] };

function addDropdown() {
    panelDraft.dropdowns.push({ id: Date.now().toString(), placeholder: 'Select an option...', options: [] });
    renderDropdowns();
}


function addButtonRow() {
    if (!panelDraft.buttonRows) panelDraft.buttonRows = [];
    if (panelDraft.dropdowns.length + panelDraft.buttonRows.length >= 5) return showToast('Discord limits to 5 component rows max', true);
    panelDraft.buttonRows.push({ id: Date.now().toString(), options: [] });
    renderDropdowns();
}

function addBtnOption(rIdx) {
    if (panelDraft.buttonRows[rIdx].options.length >= 5) return showToast('Discord limits to 5 buttons per row', true);
    panelDraft.buttonRows[rIdx].options.push({
        label: 'New Button',
        emoji: '🎫',
        description: 'Open a general support ticket.',
        ticketName: 'ticket-{username}',
        embedTitle: 'Welcome to Support',
        embedDescription: 'Please wait, staff will be with you shortly.',
        systemType: 'ticket',
        staffRoles: '',
        pingRoles: '',
        questions: [],
        questionDelivery: 'modal',
        buttonStyle: 'Primary'
    });
    renderDropdowns();
}

function removeBtnRow(rIdx) {
    panelDraft.buttonRows.splice(rIdx, 1);
    renderDropdowns();
}

function removeBtnOption(rIdx, oIdx) {
    panelDraft.buttonRows[rIdx].options.splice(oIdx, 1);
    renderDropdowns();
}

function updateBtnField(rIdx, oIdx, field, val) {
    panelDraft.buttonRows[rIdx].options[oIdx][field] = val;
}

function addOption(dIdx) {
    panelDraft.dropdowns[dIdx].options.push({
        label: 'New Option',
        emoji: '🎫',
        description: 'Open a general support ticket.',
        ticketName: 'ticket-{username}',
        embedTitle: 'Welcome to Support',
        embedDescription: 'Please wait, staff will be with you shortly.',
        systemType: 'ticket',
        staffRoles: '',
        pingRoles: '',
        questions: [],
        questionDelivery: 'modal'
    });
    renderDropdowns();
}

function addQuestion(dIdx, oIdx) {
    panelDraft.dropdowns[dIdx].options[oIdx].questions.push('');
    renderDropdowns();
}

function updateField(dIdx, oIdx, field, val) {
    if (oIdx === null) {
        panelDraft.dropdowns[dIdx].placeholder = val;
    } else {
        panelDraft.dropdowns[dIdx].options[oIdx][field] = val;
    }
}

function updateQuestion(dIdx, oIdx, qIdx, field, val) {
    const opt = currentModalTarget.isBtn ? panelDraft.buttonRows[dIdx].options[oIdx] : panelDraft.dropdowns[dIdx].options[oIdx];
    if (typeof opt.questions[qIdx] === 'string') {
        opt.questions[qIdx] = { text: opt.questions[qIdx], type: 'text' };
    }
    opt.questions[qIdx][field] = val;
    if (field === 'type') renderModalQuestions();
}

function clearPanelForm() {
    editingPanelId = null;
    editingMessageId = null;
    
    const saveBtn = document.querySelector('button[onclick="savePanel()"]');
    if (saveBtn) {
        saveBtn.innerHTML = '<i class="fas fa-satellite-dish"></i> Compile & Deploy Panel';
        saveBtn.classList.remove('z-btn-danger');
    }

    panelDraft = { dropdowns: [], buttonRows: [] };
    document.getElementById('panelChannelId').value = '';
    document.getElementById('panelTitle').value = '';
    document.getElementById('panelEmoji').value = '';
    document.getElementById('panelDescription').value = '';
    document.getElementById('panelDescEmoji').value = '';
    document.getElementById('panelColor').value = '#ffd700';
    document.getElementById('panelColorHex').textContent = '#ffd700';
    
    renderDropdowns();
    showToast('Form cleared and reset to fresh state.');
}

function removeDropdown(dIdx) {
    panelDraft.dropdowns.splice(dIdx, 1);
    renderDropdowns();
}

function removeOption(dIdx, oIdx) {
    panelDraft.dropdowns[dIdx].options.splice(oIdx, 1);
    renderDropdowns();
}

function removeQuestion(dIdx, oIdx, qIdx) {
    panelDraft.dropdowns[dIdx].options[oIdx].questions.splice(qIdx, 1);
    renderDropdowns();
}

function renderDropdowns() {
    const c = document.getElementById('dropdownsContainer');
    c.innerHTML = '';

    
    // Render Button Rows
    const btnRows = panelDraft.buttonRows || [];
    btnRows.forEach((br, rIdx) => {
        const wrap = document.createElement('div');
        wrap.style.background = 'rgba(255,255,255,0.01)';
        wrap.style.border = '1px solid var(--border-medium)';
        wrap.style.borderRadius = 'var(--radius-lg)';
        wrap.style.marginBottom = '20px';
        wrap.style.overflow = 'hidden';

        let optionsHtml = '';
        br.options.forEach((opt, oIdx) => {
            optionsHtml += `
                <div style="display:flex; align-items:center; justify-content:space-between; padding:16px 20px; background:var(--bg-card); border-bottom:1px solid var(--border-subtle);">
                    <div style="display:flex; align-items:center; gap:16px; flex:1;">
                        <span style="color:var(--text-muted); cursor:grab;">☰</span>
                        <div style="display:flex; align-items:center; justify-content:center; width:36px; height:36px; background:var(--accent-cyan); color:black; border-radius:var(--radius-md); font-size:1.2rem;">${opt.emoji || '🎫'}</div>
                        <div style="flex:1;">
                            <h4 style="font-size:0.95rem; font-weight:600; margin-bottom:4px; color:var(--text-primary); display:flex; align-items:center; gap:8px;">
                                <input class="z-input" style="padding:4px 8px; font-weight:600; font-size:0.9rem; background:transparent; border:none; border-bottom:1px dashed var(--border-medium); width:200px;" value="${opt.label}" onchange="updateBtnField(${rIdx},${oIdx},'label',this.value)" placeholder="Button Label">
                            </h4>
                        </div>
                    </div>
                    <div style="display:flex; gap:12px;">
                        <button style="background:transparent; border:none; font-size:1.1rem; color:var(--text-muted); cursor:pointer;" onclick="openOptionSettings(${rIdx}, ${oIdx}, true)">⚙️</button>
                        <button style="background:transparent; border:none; font-size:1.1rem; color:var(--text-muted); cursor:pointer;" onclick="removeBtnOption(${rIdx},${oIdx})">🗑️</button>
                    </div>
                </div>`;
        });

        optionsHtml += `
            <div style="padding:14px; text-align:center;">
                <button class="z-btn" style="width:100%; border:1px dashed var(--border-medium); background:rgba(255,255,255,0.015); color:var(--text-muted); font-size:0.85rem;" onclick="addBtnOption(${rIdx})">+ Add Button</button>
            </div>
        `;

        wrap.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:center; padding:12px 20px; background:rgba(255,255,255,0.03); border-bottom:1px solid var(--border-subtle);">
                <div style="display:flex; align-items:center; gap:12px; color:var(--text-muted); font-size:0.8rem; font-weight:600; text-transform:uppercase; letter-spacing:0.5px;">
                    <span style="cursor:grab;">☰</span>
                    <span style="color:var(--accent-cyan);">▶️ BUTTON ROW</span>
                </div>
                <button style="background:transparent; border:none; font-size:1.1rem; color:var(--text-muted); cursor:pointer;" onclick="removeBtnRow(${rIdx})">🗑️</button>
            </div>
            ${optionsHtml}
        `;
        c.appendChild(wrap);
    });

    panelDraft.dropdowns.forEach((dd, dIdx) => {
        const wrap = document.createElement('div');
        // Main container matching the UI
        wrap.style.background = 'rgba(255,255,255,0.01)';
        wrap.style.border = '1px solid var(--border-medium)';
        wrap.style.borderRadius = 'var(--radius-lg)';
        wrap.style.marginBottom = '20px';
        wrap.style.overflow = 'hidden';

        // Select Menu Header
        let optionsHtml = '';
        dd.options.forEach((opt, oIdx) => {
            optionsHtml += `
                <div style="display:flex; align-items:center; justify-content:space-between; padding:16px 20px; background:var(--bg-card); border-bottom:1px solid var(--border-subtle);">
                    <div style="display:flex; align-items:center; gap:16px; flex:1;">
                        <span style="color:var(--text-muted); cursor:grab;">☰</span>
                        <div style="display:flex; align-items:center; justify-content:center; width:36px; height:36px; background:var(--primary-soft); border-radius:var(--radius-md); font-size:1.2rem;">${opt.emoji || '🎫'}</div>
                        <div style="flex:1;">
                            <h4 style="font-size:0.95rem; font-weight:600; margin-bottom:4px; color:var(--text-primary); display:flex; align-items:center; gap:8px;">
                                <input class="z-input" style="padding:4px 8px; font-weight:600; font-size:0.9rem; background:transparent; border:none; border-bottom:1px dashed var(--border-medium); width:200px;" value="${opt.label}" onchange="updateField(${dIdx},${oIdx},'label',this.value)" placeholder="Label (e.g. Support Ticket)">
                            </h4>
                            <input class="z-input" style="padding:2px 8px; font-size:0.75rem; background:transparent; border:none; width:80%; color:var(--text-secondary);" value="${opt.description || ''}" onchange="updateField(${dIdx},${oIdx},'description',this.value)" placeholder="Description (e.g. Open a general support ticket.)">
                        </div>
                    </div>
                    <div style="display:flex; gap:12px;">
                        <button style="background:transparent; border:none; font-size:1.1rem; color:var(--text-muted); cursor:pointer; transition:var(--transition);" onmouseover="this.style.color='var(--primary)'" onmouseout="this.style.color='var(--text-muted)'" onclick="openOptionSettings(${dIdx}, ${oIdx})">⚙️</button>
                        <button style="background:transparent; border:none; font-size:1.1rem; color:var(--text-muted); cursor:pointer; transition:var(--transition);" onmouseover="this.style.color='var(--accent-red)'" onmouseout="this.style.color='var(--text-muted)'" onclick="removeOption(${dIdx},${oIdx})">🗑️</button>
                    </div>
                </div>`;
        });

        // Add Option Button
        optionsHtml += `
            <div style="padding:14px; text-align:center;">
                <button class="z-btn" style="width:100%; border:1px dashed var(--border-medium); background:rgba(255,255,255,0.015); color:var(--text-muted); font-size:0.85rem;" onclick="addOption(${dIdx})">+ Add Option</button>
            </div>
        `;

        wrap.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:center; padding:12px 20px; background:rgba(255,255,255,0.03); border-bottom:1px solid var(--border-subtle);">
                <div style="display:flex; align-items:center; gap:12px; color:var(--text-muted); font-size:0.8rem; font-weight:600; text-transform:uppercase; letter-spacing:0.5px;">
                    <span style="cursor:grab;">☰</span>
                    <span>📑 SELECT MENU</span>
                </div>
                <button style="background:transparent; border:none; font-size:1.1rem; color:var(--text-muted); cursor:pointer; transition:var(--transition);" onmouseover="this.style.color='var(--accent-red)'" onmouseout="this.style.color='var(--text-muted)'" onclick="removeDropdown(${dIdx})">🗑️</button>
            </div>
            <div style="padding:16px 20px; border-bottom:1px solid var(--border-subtle);">
                <label style="display:block; font-size:0.65rem; color:var(--text-muted); text-transform:uppercase; font-weight:700; margin-bottom:8px; letter-spacing:0.5px;">Select Menu Placeholder</label>
                <input class="z-input" style="width:100%; border-color:var(--border-strong);" value="${dd.placeholder}" onchange="updateField(${dIdx},null,'placeholder',this.value)">
            </div>
            ${optionsHtml}
        `;
        c.appendChild(wrap);
    });

    // Sync Discord preview
    updatePanelPreview();
}

// ===== MODAL LOGIC =====
let currentModalTarget = null; // { dIdx, oIdx }

function openOptionSettings(dIdx, oIdx, isBtn = false) {
    const opt = isBtn ? panelDraft.buttonRows[dIdx].options[oIdx] : panelDraft.dropdowns[dIdx].options[oIdx];
    currentModalTarget = { dIdx, oIdx, isBtn };
    
    document.getElementById('modalOptionTitle').textContent = opt.label;
    setVal('modalSystemType', opt.systemType || 'ticket');
    
    // Clean prefix for input: e.g. "ticket-{username}" -> "ticket"
    let prefix = (opt.ticketName || 'ticket-').replace('{username}', '');
    if (prefix.endsWith('-')) prefix = prefix.slice(0, -1);
    setVal('modalChannelPrefix', prefix);
    setVal('modalStaffRoles', opt.staffRoles || '');
    setVal('modalPingRoles', opt.pingRoles || '');
    setVal('modalCategoryId', opt.categoryId || '');
    setVal('modalOptionEmoji', opt.emoji || '');
    setVal('modalEmbedDesc', opt.embedDescription || 'Please wait, staff will be with you shortly.');
    setVal('modalQuestionDelivery', opt.questionDelivery || 'modal');
    setVal('modalImageUrl', opt.imageUrl || '');
    setCheck('modalUseEmbed', opt.useEmbed === undefined || opt.useEmbed === null ? true : !!opt.useEmbed);
    
    renderModalQuestions();
    
    document.getElementById('optionSettingsModal').classList.add('active');
}

function renderModalQuestions() {
    if (!currentModalTarget) return;
    const opt = currentModalTarget.isBtn ? panelDraft.buttonRows[currentModalTarget.dIdx].options[currentModalTarget.oIdx] : panelDraft.dropdowns[currentModalTarget.dIdx].options[currentModalTarget.oIdx];
    const qc = document.getElementById('modalQuestionsContainer');
    
    if (!opt.questions || opt.questions.length === 0) {
        qc.innerHTML = '<div style="font-size:0.8rem; color:var(--text-muted); font-style:italic;">No questions configured. Click Add Question.</div>';
        return;
    }
    
    qc.innerHTML = opt.questions.map((q, qIdx) => {
        // Migration: convert string to object if needed
        const obj = typeof q === 'string' ? { text: q, type: 'text' } : q;
        if (typeof q === 'string') opt.questions[qIdx] = obj;

        return `
        <div style="background:rgba(255,255,255,0.02); border:1px solid var(--border-subtle); border-radius:var(--radius-md); padding:12px; margin-bottom:12px;">
            <div style="display:flex; gap:8px; align-items:center; margin-bottom:8px;">
                <textarea class="z-input" placeholder="Question text (supports multiple lines)..." onchange="updateQuestion(${currentModalTarget.dIdx},${currentModalTarget.oIdx},${qIdx},'text',this.value)" style="flex:1; min-height:80px; resize:vertical; padding:10px; font-family:inherit;">${obj.text}</textarea>
                <select class="z-input" style="width:100px; font-size:0.75rem;" onchange="updateQuestion(${currentModalTarget.dIdx},${currentModalTarget.oIdx},${qIdx},'type',this.value)">
                    <option value="text" ${obj.type === 'text' ? 'selected' : ''}>Text</option>
                    <option value="choice" ${obj.type === 'choice' ? 'selected' : ''}>Choice</option>
                    <option value="image" ${obj.type === 'image' ? 'selected' : ''}>Image</option>
                    <option value="text_image" ${obj.type === 'text_image' ? 'selected' : ''}>Text+Image</option>
                </select>
                <div style="display:flex; flex-direction:column; align-items:center;">
                    <label style="font-size:0.55rem; color:var(--text-muted); margin-bottom:2px;">REQUIRED</label>
                    <input type="checkbox" ${obj.required ? 'checked' : ''} onchange="updateQuestion(${currentModalTarget.dIdx},${currentModalTarget.oIdx},${qIdx},'required',this.checked)">
                </div>
                <button class="z-btn z-btn-danger" style="padding:6px; font-size:0.75rem;" onclick="removeModalQuestion(${qIdx})">✕</button>
            </div>
            ${obj.type === 'choice' ? `
                <div style="margin-top:8px;">
                    <label style="font-size:0.65rem; color:var(--text-muted); text-transform:uppercase;">Options (comma separated)</label>
                    <input class="z-input" style="font-size:0.8rem;" value="${obj.options || ''}" placeholder="Option A, Option B, ..." onchange="updateQuestion(${currentModalTarget.dIdx},${currentModalTarget.oIdx},${qIdx},'options',this.value)">
                </div>
            ` : ''}
        </div>
        `;
    }).join('');
}

function addModalQuestion() {
    if (!currentModalTarget) return;
    const { dIdx, oIdx, isBtn } = currentModalTarget;
    const opt = isBtn ? panelDraft.buttonRows[dIdx].options[oIdx] : panelDraft.dropdowns[dIdx].options[oIdx];
    
    const deliveryMethod = getVal('modalQuestionDelivery');
    if (deliveryMethod === 'modal' && opt.questions && opt.questions.length >= 5) {
        return showToast('Discord Modals are strictly limited to 5 questions maximum.', true);
    }
    
    if (!opt.questions) opt.questions = [];
    opt.questions.push('');
    renderModalQuestions();
}

function removeModalQuestion(qIdx) {
    if (!currentModalTarget) return;
    const { dIdx, oIdx, isBtn } = currentModalTarget;
    const opt = isBtn ? panelDraft.buttonRows[dIdx].options[oIdx] : panelDraft.dropdowns[dIdx].options[oIdx];
    opt.questions.splice(qIdx, 1);
    renderModalQuestions();
}

function saveOptionSettings() {
    if (!currentModalTarget) return;
    const { dIdx, oIdx, isBtn } = currentModalTarget;
    const opt = isBtn ? panelDraft.buttonRows[dIdx].options[oIdx] : panelDraft.dropdowns[dIdx].options[oIdx];
    
    const deliveryMethod = getVal('modalQuestionDelivery');
    if (deliveryMethod === 'modal' && opt.questions && opt.questions.length > 5) {
        return showToast('Discord Modals only support 5 questions. Please remove some or change delivery method.', true);
    }
    
    opt.systemType = getVal('modalSystemType');
    
    let prefix = getVal('modalChannelPrefix').trim();
    if (prefix && !prefix.endsWith('-')) prefix += '-';
    opt.ticketName = (prefix || 'ticket-') + '{username}';
    
    opt.staffRoles = getVal('modalStaffRoles');
    opt.pingRoles = getVal('modalPingRoles');
    opt.categoryId = getVal('modalCategoryId');
    opt.emoji = getVal('modalOptionEmoji');
    opt.embedDescription = getVal('modalEmbedDesc');
    opt.questionDelivery = getVal('modalQuestionDelivery');
    opt.imageUrl = getVal('modalImageUrl');
    opt.useEmbed = document.getElementById('modalUseEmbed').checked ? 1 : 0;
    
    closeModal('optionSettingsModal');
    renderDropdowns();
}

async function savePanel() {
    if (!activeGuild) return;
    const channelId = getVal('panelChannelId');
    if (!channelId) return showToast('Destination Channel ID is required', true);

    try {
        const res = await fetch(`${API_URL}/panels/${activeGuild.id}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                id: editingPanelId,
                messageId: editingMessageId,
                channelId,
                panelData: {
                    title: getVal('panelTitle') || 'Support',
                    emoji: getVal('panelEmoji'),
                    description: getVal('panelDescription') || 'Open a ticket...',
                    descEmoji: getVal('panelDescEmoji'),
                    color: getVal('panelColor'),
                    imageUrl: getVal('panelImageUrl'),
                    useEmbed: document.getElementById('panelUseEmbed').checked ? 1 : 0,
                    dropdowns: panelDraft.dropdowns,
                    buttonRows: panelDraft.buttonRows
                }
            })
        });
        if (res.ok) {
            showToast('✅ Panel successfully updated!');
            editingPanelId = null;
            editingMessageId = null;
            
            const saveBtn = document.querySelector('button[onclick="savePanel()"]');
            if (saveBtn) {
                saveBtn.innerHTML = '<i class="fas fa-satellite-dish"></i> Compile & Deploy Panel';
                saveBtn.classList.remove('z-btn-danger');
            }

            panelDraft.dropdowns = []; panelDraft.buttonRows = [];
            renderDropdowns();
            document.getElementById('panelChannelId').value = '';
            document.getElementById('panelTitle').value = '';
            document.getElementById('panelEmoji').value = '';
            document.getElementById('panelDescription').value = '';
            document.getElementById('panelDescEmoji').value = '';
            fetchPanels();
        }
    } catch (e) {
        showToast('Error saving panel', true);
    }
}

async function fetchPanels() {
    if (!activeGuild) return;
    try {
        const res = await fetch(`${API_URL}/panels/${activeGuild.id}`);
        const panels = await res.json();
        const c = document.getElementById('panelsList');

        // Update stat
        const statEl = document.getElementById('statPanels');
        if (statEl) statEl.textContent = panels.length;

        if (panels.length === 0) {
            c.innerHTML = '<div class="empty-state"><div class="empty-icon">📭</div><p>No panels created yet.</p></div>';
            return;
        }

        c.innerHTML = panels.map(p => {
            const data = typeof p.panelData === 'string' ? JSON.parse(p.panelData) : p.panelData;
            return `
                <div class="panel-item">
                    <div class="panel-item-info">
                        <span class="panel-item-dot"></span>
                        <div>
                            <strong>${data.title || 'Panel'}</strong>
                            <br><small style="color:var(--text-muted);">Channel: ${p.channelId} · ${(data.dropdowns || []).length} Dropdowns</small>
                        </div>
                    </div>
                    </div>
                    <div style="display:flex; gap:8px;">
                        <button class="z-btn z-btn-secondary" onclick="editPanel('${p.id}')">⚙️ Edit</button>
                        <button class="z-btn z-btn-danger" onclick="deletePanel('${p.id}')">🗑️ Delete</button>
                    </div>
                </div>`;
        }).join('');
    } catch (e) { console.error(e); }
}

async function deletePanel(id) {
    if (!confirm('Delete this panel permanently?')) return;
    await fetch(`${API_URL}/panels/${id}`, { method: 'DELETE' });
    fetchPanels();
}

async function fetchTranscripts() {
    if (!activeGuild) return;
    try {
        const res = await fetch(`${API_URL}/transcripts/${activeGuild.id}`);
        const ts = await res.json();

        // Tickets page
        const c = document.getElementById('transcriptsList');
        // Overview page
        const ov = document.getElementById('overviewTranscripts');

        if (ts.length === 0) {
            const empty = '<div class="empty-state"><div class="empty-icon">📭</div><p>No recent transcripts.</p></div>';
            if (c) c.innerHTML = empty;
            if (ov) ov.innerHTML = empty;
            return;
        }

        const html = ts.slice(0, 10).map(t => `
            <div class="panel-item">
                <div class="panel-item-info">
                    <span class="panel-item-dot" style="background:var(--accent-green);box-shadow:0 0 8px var(--accent-green);"></span>
                    <div>
                        <strong>🎫 ${t.ticketId}</strong>
                        <br><small style="color:var(--text-muted);">Author: ${t.userId} · ${new Date(t.closedAt).toLocaleString()}</small>
                    </div>
                </div>
                <button class="z-btn z-btn-secondary" onclick="viewTranscript('${encodeURIComponent(t.logContent || '')}')">View</button>
            </div>`).join('');

        if (c) c.innerHTML = html;
        if (ov) ov.innerHTML = html;
    } catch (e) { console.error(e); }
}

function viewTranscript(encoded) {
    document.getElementById('transcriptModal').classList.add('active');
    document.getElementById('transcriptContent').textContent = decodeURIComponent(encoded) || 'This transcript is empty.';
}

// ===== SAVE BAR (Unsaved Changes Detection) =====
let currentPage = 'overview';

document.addEventListener('input', (e) => {
    if (e.target.closest('.main-content')) {
        document.getElementById('saveBar').classList.add('visible');
    }
});

document.addEventListener('change', (e) => {
    if (e.target.closest('.main-content')) {
        document.getElementById('saveBar').classList.add('visible');
    }
});

document.querySelectorAll('.sidebar-link').forEach(link => {
    link.addEventListener('click', () => {
        currentPage = link.dataset.page;
        document.getElementById('saveBar').classList.remove('visible');
        // Auto-close sidebar on mobile
        if (window.innerWidth <= 768) {
            toggleMobileSidebar();
        }
    });
});

// Mobile sidebar toggle
function toggleMobileSidebar() {
    const sidebar = document.querySelector('.sidebar');
    const overlay = document.getElementById('sidebarOverlay');
    sidebar.classList.toggle('active');
    overlay.classList.toggle('active');
}

function revertChanges() {
    document.getElementById('saveBar').classList.remove('visible');
    loadDashboardData();
    showToast('Changes reverted');
}

function saveCurrentPage() {
    // Determine which page is active and save accordingly
    const page = currentPage;
    if (page === 'general') {
        saveGeneralConfig();
    } else {
        saveModuleConfig(page);
    }
    document.getElementById('saveBar').classList.remove('visible');
}

// ===== GIVEAWAYS =====
async function startGiveaway() {
    if (!activeGuild) return;
    const channelId = getVal('gvChannelId');
    const prize = getVal('gvPrize');
    const winners = parseInt(getVal('gvWinners'), 10);
    const duration = parseFloat(getVal('gvDuration'));
    const color = getVal('gvColor');
    const requiredRole = getVal('gvRequiredRole');
    const pingRole = getVal('gvPingRole');

    if (!channelId || !prize || !winners || !duration) {
        return showToast('Please fill out all giveaway fields.', true);
    }

    try {
        const res = await fetch(`${API_URL}/giveaways/${activeGuild.id}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                channelId, prize, winnersCount: winners, durationMs: duration * 3600000, color, requiredRole, pingRole
            })
        });
        if (res.ok) {
            showToast('✅ Giveaway launched!');
            document.getElementById('gvPrize').value = '';
            document.getElementById('gvRequiredRole').value = '';
            document.getElementById('gvPingRole').value = '';
            fetchGiveaways();
        } else {
            showToast('Failed to start giveaway', true);
        }
    } catch(e) {
        showToast('Error starting giveaway', true);
    }
}

async function fetchGiveaways() {
    if (!activeGuild) return;
    try {
        const res = await fetch(`${API_URL}/giveaways/${activeGuild.id}`);
        const giveaways = await res.json();
        const c = document.getElementById('giveawaysList');

        if (!giveaways || giveaways.length === 0) {
            if (c) c.innerHTML = '<div class="empty-state"><div class="empty-icon">🎉</div><p>No giveaways found.</p></div>';
            return;
        }

        if (c) {
            c.innerHTML = giveaways.map(gv => {
                const isActive = gv.status === 'active';
                const statusDot = isActive ? 'background:var(--accent-green);box-shadow:0 0 8px var(--accent-green);' : 'background:var(--text-muted);';
                const endsAt = new Date(parseInt(gv.endTime)).toLocaleString();
                
                return `
                <div class="panel-item">
                    <div class="panel-item-info">
                        <span class="panel-item-dot" style="${statusDot}"></span>
                        <div>
                            <strong>${gv.prize}</strong>
                            <br><small style="color:var(--text-muted);">Channel: ${gv.channelId} · Winners: ${gv.winnersCount} · Ends: ${endsAt}</small>
                        </div>
                    </div>
                    <span style="font-size:0.75rem; font-weight:bold; color:${isActive?'var(--accent-green)':'var(--text-muted)'}">${isActive ? 'ACTIVE' : 'ENDED'}</span>
                </div>`;
            }).join('');
        }
    } catch (e) { console.error('Error fetching giveaways', e); }
}
// ===== TRANSCRIPT VIEWER =====
async function fetchTranscripts() {
    if (!activeGuild) return;
    const tbody = document.getElementById('transcriptsTableBody');
    tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; padding: 40px; color:var(--text-muted);">Retrieving transmission logs...</td></tr>';
    
    try {
        const res = await fetch(`${API_URL}/transcripts/${activeGuild.id}`);
        const logs = await res.json();
        
        if (logs.length === 0) {
            tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; padding: 40px; color:var(--text-muted);">Secure archives empty.</td></tr>';
            return;
        }

        tbody.innerHTML = '';
        logs.forEach(log => {
            const row = document.createElement('tr');
            row.innerHTML = `
                <td><code>${log.ticketId}</code></td>
                <td><span class="z-badge">${log.userId}</span></td>
                <td>${new Date(log.closedAt).toLocaleString()}</td>
                <td>
                    <button class="z-btn z-btn-secondary z-btn-sm" onclick="viewTranscript('${log.ticketId}')">
                        <i class="fas fa-eye"></i> View Log
                    </button>
                </td>
            `;
            tbody.appendChild(row);
        });
    } catch (e) {
        tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; padding: 40px; color:var(--accent-red);">Error accessing archives.</td></tr>';
    }
}

async function viewTranscript(ticketId) {
    const overlay = document.getElementById('transcriptOverlay');
    const container = document.getElementById('discordChatContainer');
    const title = document.getElementById('viewerTicketTitle');
    
    title.textContent = `Viewing Log: ${ticketId}`;
    container.innerHTML = '<div style="color:var(--text-muted); text-align:center; margin-top:100px;">Decrypting transmission...</div>';
    overlay.style.display = 'flex';

    try {
        const res = await fetch(`${API_URL}/transcripts/${activeGuild.id}/${ticketId}`);
        const data = await res.json();
        
        renderTranscript(data.content);
    } catch (e) {
        container.innerHTML = '<div style="color:var(--accent-red); text-align:center; margin-top:100px;">Decryption Failed.</div>';
    }
}

function renderTranscript(rawContent) {
    const container = document.getElementById('discordChatContainer');
    container.innerHTML = '';

    // Zenith transcript format: [Date, Time] Author: \n Content \n ------------------
    const messages = rawContent.split('---------------------------');
    
    messages.forEach(msgBlock => {
        if (!msgBlock.trim()) return;

        // Extract metadata and body
        // Format: [1/1/2026, 12:00:00 AM] Author: \n Content
        const match = msgBlock.match(/\[(.*?)\] (.*?):\n([\s\S]*)/);
        if (match) {
            const [_, timestamp, author, content] = match;
            
            const msgEl = document.createElement('div');
            msgEl.className = 'discord-message';
            msgEl.innerHTML = `
                <div class="discord-avatar">${author.charAt(0).toUpperCase()}</div>
                <div class="discord-content">
                    <div class="discord-author">
                        <span class="discord-author-name">${author}</span>
                        <span class="discord-timestamp">${timestamp}</span>
                    </div>
                    <div class="discord-text">${content.trim()}</div>
                </div>
            `;
            container.appendChild(msgEl);
        } else {
            // Fallback for simpler lines
            const simpleDiv = document.createElement('div');
            simpleDiv.className = 'discord-text';
            simpleDiv.style.padding = '5px 0';
            simpleDiv.textContent = msgBlock;
            container.appendChild(simpleDiv);
        }
    });
}

function closeTranscript() {
    document.getElementById('transcriptOverlay').style.display = 'none';
}

async function editPanel(id) {
    try {
        const res = await fetch(`${API_URL}/panels/${activeGuild.id}`);
        const panels = await res.json();
        const p = panels.find(x => x.id === id);
        if (!p) return;

        const data = typeof p.panelData === 'string' ? JSON.parse(p.panelData) : p.panelData;
        editingPanelId = id;
        editingMessageId = p.messageId;

        // Visual feedback for edit mode
        const saveBtn = document.querySelector('button[onclick="savePanel()"]');
        if (saveBtn) {
            saveBtn.innerHTML = '<i class="fas fa-sync"></i> Update Existing Panel';
            saveBtn.classList.add('z-btn-danger');
        }

        setVal('panelTitle', data.title || '');
        setVal('panelEmoji', data.emoji || '');
        setVal('panelDescription', data.description || '');
        setVal('panelDescEmoji', data.descEmoji || '');
        setVal('panelColor', data.color || '#ffd700');
        document.getElementById('panelColorHex').textContent = data.color || '#ffd700';
        setVal('panelImageUrl', data.imageUrl || '');
        setCheck('panelUseEmbed', data.useEmbed === undefined || data.useEmbed === null ? true : !!data.useEmbed);
        
        panelDraft.dropdowns = data.dropdowns || [];
        panelDraft.buttonRows = data.buttonRows || [];
        
        renderDropdowns();
        showToast('Panel data loaded for reconfiguration.', false);
        window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (e) {
        showToast('Error loading panel for edit', true);
    }
}

// =============================================
// LEVEL BACKUP IMPORT logic
// =============================================
async function executeLevelImport(input) {
    if (!activeGuild || !input.files[0]) return;
    
    const file = input.files[0];
    const statusDiv = document.getElementById('importStatus');
    if (!statusDiv) return;

    statusDiv.style.display = 'block';
    statusDiv.style.color = 'var(--gold-500)';
    statusDiv.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Reading backup file...';

    const reader = new FileReader();
    reader.onload = async (e) => {
        try {
            const data = JSON.parse(e.target.result);
            if (!data.levels || !Array.isArray(data.levels)) {
                throw new Error('Invalid format: Missing "levels" array.');
            }

            statusDiv.innerHTML = `<i class="fas fa-spinner fa-spin"></i> Uploading ${data.levels.length} entries to server...`;
            
            const res = await fetch(`${API_URL}/levels/import/${activeGuild.id}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ levels: data.levels })
            });

            const result = await res.json();
            if (res.ok) {
                statusDiv.style.color = 'var(--accent-green)';
                statusDiv.innerHTML = `<i class="fas fa-check-circle"></i> Successfully imported <strong>${result.count}</strong> users.`;
                showToast(`✅ Successfully imported ${result.count} users!`);
            } else {
                throw new Error(result.error || 'Server rejected the import');
            }
        } catch (err) {
            statusDiv.style.color = 'var(--accent-red)';
            statusDiv.innerHTML = `<i class="fas fa-times-circle"></i> Error: ${err.message}`;
            showToast(`❌ Import failed: ${err.message}`, true);
        }
        input.value = ''; // Reset input
    };
    reader.onerror = () => {
        statusDiv.style.color = 'var(--accent-red)';
        statusDiv.innerHTML = '<i class="fas fa-times-circle"></i> Error reading file.';
        showToast('❌ Error reading file.', true);
    };
    reader.readAsText(file);
}
