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

// Dynamic import for node-fetch (ESM module)
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

const app = express();
app.use(cors());

// Fix Content Security Policy for Images/Fonts
app.use((req, res, next) => {
    res.setHeader(
        'Content-Security-Policy',
        "default-src 'self' https://telegram.org https://api.telegram.org; script-src 'self' 'unsafe-inline' https://telegram.org; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self' https:; font-src 'self' data:;"
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
    }
    
    // Fallback for dev without initData
    if (!initData && process.env.NODE_ENV === 'development') {
        req.user = { id: 12345, first_name: 'Dev', is_premium: true, language_code: 'en' };
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

        // 1. Try to fetch REAL profile photo from Bot API
        let photoUrl = null;
        try {
            photoUrl = await getUserProfilePhoto(req.user.id);
        } catch (err) {
            console.error('Failed to fetch photo:', err);
        }

        // 2. Try to get REAL session if exists
        const { data: userData } = await supabase
            .from('users')
            .select('session_string')
            .eq('telegram_id', req.user.id)
            .single();

        // 3. If NO session -> Use Advanced Heuristics + Bot Data
        if (!userData || !userData.session_string) {
            const stats = getHeuristicStats(req.user);
            stats.photoUrl = photoUrl; // Add real photo
            return res.json(stats);
        }

        // 4. Real Analysis
        const client = new TelegramClient(
            new StringSession(userData.session_string), apiId, apiHash, { connectionRetries: 5, useWSS: false }
        );
        await client.connect();
        const stats = await calculateDeepStats(client);
        await client.disconnect();
        
        stats.photoUrl = photoUrl; // Add real photo

        res.json(stats);
    } catch (e) {
        console.error('Stats error:', e);
        res.json(getHeuristicStats(req.user || {}));
    }
});

// Helper: Fetch Photo from Bot API
async function getUserProfilePhoto(userId) {
    if (!botToken) return null;
    try {
        // 1. Get File ID
        const res = await fetch(`https://api.telegram.org/bot${botToken}/getUserProfilePhotos?user_id=${userId}&limit=1`);
        const data = await res.json();
        
        if (data.ok && data.result.total_count > 0) {
            // Get biggest size
            const photo = data.result.photos[0];
            const fileId = photo[photo.length - 1].file_id;
            
            // 2. Get File Path
            const fileRes = await fetch(`https://api.telegram.org/bot${botToken}/getFile?file_id=${fileId}`);
            const fileData = await fileRes.json();
            
            if (fileData.ok) {
                // 3. Construct URL
                return `https://api.telegram.org/file/bot${botToken}/${fileData.result.file_path}`;
            }
        }
    } catch (e) {
        console.warn('Photo fetch failed', e);
    }
    return null;
}

// ... (calculateDeepStats remains the same) ...
async function calculateDeepStats(client) {
    const stats = {
        totalMessages: 0,
        topContacts: [],
        contentType: { text: 0, photo: 0, voice: 0, video: 0, sticker: 0 },
        activeHours: {},
        persona: "The Ghost",
        wordsCount: 0
    };

    const dialogs = await client.getDialogs({ limit: 15 });
    const oneYearAgo = Date.now() / 1000 - 31536000;

    for (const dialog of dialogs) {
        if (!dialog.isUser) continue;
        const msgs = await client.getMessages(dialog.entity, { limit: 100 });
        let chatCount = 0;
        msgs.forEach(msg => {
            if (msg.date < oneYearAgo) return;
            chatCount++;
            stats.totalMessages++;
            if (msg.media) {
                if (msg.media.className === 'MessageMediaPhoto') stats.contentType.photo++;
                else if (msg.media.className === 'MessageMediaDocument') {
                     if(msg.media.document.mimeType === 'application/x-tgsticker') stats.contentType.sticker++;
                     else if(msg.media.document.mimeType.includes('video')) stats.contentType.video++;
                     else if(msg.media.document.mimeType.includes('audio')) stats.contentType.voice++;
                }
            } else if (msg.message) {
                stats.contentType.text++;
                stats.wordsCount += msg.message.split(/\s+/).length;
            }
            const hour = new Date(msg.date * 1000).getHours();
            stats.activeHours[hour] = (stats.activeHours[hour] || 0) + 1;
        });
        if (chatCount > 0) stats.topContacts.push({ name: dialog.title || 'Unknown', count: chatCount });
    }
    stats.topContacts.sort((a, b) => b.count - a.count);
    return stats;
}


// ... (getHeuristicStats remains the same) ...
function getHeuristicStats(user) {
    const id = user.id || 0;
    
    let ageMultiplier = 1;
    let baseMessages = 5000;
    
    if (id < 300000000) { ageMultiplier = 4.5; baseMessages = 25000; } 
    else if (id < 1000000000) { ageMultiplier = 3.0; baseMessages = 15000; }
    else if (id < 5000000000) { ageMultiplier = 1.5; baseMessages = 8000; }

    if (user.is_premium) {
        ageMultiplier *= 1.5; 
    }

    const rng = (seed) => {
        const x = Math.sin(id + seed) * 10000;
        return x - Math.floor(x);
    };

    const totalMessages = Math.floor(baseMessages * ageMultiplier * (0.8 + rng(1) * 0.4));
    const wordsCount = Math.floor(totalMessages * (4 + rng(2) * 6));

    let persona = "The Networker 🌐";
    let type = { text: 0, photo: 0, voice: 0, sticker: 0 };
    
    const styleVal = rng(3);
    
    if (user.is_premium && styleVal > 0.6) {
        persona = "Storyteller 🌟"; 
        type = distribute(totalMessages, [0.4, 0.3, 0.1, 0.2]); 
    } else if (styleVal > 0.8) {
        persona = "Podcaster 🎙️";
        type = distribute(totalMessages, [0.3, 0.1, 0.5, 0.1]);
    } else if (styleVal < 0.2) {
        persona = "Meme Lord 🐸";
        type = distribute(totalMessages, [0.3, 0.4, 0.0, 0.3]);
    } else {
        persona = "Texter 📝";
        type = distribute(totalMessages, [0.8, 0.1, 0.05, 0.05]);
    }

    const activeHours = {};
    const peakHour = Math.floor(10 + rng(4) * 12); 
    activeHours[peakHour] = Math.floor(rng(5) * 500);

    return {
        isHeuristic: true,
        totalMessages,
        wordsCount,
        topContacts: [
            { name: "Telegram", count: Math.floor(totalMessages * 0.05) },
            { name: "Saved Messages", count: Math.floor(totalMessages * 0.03) },
            { name: user.username ? `@${user.username}` : "Me", count: Math.floor(totalMessages * 0.02) }
        ],
        contentType: type,
        activeHours,
        persona
    };
}

function distribute(total, ratios) {
    return {
        text: Math.floor(total * ratios[0]),
        photo: Math.floor(total * ratios[1]),
        voice: Math.floor(total * ratios[2]),
        sticker: Math.floor(total * ratios[3])
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
