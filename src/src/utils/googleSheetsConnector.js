const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');
const fs = require('fs');
const path = require('path');

async function getGoogleSheetsClient(spreadsheetId) {
    const credsPath = path.join(__dirname, '../../credentials.json');
    if (!fs.existsSync(credsPath)) throw new Error('Missing credentials.json');
    const credentials = require(credsPath);

    const auth = new JWT({
        email: credentials.client_email,
        key: credentials.private_key,
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    const doc = new GoogleSpreadsheet(spreadsheetId, auth);
    await doc.loadInfo();
    return doc;
}

async function addAdTrackingRecord(spreadsheetId, userId, username, amount, timestamp) {
    const doc = await getGoogleSheetsClient(spreadsheetId);
    
    let sheet = doc.sheetsByTitle['AdsTracker'];
    if (!sheet) {
        sheet = await doc.addSheet({ title: 'AdsTracker', headerValues: ['UserID', 'Username', 'Amount', 'Timestamp'] });
    }

    await sheet.addRow({
        UserID: userId,
        Username: username,
        Amount: amount,
        Timestamp: timestamp
    });
}

async function exportR4WeeklyData(spreadsheetId, weekId, data) {
    const doc = await getGoogleSheetsClient(spreadsheetId);
    
    let sheet = doc.sheetsByTitle['R4Weekly'];
    if (!sheet) {
        sheet = await doc.addSheet({ title: 'R4Weekly', headerValues: ['UserID', 'WeekID', 'Ads', 'Messages', 'ProgressPct', 'Status'] });
    }

    // Add all records
    for (const record of data) {
        await sheet.addRow({
            UserID: record.userId,
            WeekID: record.weekId,
            Ads: record.ads,
            Messages: record.messages,
            ProgressPct: record.progressPct + '%',
            Status: record.status
        });
    }
}

module.exports = {
    addAdTrackingRecord,
    exportR4WeeklyData
};
