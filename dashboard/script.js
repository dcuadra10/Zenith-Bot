// ============================================
// ZENITH COMMAND CENTER — Full Dashboard Logic
// ============================================

const API_URL = '/api';
let activeGuild = null;
let editingPanelId = null;
let editingMessageId = null;

// ===== AUTO-DRAFT SYSTEM =====
const DRAFT_KEY = 'zenith_dashboard_draft';
let _draftSaveTimer = null;
let _draftDirty = false;

function getDraftKey() {
    return activeGuild ? `${DRAFT_KEY}_${activeGuild.id}` : null;
}

function saveDraft() {
    const key = getDraftKey();
    if (!key) return;
    try {
        const draft = {
            guildId: activeGuild.id,
            guild: activeGuild,
            activePage: document.querySelector('.sidebar-link.active')?.dataset?.page || 'overview',
            panelDraft: typeof panelDraft !== 'undefined' ? panelDraft : null,
            fields: {},
            timestamp: Date.now()
        };
        document.querySelectorAll('.z-input, input[type=checkbox], input[type=color]').forEach(el => {
            if (!el.id) return;
            if (el.type === 'checkbox') {
                draft.fields[el.id] = { type: 'check', value: el.checked };
            } else if (el.type === 'color') {
                draft.fields[el.id] = { type: 'color', value: el.value };
            } else if (el.tagName === 'SELECT') {
                if (tomSelects[el.id]) {
                    draft.fields[el.id] = { type: 'select', value: tomSelects[el.id].getValue() };
                } else {
                    draft.fields[el.id] = { type: 'select', value: el.value };
                }
            } else {
                draft.fields[el.id] = { type: 'input', value: el.value };
            }
        });
        localStorage.setItem(key, JSON.stringify(draft));
        _draftDirty = false;
    } catch (e) { /* quota exceeded or serialization error */ }
}

function restoreDraft(guildId) {
    const key = `${DRAFT_KEY}_${guildId}`;
    try {
        const raw = localStorage.getItem(key);
        if (!raw) return null;
        const draft = JSON.parse(raw);
        if (Date.now() - draft.timestamp > 24 * 60 * 60 * 1000) {
            localStorage.removeItem(key);
            return null;
        }
        return draft;
    } catch (e) { return null; }
}

function applyDraft(draft) {
    if (!draft || !draft.fields) return;
    if (draft.panelDraft) {
        try { panelDraft = draft.panelDraft; } catch(e) {}
    }
    Object.entries(draft.fields).forEach(([id, data]) => {
        const el = document.getElementById(id);
        if (!el) return;
        try {
            if (data.type === 'check') {
                el.checked = data.value;
            } else if (data.type === 'select' && tomSelects[id]) {
                tomSelects[id].setValue(data.value);
            } else {
                el.value = data.value;
            }
        } catch (e) {}
    });
    if (draft.activePage) {
        const link = document.querySelector(`.sidebar-link[data-page="${draft.activePage}"]`);
        if (link) link.click();
    }
    showToast('\u{1f4dd} Draft restored from your last session');
}

function clearDraft() {
    const key = getDraftKey();
    if (key) localStorage.removeItem(key);
}

function markDirty() { _draftDirty = true; }

function startAutoSave() {
    if (_draftSaveTimer) clearInterval(_draftSaveTimer);
    document.addEventListener('input', markDirty, true);
    document.addEventListener('change', markDirty, true);
    _draftSaveTimer = setInterval(() => {
        if (_draftDirty) saveDraft();
    }, 5000);
    window.addEventListener('beforeunload', () => {
        if (_draftDirty || activeGuild) saveDraft();
    });
}

// ===== UTILITIES =====
function getCookie(name) {
    const v = `; ${document.cookie}`;
    const parts = v.split(`; ${name}=`);
    if (parts.length === 2) return parts.pop().split(';').shift();
}

