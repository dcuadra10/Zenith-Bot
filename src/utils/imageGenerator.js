const { createCanvas, loadImage, GlobalFonts } = require('@napi-rs/canvas');
const axios = require('axios');

async function getAvatar(url) {
    try {
        const response = await axios.get(url, { responseType: 'arraybuffer' });
        return await loadImage(Buffer.from(response.data));
    } catch (e) {
        return null;
    }
}

function drawCurve(ctx, startX, startY, endX, endY) {
    ctx.strokeStyle = 'rgba(100, 116, 139, 0.4)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(startX, startY);
    const midY = (startY + endY) / 2;
    ctx.bezierCurveTo(startX, midY, endX, midY, endX, endY);
    ctx.stroke();
}

async function drawNode(ctx, x, y, user, label = null, color = '#6366f1') {
    const avatarSize = 70;
    
    // Glow Effect
    ctx.shadowBlur = 15;
    ctx.shadowColor = color;
    
    // Node Background (Glassmorphism)
    ctx.fillStyle = 'rgba(31, 41, 55, 0.8)';
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.roundRect(x - 90, y - 45, 180, 90, 15);
    ctx.fill();
    ctx.stroke();
    
    // Reset Shadow
    ctx.shadowBlur = 0;

    // Avatar Circle
    if (user.avatarUrl) {
        const img = await getAvatar(user.avatarUrl);
        if (img) {
            ctx.save();
            ctx.beginPath();
            ctx.arc(x - 45, y, avatarSize / 2, 0, Math.PI * 2);
            ctx.clip();
            ctx.drawImage(img, x - 45 - avatarSize / 2, y - avatarSize / 2, avatarSize, avatarSize);
            ctx.restore();
            
            // Avatar Border
            ctx.strokeStyle = color;
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(x - 45, y, avatarSize / 2, 0, Math.PI * 2);
            ctx.stroke();
        }
    }

    // Text Section
    ctx.textAlign = 'left';
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 16px sans-serif';
    ctx.fillText(user.username.substring(0, 10), x - 5, y - 5);
    
    if (label) {
        ctx.fillStyle = color;
        ctx.font = '500 12px sans-serif';
        ctx.fillText(label.toUpperCase(), x - 5, y + 15);
    }
}

async function generateFamilyTree(mainUser, data) {
    const canvas = createCanvas(1000, 700);
    const ctx = canvas.getContext('2d');

    // Gradient Background
    const grad = ctx.createRadialGradient(500, 350, 100, 500, 350, 600);
    grad.addColorStop(0, '#111827');
    grad.addColorStop(1, '#000000');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 1000, 700);

    const centerX = 500;
    const centerY = 350;

    // Parent Connectors
    if (data.parent) {
        drawCurve(ctx, centerX, centerY - 45, centerX, centerY - 155);
        await drawNode(ctx, centerX, centerY - 200, data.parent, 'Parent', '#10b981');
    }

    // Spouse Connector
    if (data.spouse) {
        drawCurve(ctx, centerX + 90, centerY, centerX + 210, centerY);
        await drawNode(ctx, centerX + 300, centerY, data.spouse, 'Spouse', '#ec4899');
    }

    // Children Connectors
    if (data.children && data.children.length > 0) {
        const totalWidth = (data.children.length - 1) * 250;
        const startX = centerX - totalWidth / 2;
        
        for (let i = 0; i < data.children.length; i++) {
            const childX = startX + i * 250;
            drawCurve(ctx, centerX, centerY + 45, childX, centerY + 155);
            await drawNode(ctx, childX, centerY + 200, data.children[i], 'Child', '#3b82f6');
        }
    }

    // Main User
    await drawNode(ctx, centerX, centerY, mainUser, 'You', '#6366f1');

    return canvas.toBuffer('image/png');
}

async function generateMafiaHierarchy(mafiaName, members, extraData = {}) {
    const canvas = createCanvas(1200, 1000);
    const ctx = canvas.getContext('2d');

    // Dark Background with subtle texture
    ctx.fillStyle = '#0a0a0c';
    ctx.fillRect(0, 0, 1200, 1000);
    
    // Header Info
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 40px sans-serif';
    ctx.fillText(mafiaName.toUpperCase(), 600, 60);
    
    ctx.font = '500 20px sans-serif';
    ctx.fillStyle = '#fbbf24';
    ctx.fillText(`LEVEL ${extraData.level || 1} • ${extraData.specialization || 'Unspecialized'}`, 600, 95);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.03)';
    ctx.lineWidth = 1;
    for(let i=0; i<1200; i+=40) {
        ctx.beginPath(); ctx.moveTo(i,0); ctx.lineTo(i,900); ctx.stroke();
    }
    for(let i=0; i<900; i+=40) {
        ctx.beginPath(); ctx.moveTo(0,i); ctx.lineTo(1200,i); ctx.stroke();
    }

    const rankColors = {
        'Don': '#fbbf24',
        'Consigliere': '#94a3b8',
        'Underboss': '#f87171',
        'Soldier': '#60a5fa',
        'Associate': '#9ca3af'
    };

    const ranks = ['Don', 'Consigliere', 'Underboss', 'Soldier', 'Associate'];
    const grouped = {};
    ranks.forEach(r => grouped[r] = members.filter(m => m.rank === r));

    let currentY = 120;
    const levelHeight = 200;
    const prevLevelNodes = [];

    for (let i = 0; i < ranks.length; i++) {
        const rank = ranks[i];
        const rankMembers = grouped[rank];
        if (!rankMembers || rankMembers.length === 0) continue;

        const totalWidth = (rankMembers.length - 1) * 230;
        const startX = 600 - totalWidth / 2;
        const currentLevelNodes = [];

        for (let j = 0; j < rankMembers.length; j++) {
            const x = startX + j * 230;
            currentLevelNodes.push({x, y: currentY});
            
            // Connect to previous level
            if (prevLevelNodes.length > 0) {
                const parent = prevLevelNodes[0]; // Simplified: connect all to first node of prev level or center
                drawCurve(ctx, parent.x, parent.y + 45, x, currentY - 45);
            }

            await drawNode(ctx, x, currentY, rankMembers[j], rank, rankColors[rank] || '#ffffff');
        }
        
        prevLevelNodes.length = 0;
        prevLevelNodes.push(...currentLevelNodes);
        currentY += levelHeight;
    }

    return canvas.toBuffer('image/png');
}

module.exports = { generateFamilyTree, generateMafiaHierarchy };
