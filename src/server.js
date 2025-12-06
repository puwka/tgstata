require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const path = require('path');
const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');
const { Api } = require('telegram/tl');
const supabase = require('./db');
const { verifyTelegramWebAppData } = require('./utils');

const app = express();
app.use(cors());

// Fix Content Security Policy for Images/Fonts
app.use((req, res, next) => {
    res.setHeader(
        'Content-Security-Policy',
        "default-src 'self' https://telegram.org; script-src 'self' 'unsafe-inline' https://telegram.org; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self' https:; font-src 'self' data:;"
    );
    next();
});

app.use(bodyParser.json());

const publicPath = path.join(__dirname, '../public');
app.use(express.static(publicPath));

// --- CONFIG ---
const apiId = parseInt(process.env.TG_API_ID);
const apiHash = process.env.TG_API_HASH;
const botToken = process.env.BOT_TOKEN;

// Middleware (Seamless)
const authMiddleware = async (req, res, next) => {
    const initData = req.headers['x-telegram-init-data'];
    if (!initData || !verifyTelegramWebAppData(initData, botToken)) {
        console.log('Auth failed signature');
        // return res.status(403).json({ error: 'Auth failed' }); // Strict mode
    }
    
    // Fallback for dev without initData (Mock User)
    if (!initData && process.env.NODE_ENV === 'development') {
        req.user = { id: 12345, first_name: 'Dev' };
        return next();
    }

    if (initData) {
        const searchParams = new URLSearchParams(initData);
        req.user = JSON.parse(searchParams.get('user'));
    }
    next();
};

// --- ROUTES ---

app.get('/api/stats', authMiddleware, async (req, res) => {
    try {
        if (!req.user) return res.status(401).json({ error: 'User not found' });

        // 1. Check Cache
        const { data: cached } = await supabase
            .from('user_stats')
            .select('stats_json')
            .eq('telegram_id', req.user.id)
            .single();

        if (cached) return res.json(cached.stats_json);

        // 2. Get Session
        const { data: userData } = await supabase
            .from('users')
            .select('session_string')
            .eq('telegram_id', req.user.id)
            .single();

        // MOCK DATA if no session (Seamless limitation fallback)
        if (!userData || !userData.session_string) {
            return res.json(getMockStats(req.user.first_name));
        }

        // 3. Real Analysis
        const client = new TelegramClient(
            new StringSession(userData.session_string), apiId, apiHash, { connectionRetries: 5, useWSS: false }
        );
        await client.connect();

        const stats = await calculateDeepStats(client);
        
        await client.disconnect();

        // Cache
        await supabase.from('user_stats').upsert({
            telegram_id: req.user.id,
            stats_json: stats
        });

        res.json(stats);
    } catch (e) {
        console.error('Stats error:', e);
        res.status(500).json({ error: 'Analysis failed' });
    }
});

// Helper: Deep Analysis
async function calculateDeepStats(client) {
    const stats = {
        totalMessages: 0,
        topContacts: [],
        contentType: { text: 0, photo: 0, voice: 0, video: 0, sticker: 0 },
        activeHours: {}, // 0-23
        persona: "The Ghost", // Default
        wordsCount: 0
    };

    const dialogs = await client.getDialogs({ limit: 15 });
    const oneYearAgo = Date.now() / 1000 - 31536000;

    for (const dialog of dialogs) {
        if (!dialog.isUser) continue;

        // Fetch last 100 messages per chat
        const msgs = await client.getMessages(dialog.entity, { limit: 100 });
        
        let chatCount = 0;

        msgs.forEach(msg => {
            if (msg.date < oneYearAgo) return;

            chatCount++;
            stats.totalMessages++;
            
            // Content Type
            if (msg.media) {
                if (msg.media.className === 'MessageMediaPhoto') stats.contentType.photo++;
                else if (msg.media.className === 'MessageMediaDocument') {
                     // Stickers often fall here, need check mime
                     if(msg.media.document.mimeType === 'application/x-tgsticker') stats.contentType.sticker++;
                     else if(msg.media.document.mimeType.includes('video')) stats.contentType.video++;
                     else if(msg.media.document.mimeType.includes('audio')) stats.contentType.voice++;
                }
            } else if (msg.message) {
                stats.contentType.text++;
                stats.wordsCount += msg.message.split(/\s+/).length;
            }

            // Time
            const hour = new Date(msg.date * 1000).getHours();
            stats.activeHours[hour] = (stats.activeHours[hour] || 0) + 1;
        });

        if (chatCount > 0) {
            stats.topContacts.push({
                name: dialog.title || 'Unknown',
                count: chatCount
            });
        }
    }
    
    // Sort
    stats.topContacts.sort((a, b) => b.count - a.count);
    
    // Determine Persona
    const type = stats.contentType;
    if (type.voice > type.text) stats.persona = "Podcaster 🎙️";
    else if (type.sticker > type.text) stats.persona = "Sticker Spammer 🤡";
    else if (type.photo > type.text) stats.persona = "Paparazzi 📸";
    else stats.persona = "Texter 📝";

    return stats;
}

function getMockStats(name) {
    return {
        isMock: true, // Frontend can show "Demo Mode" badge
        totalMessages: 12450,
        wordsCount: 54000,
        topContacts: [
            { name: "Pavel Durov", count: 999 },
            { name: "Mom", count: 450 },
            { name: "Work Chat", count: 120 }
        ],
        contentType: { text: 8000, photo: 2000, voice: 450, sticker: 2000 },
        activeHours: { 9: 10, 14: 50, 22: 100 },
        persona: "The Legend ⭐️"
    };
}

// Serve Frontend
app.get('/', (req, res) => {
    res.sendFile(path.join(publicPath, 'index.html'));
});

const PORT = process.env.PORT || 3000;
if (require.main === module) {
    app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
}

module.exports = app;