async function apiFetch(endpoint, options = {}) {
    const token = localStorage.getItem('discord_token') || getCookie('discord_token');
    const headers = {
        'Authorization': `Bearer ${token}`,
        ...options.headers
    };
    if (options.body && !(options.body instanceof FormData)) {
        headers['Content-Type'] = 'application/json';
    }
    const res = await fetch(`${API_URL}${endpoint}`, { ...options, headers });
    if (res.status === 401) {
        localStorage.removeItem('discord_token');
        document.cookie = 'discord_token=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;';
        showScreen('loginScreen');
        throw new Error('Unauthorized');
    }
    return res;
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
        const token = params.get('access_token');
        if (token) localStorage.setItem('discord_token', token);
        window.history.replaceState({}, document.title, '/');
        showScreen('guildScreen');
        fetchGuilds();
    } else if (localStorage.getItem('discord_token') || getCookie('discord_token')) {
        // Check if user had a guild session open
        const lastGuild = localStorage.getItem('zenith_last_guild');
        if (lastGuild) {
            try {
                const guild = JSON.parse(lastGuild);
                showScreen('guildScreen');
                fetchGuilds().then(() => selectGuild(guild));
            } catch(e) {
                showScreen('guildScreen');
                fetchGuilds();
            }
        } else {
            showScreen('guildScreen');
            fetchGuilds();
        }
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
            markDirty(); // track page change for draft
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
    console.log('[Dashboard] Fetching guilds...');
    const list = document.getElementById('guildList');
    try {
        const res = await apiFetch('/guilds');
        const guilds = await res.json();
        console.log('[Dashboard] Loaded guilds:', guilds.length);

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
        console.error('[Dashboard] Fetch Guilds Error:', e);
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
    localStorage.setItem('zenith_last_guild', JSON.stringify(guild));
    loadDashboardData().then(() => {
        const draft = restoreDraft(guild.id);
        if (draft) setTimeout(() => applyDraft(draft), 500);
    });
    startAutoSave();
}

function goBackToGuilds() {
    saveDraft(); // save before leaving
    localStorage.removeItem('zenith_last_guild');
    activeGuild = null;
    showScreen('guildScreen');
    // Reset to overview
    document.querySelectorAll('.sidebar-link').forEach(l => l.classList.remove('active'));
    document.querySelector('.sidebar-link[data-page="overview"]').classList.add('active');
    document.querySelectorAll('.page-section').forEach(s => s.classList.remove('active'));
    document.getElementById('page-overview').classList.add('active');
}

let currentGuildChannels = [];
let currentGuildRoles = [];
let tomSelects = {};

function initTomSelect(id, isMulti, placeholder) {
    const el = document.getElementById(id);
    if (!el) return;

    // Destroy existing if any
    if (tomSelects[id]) {
        tomSelects[id].destroy();
        delete tomSelects[id];
    }

    try {
        tomSelects[id] = new TomSelect(el, {
            create: false,
            placeholder: placeholder || 'Select...',
            maxOptions: 500,
            plugins: isMulti ? ['remove_button'] : [],
            render: {
                option: function(data, escape) {
                    let icon = '';
                    if (id.toLowerCase().includes('channel')) icon = '<i class="fas fa-hashtag" style="opacity:0.6; margin-right:8px;"></i>';
                    if (id.toLowerCase().includes('role')) icon = '<i class="fas fa-at" style="opacity:0.6; margin-right:8px;"></i>';
                    if (id.toLowerCase().includes('category')) icon = '<i class="fas fa-folder" style="opacity:0.6; margin-right:8px;"></i>';
                    return `<div>${icon}${escape(data.text)}</div>`;
                },
                item: function(data, escape) {
                    let icon = '';
                    if (id.toLowerCase().includes('channel')) icon = '<i class="fas fa-hashtag" style="opacity:0.6; margin-right:8px;"></i>';
                    if (id.toLowerCase().includes('role')) icon = '<i class="fas fa-at" style="opacity:0.6; margin-right:8px;"></i>';
                    if (id.toLowerCase().includes('category')) icon = '<i class="fas fa-folder" style="opacity:0.6; margin-right:8px;"></i>';
                    return `<div>${icon}${escape(data.text)}</div>`;
                }
            }
        });
    } catch (e) {
        console.warn(`Could not init TomSelect for ${id}:`, e);
    }
}

function populateAllDropdowns() {
    // We will populate all <select> elements dynamically based on their purpose
    // Category dropdowns
    const categories = currentGuildChannels.filter(c => c.type === 4);
    const textChannels = currentGuildChannels.filter(c => c.type === 0);
    
    // Selects that need a channel
    const channelSelects = [
        'cfgWelcomeChannel', 'cfgLogChannel', 'cfgLeadershipChannel', 
        'panelChannelId', 'adminReviewChannel', 
        'marketApprovalChannel', 'marketFeeChannel', 'automodLogChannel', 
        'loggingChannel', 'countingChannel', 'swearJarChannel',
        'levelUpChannel', 'ticketsTranscriptChannel', 'ticketsApprovalChannel', 'marketOwnerChannel'
    ];
    
    // Selects that need a category
    const categorySelects = ['cfgTicketCategory', 'statsCategoryId', 'modalCategoryId'];
    
    // Selects that need a role
    const roleSelects = ['marketMiddlemanRole', 'r4TrackingRole', 'autoRoleInput'];
    
    channelSelects.forEach(id => populateDropdown(id, textChannels, 'Select a Channel'));
    categorySelects.forEach(id => populateDropdown(id, categories, 'Select a Category'));
    roleSelects.forEach(id => populateDropdown(id, currentGuildRoles, 'Select a Role'));
    
    // Multi-select for roles
    const multiRoleSelects = ['modalStaffRoles', 'modalPingRoles', 'autoroleIds'];
    multiRoleSelects.forEach(id => populateDropdown(id, currentGuildRoles, 'Select Roles', true));
}

function populateDropdown(elementId, items, placeholder, isMulti = false) {
    const el = document.getElementById(elementId);
    if (!el || el.tagName !== 'SELECT') return;
    
    // Preserve existing value if any
    const currentValue = isMulti ? 
        Array.from(el.selectedOptions).map(o => o.value) : 
        el.value;
        
    el.innerHTML = '';
    
    if (!isMulti) {
        const defaultOpt = document.createElement('option');
        defaultOpt.value = '';
        defaultOpt.textContent = `-- ${placeholder} --`;
        el.appendChild(defaultOpt);
    }

    items.forEach(item => {
        const opt = document.createElement('option');
        opt.value = item.id;
        opt.textContent = item.name;
        el.appendChild(opt);
    });
    
    // Restore value
    if (isMulti) {
        Array.from(el.options).forEach(opt => {
            if (currentValue.includes(opt.value)) opt.selected = true;
        });
    } else {
        el.value = currentValue;
    }

    // Re-init TomSelect
    initTomSelect(elementId, isMulti, placeholder);
}


// ===== LOAD ALL DASHBOARD DATA =====
async function loadDashboardData() {
    if (!activeGuild) return;
    const gid = activeGuild.id;

    // Fetch channels and roles
    try {
        const [chanRes, roleRes] = await Promise.all([
            fetch(`${API_URL}/guild/${gid}/channels`),
            fetch(`${API_URL}/guild/${gid}/roles`)
        ]);
        if (chanRes.ok) currentGuildChannels = await chanRes.json();
        if (roleRes.ok) currentGuildRoles = await roleRes.json();
        
        // Populate all dropdowns (will add this function soon)
        populateAllDropdowns();
    } catch (e) { console.error('Error fetching guild data:', e); }

    // Stats
    try {
        const res = await fetch(`${API_URL}/guild/${gid}/stats`);
        if (res.ok) {
            const data = await res.json();
            animateValue('statHumans', 0, data.citizens || 0, 800);
            animateValue('statBots', 0, data.bots || 0, 800);
            animateValue('statChannels', 0, data.communications || 0, 800);
            animateValue('statBoosts', 0, data.boosts || 0, 800);
        }
    } catch (e) { console.error('Error fetching stats:', e); }

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
        
        // Populate new customization fields
        setVal('levelUpTitle', mods.levelUpTitle || '?? Level Up!');
        setVal('levelUpMessage', mods.levelUpMessage || '{user} just reached level **{level}**!');
        setVal('levelUpColor', mods.levelUpColor || '#FFD700');
        setCheck('levelUpUseEmbed', mods.levelUpUseEmbed !== undefined ? mods.levelUpUseEmbed : true);
        setVal('levelingBackground', mods.levelingBackground || '');
        
        setVal('swearJarTitle', mods.swearJarTitle || '?? Swear Jar Contribution!');
        setVal('swearJarMessage', mods.swearJarMessage || '{user} just added a coin to the jar for using prohibited dialect: `{word}`');
        setVal('swearJarColor', mods.swearJarColor || '#FFD700');
        
        // Update all previews initially
        updateWelcomePreview();
        updateLevelingPreview();
        updateSwearJarPreview();
    } catch (e) { console.error(e); }

    // Panels
    fetchPanels();
    fetchTranscripts();
    fetchGiveaways();
    fetchR4Tracking();
    fetchCustomBot();
    fetchMarketConfig();
}

