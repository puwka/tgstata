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

// Dynamic import for node-fetch
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

const app = express();
app.use(cors());

// CSP: Allow LottieFiles (CDN assets), Telegram CDN
app.use((req, res, next) => {
    res.setHeader(
        'Content-Security-Policy',
        "default-src 'self' https://telegram.org https://api.telegram.org; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://unpkg.com https://telegram.org; style-src 'self' 'unsafe-inline'; img-src 'self' data: https: blob:; connect-src 'self' https: blob:; font-src 'self' data:; frame-src 'self' https://lottie.host https://assets.lottiefiles.com;"
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

const authMiddleware = async (req, res, next) => {
    const initData = req.headers['x-telegram-init-data'];
    if (!initData && process.env.NODE_ENV === 'development') {
        req.user = { id: 123456789, first_name: 'Dev', is_premium: true, language_code: 'en' };
        return next();
    }
    if (initData) {
        const searchParams = new URLSearchParams(initData);
        req.user = JSON.parse(searchParams.get('user'));
    }
    next();
};

app.get('/api/stats', authMiddleware, async (req, res) => {
    try {
        if (!req.user) return res.status(401).json({ error: 'User not found' });

        // Try fetch real photo
        let photoUrl = null;
        try { photoUrl = await getUserProfilePhoto(req.user.id); } catch (e) {}

        // Use Heuristics (Since we want "no code" flow mostly)
        const stats = getAccurateHeuristics(req.user);
        stats.photoUrl = photoUrl;
        
        res.json(stats);
    } catch (e) {
        console.error(e);
        res.json(getAccurateHeuristics(req.user || {}));
    }
});

async function getUserProfilePhoto(userId) {
    if (!botToken) return null;
    const res = await fetch(`https://api.telegram.org/bot${botToken}/getUserProfilePhotos?user_id=${userId}&limit=1`);
    const data = await res.json();
    if (data.ok && data.result.total_count > 0) {
        const photo = data.result.photos[0];
        const fileId = photo[photo.length - 1].file_id;
        const fileRes = await fetch(`https://api.telegram.org/bot${botToken}/getFile?file_id=${fileId}`);
        const fileData = await fileRes.json();
        if (fileData.ok) return `https://api.telegram.org/file/bot${botToken}/${fileData.result.file_path}`;
    }
    return null;
}

// --- NEW ACCURATE LOGIC ---
function getAccurateHeuristics(user) {
    const id = user.id || 0;
    
    // 1. Precise ID-to-Date Mapping (Based on public Telegram data points)
    const idBenchmarks = [
        { id: 100000, date: '2013-10-01' }, // Early days
        { id: 10000000, date: '2014-05-01' },
        { id: 100000000, date: '2015-02-01' }, // 100M
        { id: 300000000, date: '2016-12-01' },
        { id: 600000000, date: '2018-06-01' },
        { id: 1000000000, date: '2019-12-01' }, // 1B (approx)
        { id: 2000000000, date: '2021-09-01' },
        { id: 5000000000, date: '2022-03-01' }, // 64-bit ID shift
        { id: 6000000000, date: '2023-05-01' },
        { id: 7000000000, date: '2024-01-01' }
    ];

    let joinDate = new Date('2024-01-01');
    for (let i = 0; i < idBenchmarks.length; i++) {
        if (id < idBenchmarks[i].id) {
            joinDate = new Date(idBenchmarks[i].date);
            break;
        }
    }
    
    const now = new Date();
    const daysOnTg = Math.floor((now - joinDate) / (1000 * 60 * 60 * 24));
    
    // 2. Realistic Activity Volume
    // Average user: 20-50 msgs/day
    // Active user: 100+ msgs/day
    const rng = (seed) => { const x = Math.sin(id + seed) * 10000; return x - Math.floor(x); };
    
    let dailyAvg = 15 + Math.floor(rng(1) * 30); // 15-45 msgs/day base
    if (user.is_premium) dailyAvg += 40; // Premium users talk more
    if (user.username && user.username.length < 6) dailyAvg += 20; // Short username = OG/Active
    
    const totalMessages = Math.floor(daysOnTg * dailyAvg * 0.4); // 0.4 factor because people aren't active EVERY day

    // 3. Content Style (Realistic Ratios)
    const typeRng = rng(2);
    let ratios = { text: 0.85, photo: 0.05, voice: 0.03, sticker: 0.05, video: 0.02 };
    
    if (typeRng > 0.8) { // Media lover
        ratios = { text: 0.60, photo: 0.20, voice: 0.05, sticker: 0.10, video: 0.05 };
    } else if (typeRng < 0.2) { // Voice lover
        ratios = { text: 0.50, photo: 0.05, voice: 0.40, sticker: 0.05, video: 0.0 };
    }

    const wordsCount = Math.floor(totalMessages * ratios.text * 5); // Avg 5 words per text
    const videoNotes = Math.floor(totalMessages * ratios.video);
    const voices = Math.floor(totalMessages * ratios.voice);

    // 4. Fun Metrics
    const ghostMode = Math.floor(daysOnTg * (0.5 + rng(3))); // Opened app without typing
    const streak = Math.floor(5 + rng(4) * 30); // 5-35 days streak

    return {
        isHeuristic: true,
        daysOnTg: Math.max(1, daysOnTg), // Ensure at least 1
        totalMessages,
        wordsCount,
        videoNotes,
        voices,
        ghostModeCount: ghostMode,
        daysStreak: streak,
        photoUrl: null, // Filled by route
        activeHours: { 12: 100 }, // Dummy for chart if needed
        topContacts: [
            { name: "Telegram", count: 1 },
            { name: "Saved Messages", count: 1 }
        ] 
    };
}

app.get('/', (req, res) => {
    res.sendFile(path.join(publicPath, 'index.html'));
});

const PORT = process.env.PORT || 3000;
if (require.main === module) {
    app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
}

module.exports = app;