// ===== MARKET QUESTIONS LOGIC =====
let marketQuestionsArr = [];

function loadDefaultMarketQuestions() {
    marketQuestionsArr = [
        { key: 'price', prompt: '💰 **1. What is the Price of the account?**\n*(e.g. 1000$)*', isImage: false },
        { key: 'power', prompt: '<:power:1497402340892868618> **2. What is the Power?**\n*(e.g. 100m)*', isImage: false },
        { key: 'kp', prompt: '<:kp:1497402419665961001> **3. What are the Kill Points?**\n*(e.g. 30b)*', isImage: false },
        { key: 'deaths', prompt: '<:deaths:1497402636083662981> **4. What are the Deaths?**\n*(e.g. 30m)*', isImage: false },
        { key: 'vip', prompt: '<:VIP:1497401764717002924> **5. What is the VIP Level?**\n*(e.g. SVIP, VIP 17)*', isImage: false },
        { key: 'gems', prompt: '<:gem1:1497401988651159573> **6. How many Gems?**\n*(e.g. 50k)*', isImage: false },
        { key: 'skins', prompt: '<:skin:1497410065492086965> **7. How many Legendary City Skins?**\n*(e.g. 5)*', isImage: false },
        { key: 'equipment', prompt: '<:equip:1497405923189194863> **8. How many Legendary Equipment pieces?**\n*(e.g. 10)*', isImage: false },
        { key: 'passports', prompt: '<:passport:1495891858717671454> **9. How many Passports?**\n*(e.g. 100)*', isImage: false },
        { key: 'goldHeads', prompt: '<:gh:1497401912142729257> **10. How many Gold Heads?**\n*(e.g. 100)*', isImage: false },
        { key: 'commanders', prompt: '<:commander:1497711538906337451> **11. How many Expertise Legendary Commanders?**\n*(e.g. 10)*', isImage: false },
        { key: 'rss', prompt: '🌾🪵🪨🪙 **12. How many Resources (Food, Wood, Stone, Gold)?**\n*(e.g. 10b Food, 5b Wood...)*', isImage: false },
        { key: 'speedups', prompt: '⏱️ **13. How many Speedups (Universal, Healing, Training)?**\n*(e.g. 1000d Uni, 300d Heal...)*', isImage: false },
        { key: 'age', prompt: '<:days:1497712897181089802> **14. Account Age in days?**\n*(e.g. 1000 days)*', isImage: false },
        { key: 'migrate', prompt: '✈️ **15. Is the account ready to migrate?**\n*(Yes / No)*', isImage: false },
        { key: 'kvk', prompt: '⚔️ **16. Which KvK is it in?**\n*(1, 2, 3, or SOC)*', isImage: false },
        { key: 'notes', prompt: '<:notes:1500635402820780232> **17. Any additional notes?**\n*(e.g. N/A or details about farms)*', isImage: false },
        { key: 'images', prompt: '📸 **18. Please upload screenshots proving this information.**\n*(Upload all images in a single message, then wait).*', isImage: true }
    ];
    renderMarketQuestions();
}

function addMarketQuestion() {
    marketQuestionsArr.push({ key: 'custom_'+Date.now(), prompt: 'New Question?', isImage: false });
    renderMarketQuestions();
}

function removeMarketQuestion(idx) {
    marketQuestionsArr.splice(idx, 1);
    renderMarketQuestions();
}

function updateMarketQuestion(idx, field, val) {
    marketQuestionsArr[idx][field] = val;
}

function renderMarketQuestions() {
    const list = document.getElementById('marketQuestionsList');
    if (!list) return;
    if (marketQuestionsArr.length === 0) {
        list.innerHTML = '<div class="empty-state"><p style="font-size:0.85rem;">Using the default 17 RoK questions.</p></div>';
        return;
    }
    
    list.innerHTML = marketQuestionsArr.map((q, i) => `
        <div style="display:grid; grid-template-columns: 120px 1fr 100px 40px; gap:10px; align-items:center; padding:12px; background:rgba(255,255,255,0.02); border:1px solid var(--border-subtle); border-radius:var(--radius-md);">
            <div style="display:flex; flex-direction:column;">
                <label style="font-size:0.65rem; color:var(--text-muted);">JSON KEY</label>
                <input class="z-input" style="font-size:0.8rem; padding:6px;" value="${q.key}" onchange="updateMarketQuestion(${i}, 'key', this.value)" placeholder="e.g. power">
            </div>
            <div style="display:flex; flex-direction:column;">
                <label style="font-size:0.65rem; color:var(--text-muted);">BOT PROMPT</label>
                <input class="z-input" style="font-size:0.8rem; padding:6px;" value="${q.prompt.replace(/"/g, '&quot;')}" onchange="updateMarketQuestion(${i}, 'prompt', this.value)" placeholder="e.g. What is the Power?">
            </div>
            <div style="display:flex; flex-direction:column; align-items:center; justify-content:center;">
                <label style="font-size:0.65rem; color:var(--text-muted);">IS IMAGE?</label>
                <input type="checkbox" ${q.isImage ? 'checked' : ''} onchange="updateMarketQuestion(${i}, 'isImage', this.checked)">
            </div>
            <button class="z-btn z-btn-danger" style="padding:6px; font-size:0.8rem; margin-top:14px;" onclick="removeMarketQuestion(${i})">✕</button>
        </div>
    `).join('');
}

// ===== MARKET CHANNELS LOGIC =====
let marketForumChannelsArr = [];

function addMarketForumChannel() {
    marketForumChannelsArr.push({ min: 0, max: 999999, channelId: '' });
    renderMarketForumChannels();
}

function removeMarketForumChannel(idx) {
    marketForumChannelsArr.splice(idx, 1);
    renderMarketForumChannels();
}

function updateMarketForumChannel(idx, field, val) {
    marketForumChannelsArr[idx][field] = val;
}

function renderMarketForumChannels() {
    const list = document.getElementById('marketForumChannelsList');
    if (!list) return;
    if (marketForumChannelsArr.length === 0) {
        list.innerHTML = '<div class="empty-state"><p style="font-size:0.85rem;">No channels defined. Bot will not be able to post listings.</p></div>';
        return;
    }
    
    list.innerHTML = marketForumChannelsArr.map((c, i) => `
        <div style="display:grid; grid-template-columns: 100px 100px 1fr 40px; gap:10px; align-items:center; padding:10px; background:rgba(255,255,255,0.02); border:1px solid var(--border-subtle); border-radius:var(--radius-md);">
            <div style="display:flex; flex-direction:column;">
                <label style="font-size:0.65rem; color:var(--text-muted);">MIN PRICE ($)</label>
                <input type="number" class="z-input" style="font-size:0.8rem; padding:6px;" value="${c.min}" onchange="updateMarketForumChannel(${i}, 'min', parseFloat(this.value))">
            </div>
            <div style="display:flex; flex-direction:column;">
                <label style="font-size:0.65rem; color:var(--text-muted);">MAX PRICE ($)</label>
                <input type="number" class="z-input" style="font-size:0.8rem; padding:6px;" value="${c.max}" onchange="updateMarketForumChannel(${i}, 'max', parseFloat(this.value))">
            </div>
            <div style="display:flex; flex-direction:column;">
                <label style="font-size:0.65rem; color:var(--text-muted);">FORUM CHANNEL ID</label>
                <input class="z-input" style="font-size:0.8rem; padding:6px;" value="${c.channelId}" onchange="updateMarketForumChannel(${i}, 'channelId', this.value)" placeholder="e.g. 123456789">
            </div>
            <button class="z-btn z-btn-danger" style="padding:6px; font-size:0.8rem; margin-top:14px;" onclick="removeMarketForumChannel(${i})">✕</button>
        </div>
    `).join('');
}

// ===== MIDDLEMAN PAYMENTS LOGIC =====
let mmPaymentMethodsArr = [];

function addMmPaymentMethod() {
    mmPaymentMethodsArr.push({ userId: '', details: '' });
    renderMmPaymentMethods();
}

function removeMmPaymentMethod(idx) {
    mmPaymentMethodsArr.splice(idx, 1);
    renderMmPaymentMethods();
}

function updateMmPaymentMethod(idx, field, val) {
    mmPaymentMethodsArr[idx][field] = val;
}

function renderMmPaymentMethods() {
    const list = document.getElementById('mmPaymentList');
    if (!list) return;
    if (mmPaymentMethodsArr.length === 0) {
        list.innerHTML = '<div class="empty-state"><p style="font-size:0.85rem;">No middleman-specific payment info defined.</p></div>';
        return;
    }
    
    list.innerHTML = mmPaymentMethodsArr.map((m, i) => `
        <div style="display:grid; grid-template-columns: 200px 1fr 40px; gap:10px; align-items:start; padding:10px; background:rgba(255,255,255,0.02); border:1px solid var(--border-subtle); border-radius:var(--radius-md);">
            <div style="display:flex; flex-direction:column;">
                <label style="font-size:0.65rem; color:var(--text-muted);">MIDDLEMAN USER ID</label>
                <input class="z-input" style="font-size:0.8rem; padding:6px;" value="${m.userId}" onchange="updateMmPaymentMethod(${i}, 'userId', this.value)" placeholder="e.g. 123456789">
            </div>
            <div style="display:flex; flex-direction:column;">
                <label style="font-size:0.65rem; color:var(--text-muted);">PAYMENT DETAILS</label>
                <textarea class="z-input" style="font-size:0.8rem; padding:6px;" rows="2" onchange="updateMmPaymentMethod(${i}, 'details', this.value)" placeholder="PayPal: mm@paypal.com">${m.details}</textarea>
            </div>
            <button class="z-btn z-btn-danger" style="padding:6px; font-size:0.8rem; margin-top:14px;" onclick="removeMmPaymentMethod(${i})">✕</button>
        </div>
    `).join('');
}

function setVal(id, val) {
    const el = document.getElementById(id);
    if (!el) return;

    if (tomSelects[id]) {
        const values = (val || '').split(',').map(v => v.trim()).filter(v => v);
        tomSelects[id].setValue(values);
        return;
    }

    if (el.tagName === 'SELECT' && el.multiple) {
        const values = (val || '').split(',').map(v => v.trim());
        Array.from(el.options).forEach(opt => {
            opt.selected = values.includes(opt.value);
        });
    } else {
        el.value = val || '';
    }
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
    setVal('automodWordList', mods.automodWordList || 'fuck,shit,bitch,asshole,dick,cunt,pussy,motherfucker,puta,mierda,pendejo,cabron');
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
    setCheck('logVoice', mods.logVoice);
    setCheck('logServer', mods.logServer);
    setCheck('logInvites', mods.logInvites);
    // Auto-Role
    setCheck('toggleAutorole', mods.autoroleEnabled);
    setVal('autoroleIds', mods.autoroleIds);
    // Swear Jar
    setCheck('toggleSwearJar', mods.swearJarEnabled);
    setVal('swearJarChannel', mods.swearJarChannel);
    setVal('swearJarWords', mods.swearJarWords || 'fuck,shit,bitch,asshole,dick,cunt,pussy,motherfucker,puta,mierda,pendejo,cabron');
    setCheck('swearJarPing', mods.swearJarPing === undefined || mods.swearJarPing === null ? true : !!mods.swearJarPing);
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
    if (!el) return '';

    if (tomSelects[id]) {
        const val = tomSelects[id].getValue();
        return Array.isArray(val) ? val.join(', ') : val;
    }

    if (el.tagName === 'SELECT' && el.multiple) {
        return Array.from(el.selectedOptions).map(o => o.value).join(', ');
    }
    return el.value.trim();
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
        welcomeChannel: getVal('cfgWelcomeChannel'),
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
        levelUpTitle: getVal('levelUpTitle'),
        levelUpMessage: getVal('levelUpMessage'),
        levelUpColor: getVal('levelUpColor'),
        levelUpUseEmbed: getCheck('levelUpUseEmbed'),
        levelingBackground: getVal('levelingBackground'),
        // Tickets
        ticketsEnabled: getCheck('toggleTickets'),
        ticketsMaxActive: parseInt(getVal('ticketsMaxActive'), 10) || 2,
        ticketsTranscriptChannel: getVal('ticketsTranscriptChannel'),
        ticketCategoryId: getVal('cfgTicketCategory'),
        ticketsApprovalChannel: getVal('ticketsApprovalChannel'),
        // Swear Jar
        swearJarEnabled: getCheck('toggleSwearJar'),
        swearJarChannel: getVal('swearJarChannel'),
        swearJarWords: getVal('swearJarWords'),
        swearJarPing: getCheck('swearJarPing'),
        swearJarTitle: getVal('swearJarTitle'),
        swearJarMessage: getVal('swearJarMessage'),
        swearJarColor: getVal('swearJarColor'),
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
        logBans: getCheck('logMembers'), // Syncing with members for simplicity
        logVoice: getCheck('logVoice'),
        logServer: getCheck('logServer'),
        logInvites: getCheck('logInvites'),
        // Auto-Role
        autoroleEnabled: getCheck('toggleAutorole'),
        autoroleIds: getVal('autoroleIds'),
        // Swear Jar
        swearJarEnabled: getCheck('toggleSwearJar'),
        swearJarChannel: getVal('swearJarChannel'),
        swearJarWords: getVal('swearJarWords'),
        swearJarPing: getCheck('swearJarPing'),
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
        // Save Module Config
        await fetch(`${API_URL}/modules/${activeGuild.id}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        // Also Save Core Config (Redistributed fields)
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

        clearDraft(); // Clear draft on successful save
        const btn = event.target.closest('button');
        if (btn) {
            const oldText = btn.innerHTML;
            btn.innerHTML = '<i class="fas fa-check"></i> DEPLOYED';
            btn.classList.add('z-btn-success');
            setTimeout(() => {
                btn.innerHTML = oldText;
                btn.classList.remove('z-btn-success');
            }, 2000);
        }
    } catch (e) {
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

    const useEmbed = getCheck('panelUseEmbed');

    const fullTitle = (emojiVal ? emojiVal + ' ' : '') + titleVal;
    const fullDesc = (descEmojiVal ? descEmojiVal + ' ' : '') + descVal;

    const cb = document.getElementById('previewColorBar');
    const content = document.getElementById('previewContentBlock');
    const titleEl = document.getElementById('previewTitle');
    const descEl = document.getElementById('previewDesc');
    const imgEl = document.getElementById('previewImage');
    const imageUrl = getVal('panelImageUrl');
    const embedWrap = cb.parentElement; // the flex wrapper

    if (useEmbed) {
        // Components V2 / Container — rounded card with thin sidebar color, everything inside
        cb.style.display = 'block';
        cb.style.background = color;
        cb.style.width = '4px';
        cb.style.borderRadius = '8px 0 0 8px';
        cb.style.flexShrink = '0';
        embedWrap.style.display = 'flex';
        content.style.background = '#2b2d31';
        content.style.border = 'none';
        content.style.borderLeft = 'none';
        content.style.borderRadius = '0 8px 8px 0';
        content.style.padding = '16px';
        content.style.boxShadow = 'none';

        // Dynamic V2 Rendering
        if (panelDraft.v2Components && panelDraft.v2Components.length > 0) {
            titleEl.style.display = 'none'; // Hide classic title/desc
            descEl.style.display = 'none';
            if (imgEl) imgEl.style.display = 'none';

            let v2Html = '';
            panelDraft.v2Components.forEach(comp => {
                if (comp.type === 'text') {
                    v2Html += `<div style="color:#dbdee1; font-size:0.85rem; line-height:1.5; margin-bottom:8px;">${formatDiscordText(comp.content || 'Text content...')}</div>`;
                } else if (comp.type === 'separator') {
                    const margin = comp.size === 'large' ? '16px' : '8px';
                    const border = comp.dividerLine ? '1px solid #3f4147' : 'none';
                    v2Html += `<div style="margin:${margin} 0; border-top:${border}; height:0;"></div>`;
                } else if (comp.type === 'section') {
                    v2Html += `<div style="display:flex; gap:12px; align-items:flex-start; margin-bottom:12px;">
                        <div style="flex:1; color:#dbdee1; font-size:0.85rem; line-height:1.5;">${formatDiscordText(comp.content || 'Section content...')}</div>`;
                    if (comp.accessory && comp.accessory.type === 'thumbnail' && comp.accessory.url) {
                        v2Html += `<img src="${comp.accessory.url}" style="width:48px; height:48px; border-radius:4px; object-fit:cover;">`;
                    }
                    v2Html += `</div>`;
                } else if (comp.type === 'mediaGallery') {
                    v2Html += `<div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(100px, 1fr)); gap:8px; margin-bottom:12px;">
                        ${(comp.items || []).filter(i => i.url).map(img => `<img src="${img.url}" style="width:100%; border-radius:4px;">`).join('')}
                    </div>`;
                }
            });
            
            // Check if there's already a v2 container, if not create one or use a placeholder
            let v2Wrap = content.querySelector('.v2-dynamic-content');
            if (!v2Wrap) {
                v2Wrap = document.createElement('div');
                v2Wrap.className = 'v2-dynamic-content';
                content.insertBefore(v2Wrap, titleEl);
            }
            v2Wrap.innerHTML = v2Html;
        } else {
            // Default V2 look if no components added
            titleEl.style.display = '';
            descEl.style.display = '';
            titleEl.innerHTML = formatDiscordText(fullTitle);
            descEl.innerHTML = formatDiscordText(fullDesc);
            const v2Wrap = content.querySelector('.v2-dynamic-content');
            if (v2Wrap) v2Wrap.innerHTML = '';
        }
    } else {
        // Remove V2 dynamic content if it exists
        const v2Wrap = content.querySelector('.v2-dynamic-content');
        if (v2Wrap) v2Wrap.remove();

        // Classic embed — color bar on the left, standard embed look
        cb.style.display = 'block';
        cb.style.background = color;
        cb.style.width = '4px';
        cb.style.borderRadius = '3px 0 0 3px';
        cb.style.flexShrink = '0';
        embedWrap.style.display = 'flex';
        content.style.background = '#2b2d31';
        content.style.border = '1px solid #1e1f22';
        content.style.borderLeft = 'none';
        content.style.borderRadius = '0 4px 4px 0';
        content.style.padding = '16px';
        content.style.boxShadow = 'none';
        titleEl.style.fontSize = '1rem';
        titleEl.style.fontWeight = '700';
        titleEl.style.color = '#f2f3f5';
        descEl.style.color = '#dbdee1';
        titleEl.style.display = '';
        descEl.style.display = '';
        
        titleEl.innerHTML = formatDiscordText(fullTitle);
        descEl.innerHTML = formatDiscordText(fullDesc);

        if (imgEl) {
            if (imageUrl) { imgEl.src = imageUrl; imgEl.style.display = 'block'; }
            else { imgEl.style.display = 'none'; }
        }
    }

    // Update select menu previews
    const menusContainer = document.getElementById('previewMenus');
    if (panelDraft.dropdowns.length === 0 && panelDraft.buttonRows.length === 0) {
        menusContainer.innerHTML = '<div style="background:#1e1f22;border:1px solid #3f4147;border-radius:4px;padding:8px 12px;font-size:0.82rem;color:#949ba4;">Select an option...</div>';
    } else {
        let html = '';
        panelDraft.dropdowns.forEach(dd => {
            html += `<div style="background:#1e1f22;border:1px solid #3f4147;border-radius:4px;padding:8px 12px;font-size:0.82rem;color:#949ba4;margin-bottom:4px;">${dd.placeholder || 'Select an option...'}</div>`;
        });
        panelDraft.buttonRows.forEach(row => {
            html += `<div style="display:flex; gap:4px; margin-top:4px;">${row.options.map(opt => `<div style="background:#4e5058; color:white; padding:4px 12px; border-radius:3px; font-size:0.8rem; cursor:default;">${opt.label}</div>`).join('')}</div>`;
        });
        menusContainer.innerHTML = html;
    }

    // V2: menus go INSIDE the container card. Classic: menus stay outside
    const discordPreview = document.getElementById('discordPreview');
    if (useEmbed) {
        // Move menus inside contentBlock (after image)
        content.appendChild(menusContainer);
        menusContainer.style.marginTop = '12px';
        menusContainer.style.borderTop = '1px solid #3f4147';
        menusContainer.style.paddingTop = '12px';
    } else {
        // Move menus back outside (after the embed wrapper)
        discordPreview.appendChild(menusContainer);
        menusContainer.style.marginTop = '10px';
        menusContainer.style.borderTop = 'none';
        menusContainer.style.paddingTop = '0';
    }
}

function updateWelcomePreview() {
    const title = getVal('welcomeTitle') || 'Welcome!';
    const desc = getVal('welcomeMessage') || 'Welcome to the server, {user}!';
    const color = getVal('welcomeColor') || '#FFD700';
    const image = getVal('welcomeImage');
    const useEmbed = getCheck('welcomeUseEmbed');

    const embedWrap = document.getElementById('welcomePreviewEmbed');
    const textWrap = document.getElementById('welcomePreviewText');
    const imgEl = document.getElementById('welcomePreviewImage');
    const imgPlainEl = document.getElementById('welcomePreviewImagePlain');

    if (useEmbed) {
        embedWrap.style.display = 'flex';
        textWrap.style.display = 'none';
        document.getElementById('welcomePreviewColorBar').style.background = color;
        document.getElementById('welcomePreviewTitle').innerHTML = formatDiscordText(title);
        document.getElementById('welcomePreviewDesc').innerHTML = formatDiscordText(desc);
        if (image) { imgEl.src = image; imgEl.style.display = 'block'; } else { imgEl.style.display = 'none'; }
    } else {
        embedWrap.style.display = 'none';
        textWrap.style.display = 'block';
        textWrap.innerHTML = formatDiscordText(desc);
        if (image) { imgPlainEl.src = image; imgPlainEl.style.display = 'block'; } else { imgPlainEl.style.display = 'none'; }
    }
}

function updateLevelingPreview() {
    const title = getVal('levelUpTitle') || 'GG!';
    const desc = getVal('levelUpMessage') || '{user} just reached level **{level}**!';
    const color = getVal('levelUpColor') || '#FFD700';
    const useEmbed = getCheck('levelUpUseEmbed');

    const embedWrap = document.getElementById('levelPreviewEmbed');
    const textWrap = document.getElementById('levelPreviewText');

    if (useEmbed) {
        embedWrap.style.display = 'flex';
        textWrap.style.display = 'none';
        document.getElementById('levelPreviewColorBar').style.background = color;
        document.getElementById('levelPreviewTitle').innerHTML = formatDiscordText(title);
        document.getElementById('levelPreviewDesc').innerHTML = formatDiscordText(desc);
    } else {
        embedWrap.style.display = 'none';
        textWrap.style.display = 'block';
        textWrap.innerHTML = formatDiscordText(desc);
    }
}

function updateSwearJarPreview() {
    const title = getVal('swearJarTitle') || 'Swear Jar Contribution!';
    const desc = getVal('swearJarMessage') || '{user} just added a coin to the jar for using prohibited dialect: `{word}`';
    const color = getVal('swearJarColor') || '#FFD700';

    document.getElementById('swearPreviewColorBar').style.background = color;
    document.getElementById('swearPreviewTitle').innerHTML = formatDiscordText(title);
    document.getElementById('swearPreviewDesc').innerHTML = formatDiscordText(desc);
}

// Add listeners to all preview-able inputs
document.addEventListener('DOMContentLoaded', () => {
    const ids = [
        'welcomeTitle', 'welcomeMessage', 'welcomeColor', 'welcomeImage', 'welcomeUseEmbed',
        'levelUpTitle', 'levelUpMessage', 'levelUpColor', 'levelUpUseEmbed',
        'swearJarTitle', 'swearJarMessage', 'swearJarColor',
        'panelTitle', 'panelEmoji', 'panelDescription', 'panelDescEmoji', 'panelColor', 'panelImageUrl', 'panelUseEmbed'
    ];
    ids.forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        const ev = el.type === 'checkbox' || el.type === 'color' ? 'change' : 'input';
        el.addEventListener(ev, () => {
            if (id.startsWith('welcome')) updateWelcomePreview();
            if (id.startsWith('level')) updateLevelingPreview();
            if (id.startsWith('swear')) updateSwearJarPreview();
            if (id.startsWith('panel')) updatePanelPreview();
        });
    });
});

// =============================================
// TICKET PANELS & TRANSCRIPTS
// =============================================
let panelDraft = { dropdowns: [], buttonRows: [], v2Components: [] };

function toggleV2Mode() {
    const isV2 = getCheck('panelUseEmbed');
    const v2Editor = document.getElementById('v2EditorContainer');
    const classicFields = document.getElementById('classicPanelFields');
    
    if (isV2) {
        v2Editor.style.display = 'block';
        classicFields.style.display = 'none';
    } else {
        v2Editor.style.display = 'none';
        classicFields.style.display = 'block';
    }
    updatePanelPreview();
}

function toggleAddMenu() {
    const menu = document.getElementById('addComponentMenu');
    menu.style.display = menu.style.display === 'none' ? 'block' : 'none';
}

// Close menu when clicking outside
document.addEventListener('click', (e) => {
    if (!e.target.closest('.dropdown')) {
        const menu = document.getElementById('addComponentMenu');
        if (menu) menu.style.display = 'none';
    }
});

function addV2Component(type) {
    let component = { id: Date.now().toString(), type: type };
    
    if (type === 'text') {
        component.content = '';
    } else if (type === 'section') {
        component.content = '';
        component.accessory = { type: 'none' };
    } else if (type === 'separator') {
        component.size = 'small';
        component.dividerLine = true;
    } else if (type === 'mediaGallery') {
        component.items = [];
    } else if (type === 'actionRow') {
        component.components = [];
    }
    
    panelDraft.v2Components.push(component);
    document.getElementById('addComponentMenu').style.display = 'none';
    renderV2Editor();
    updatePanelPreview();
}

function removeV2Component(index) {
    panelDraft.v2Components.splice(index, 1);
    renderV2Editor();
    updatePanelPreview();
}

function updateV2Field(index, field, value) {
    panelDraft.v2Components[index][field] = value;
    updatePanelPreview();
    markDirty();
}

function renderV2Editor() {
    const container = document.getElementById('v2ComponentsList');
    if (!container) return;
    
    if (panelDraft.v2Components.length === 0) {
        container.innerHTML = `<div style="text-align:center; padding:40px 20px; border:2px dashed var(--border-medium); border-radius:8px; color:var(--text-muted);">
            <i class="fas fa-layer-group" style="font-size:2rem; margin-bottom:12px; opacity:0.5;"></i>
            <p>No components added yet. Use the button below to build your container.</p>
        </div>`;
        return;
    }
    
    container.innerHTML = panelDraft.v2Components.map((comp, idx) => {
        let html = `<div class="z-card" style="background:#1e1f22; border-color:#3f4147; padding:16px;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
                <span style="font-size:0.75rem; font-weight:700; text-transform:uppercase; color:#949ba4;">
                    <i class="${getIconForType(comp.type)}"></i> ${comp.type}
                </span>
                <button class="z-btn-icon" style="color:#ed4245;" onclick="removeV2Component(${idx})"><i class="fas fa-trash"></i></button>
            </div>`;
            
        if (comp.type === 'text') {
            html += `<textarea class="z-input" placeholder="Enter text content..." oninput="updateV2Field(${idx}, 'content', this.value)">${comp.content || ''}</textarea>`;
        } else if (comp.type === 'separator') {
            html += `<div style="display:flex; gap:12px; align-items:center;">
                <select class="z-input" style="flex:1;" onchange="updateV2Field(${idx}, 'size', this.value)">
                    <option value="small" ${comp.size === 'small' ? 'selected' : ''}>Small Space</option>
                    <option value="large" ${comp.size === 'large' ? 'selected' : ''}>Large Space</option>
                </select>
                <label style="display:flex; gap:8px; align-items:center; cursor:pointer; font-size:0.85rem; color:var(--text-muted);">
                    <input type="checkbox" ${comp.dividerLine ? 'checked' : ''} onchange="updateV2Field(${idx}, 'dividerLine', this.checked)"> Divider Line
                </label>
            </div>`;
        } else if (comp.type === 'section') {
            html += `<textarea class="z-input" placeholder="Main content..." oninput="updateV2Field(${idx}, 'content', this.value)">${comp.content || ''}</textarea>
                <div class="z-input-group" style="margin-top:12px;">
                    <label style="font-size:0.75rem;">Accessory Type</label>
                    <select class="z-input" onchange="updateV2Field(${idx}, 'accessory', {type: this.value, url: ''})">
                        <option value="none" ${comp.accessory.type === 'none' ? 'selected' : ''}>None</option>
                        <option value="thumbnail" ${comp.accessory.type === 'thumbnail' ? 'selected' : ''}>Thumbnail (Right)</option>
                    </select>
                </div>`;
            if (comp.accessory.type === 'thumbnail') {
                html += `<div class="z-input-group" style="margin-top:8px;">
                    <input class="z-input" type="text" placeholder="Image URL..." value="${comp.accessory.url || ''}" oninput="updateV2Field(${idx}, 'accessory', {type:'thumbnail', url:this.value})">
                </div>`;
            }
        } else if (comp.type === 'mediaGallery') {
            html += `<p style="font-size:0.8rem; color:var(--text-muted); margin-bottom:8px;">Image Gallery (Discord Component)</p>
                <div id="gallery_${idx}_items" style="display:flex; flex-direction:column; gap:8px;">
                    ${(comp.items || []).map((img, iIdx) => `
                        <div style="display:flex; gap:8px;">
                            <input class="z-input" type="text" placeholder="Image URL..." value="${img.url || ''}" oninput="updateGalleryItem(${idx}, ${iIdx}, this.value)">
                            <button class="z-btn-icon" style="color:#ed4245;" onclick="removeGalleryItem(${idx}, ${iIdx})"><i class="fas fa-times"></i></button>
                        </div>
                    `).join('')}
                </div>
                <button class="z-btn z-btn-secondary" style="width:100%; margin-top:8px; font-size:0.8rem; padding:6px;" onclick="addGalleryItem(${idx})">
                    <i class="fas fa-plus"></i> Add Image
                </button>`;
        } else if (comp.type === 'actionRow') {
            html += `<p style="font-size:0.8rem; color:var(--text-muted); margin-bottom:8px;">Buttons/Selects are managed in the Routing Modules section below for now.</p>`;
        }
            
        html += `</div>`;
        return html;
    }).join('');
}

function getIconForType(type) {
    const icons = { text: 'fas fa-align-left', section: 'fas fa-th-large', separator: 'fas fa-minus', mediaGallery: 'fas fa-images', actionRow: 'fas fa-bars' };
    return icons[type] || 'fas fa-cube';
}

function addGalleryItem(idx) {
    if (!panelDraft.v2Components[idx].items) panelDraft.v2Components[idx].items = [];
    panelDraft.v2Components[idx].items.push({ url: '' });
    renderV2Editor();
    updatePanelPreview();
}

function updateGalleryItem(idx, iIdx, url) {
    panelDraft.v2Components[idx].items[iIdx].url = url;
    updatePanelPreview();
}

function removeGalleryItem(idx, iIdx) {
    panelDraft.v2Components[idx].items.splice(iIdx, 1);
    renderV2Editor();
    updatePanelPreview();
}

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
                    buttonRows: panelDraft.buttonRows,
                    v2Components: panelDraft.v2Components || []
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
        panelDraft.v2Components = data.v2Components || [];
        
        renderDropdowns();
        renderV2Editor();
        toggleV2Mode();
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

// =============================================


// ===== CUSTOM BOT MANAGEMENT =====
async function fetchCustomBot() {
    if (!activeGuild) return;
    try {
        const res = await fetch(`${API_URL}/custom-bot/${activeGuild.id}`);
        const bot = await res.json();
        
        const stateEl = document.getElementById('cbState');
        const errEl = document.getElementById('cbError');
        const tokenInput = document.getElementById('customBotToken');
        
        if (bot && bot.status && bot.status !== 'none' && bot.status !== 'inactive') {
            stateEl.textContent = bot.status === 'active' ? 'Online' : 'Error';
            stateEl.style.color = bot.status === 'active' ? 'var(--accent-green)' : 'var(--accent-red)';
            errEl.textContent = bot.status === 'active' ? `Connected as Bot ID: ${bot.clientId}` : (bot.errorMessage || 'Unknown error');
            tokenInput.value = bot.botToken || '';
        } else {
            stateEl.textContent = 'Disconnected';
            stateEl.style.color = 'var(--text-muted)';
            errEl.textContent = 'No custom bot is currently linked to this server.';
            tokenInput.value = '';
        }
    } catch (e) {
        console.error('Error fetching custom bot:', e);
    }
}

async function connectCustomBot() {
    if (!activeGuild) return;
    const token = getVal('customBotToken');
    if (!token) return showToast('Please enter a Bot Token.', true);
    
    showToast('Connecting Custom Bot...');
    try {
        const res = await fetch(`${API_URL}/custom-bot/${activeGuild.id}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ botToken: token })
        });
        const data = await res.json();
        if (data.success) {
            showToast('✅ Custom Bot Connected Successfully!');
            fetchCustomBot();
        } else {
            showToast(`❌ Error: ${data.error}`, true);
            fetchCustomBot();
        }
    } catch (e) {
        showToast('❌ Server error connecting bot', true);
    }
}

async function disconnectCustomBot() {
    if (!activeGuild) return;
    if (!confirm('Are you sure you want to disconnect your custom bot? It will immediately go offline.')) return;
    
    showToast('Disconnecting bot...');
    try {
        const res = await fetch(`${API_URL}/custom-bot/${activeGuild.id}`, {
            method: 'DELETE'
        });
        const data = await res.json();
        if (data.success) {
            showToast('✅ Custom Bot Disconnected');
            fetchCustomBot();
        } else {
            showToast(`❌ Error disconnecting`, true);
        }
    } catch (e) {
        showToast('❌ Server error disconnecting bot', true);
    }
}

// ===== MARKET+ MANAGEMENT =====
async function fetchMarketConfig() {
    if (!activeGuild) return;
    try {
        const res = await apiFetch(`/market-config/${activeGuild.id}`);
        const cfg = await res.json();
        
        setCheck('toggleMarket', cfg.marketEnabled);
        
        // Handle Price-Based Channels (can be a single ID string or a JSON array)
        if (cfg.forumChannelId && cfg.forumChannelId.startsWith('[')) {
            try {
                marketForumChannelsArr = JSON.parse(cfg.forumChannelId);
            } catch(e) { 
                marketForumChannelsArr = [{ min: 0, max: 999999, channelId: cfg.forumChannelId }]; 
            }
        } else if (cfg.forumChannelId) {
            marketForumChannelsArr = [{ min: 0, max: 999999, channelId: cfg.forumChannelId }];
        } else {
            marketForumChannelsArr = [];
        }
        renderMarketForumChannels();

        setVal('marketApprovalChannel', cfg.approvalChannelId);
        setVal('marketOwnerChannel', cfg.ownerChannelId);
        setVal('marketMiddlemanRole', cfg.middlemanRole);
        setVal('marketFeePct', cfg.marketFeePct || 5);
        setVal('middlemanFeePct', cfg.middlemanFeePct || 5);
        setVal('marketPaymentMethods', cfg.paymentMethods);
        
        if (cfg.mmPaymentMethods) {
            try {
                mmPaymentMethodsArr = JSON.parse(cfg.mmPaymentMethods);
            } catch(e) { mmPaymentMethodsArr = []; }
        } else {
            mmPaymentMethodsArr = [];
        }
        renderMmPaymentMethods();

        if (cfg.marketQuestions) {
            try {
                marketQuestionsArr = JSON.parse(cfg.marketQuestions);
            } catch(e) { marketQuestionsArr = []; }
        } else {
            marketQuestionsArr = [];
        }
        renderMarketQuestions();
    } catch (e) {
        console.error('Error fetching market config:', e);
    }
}

async function saveMarketConfig() {
    if (!activeGuild) return;
    showToast('Saving Market+ Config...');
    try {
        const res = await apiFetch(`/market-config/${activeGuild.id}`, {
            method: 'POST',
            body: JSON.stringify({
                marketEnabled: getCheck('toggleMarket'),
                forumChannelId: JSON.stringify(marketForumChannelsArr),
                approvalChannelId: getVal('marketApprovalChannel'),
                ownerChannelId: getVal('marketOwnerChannel'),
                middlemanRole: getVal('marketMiddlemanRole'),
                marketFeePct: parseInt(getVal('marketFeePct')) || 5,
                middlemanFeePct: parseInt(getVal('middlemanFeePct')) || 5,
                paymentMethods: getVal('marketPaymentMethods'),
                mmPaymentMethods: JSON.stringify(mmPaymentMethodsArr),
                marketQuestions: marketQuestionsArr.length > 0 ? JSON.stringify(marketQuestionsArr) : null
            })
        });
        const data = await res.json();
        if (data.success) {
            showToast('✅ Market+ Config Saved!');
        } else {
            showToast('❌ Error saving config', true);
        }
    } catch (e) {
        showToast('❌ Server error saving config', true);
    }
}
