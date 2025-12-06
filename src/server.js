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

// Fix Content Security Policy
app.use((req, res, next) => {
    res.setHeader(
        'Content-Security-Policy',
        "default-src 'self' https://telegram.org; script-src 'self' 'unsafe-inline' https://telegram.org; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self' https:;"
    );
    next();
});

app.use(bodyParser.json());

// FIX: Correct path for Vercel environment
const publicPath = path.join(__dirname, '../public');
app.use(express.static(publicPath));

// --- CONFIG ---
const apiId = parseInt(process.env.TG_API_ID);
const apiHash = process.env.TG_API_HASH;
const botToken = process.env.BOT_TOKEN;

// Middleware for validation (Seamless Auth)
const authMiddleware = async (req, res, next) => {
    const initData = req.headers['x-telegram-init-data'];
    
    // Strict verification of Telegram signature
    if (!initData || !verifyTelegramWebAppData(initData, botToken)) {
        // For development outside TG, you might want to relax this, 
        // but for security it must be strict.
        console.log('Auth failed for initData');
        return res.status(403).json({ error: 'Invalid authentication signature' });
    }
    
    const searchParams = new URLSearchParams(initData);
    const userStr = searchParams.get('user');
    if (!userStr) {
        return res.status(403).json({ error: 'User data missing' });
    }
    req.user = JSON.parse(userStr);
    next();
};

// --- ROUTES ---

// 1. Get Stats (Seamless)
app.get('/api/stats', authMiddleware, async (req, res) => {
    try {
        // A. Check cache first
        const { data: cached } = await supabase
            .from('user_stats')
            .select('stats_json')
            .eq('telegram_id', req.user.id)
            .single();

        if (cached) return res.json(cached.stats_json);

        // B. Try to get active session
        const { data: userData } = await supabase
            .from('users')
            .select('session_string')
            .eq('telegram_id', req.user.id)
            .single();

        // C. If NO session (which happens for new users now that we removed login),
        // we cannot physically read messages. We return a "Lite" or "Empty" response.
        if (!userData || !userData.session_string) {
            return res.json({
                totalMessages: 0,
                wordsCount: 0,
                topContacts: [{ name: "Demo User", count: 0 }],
                activeHours: {},
                warning: "No MTProto session available. Only bot-accessible data can be shown."
            });
        }

        // D. If session exists (from old login or other source), calculate stats
        const client = new TelegramClient(
            new StringSession(userData.session_string), apiId, apiHash, { connectionRetries: 5, useWSS: false }
        );
        
        await client.connect();

        const stats = {
            totalMessages: 0,
            topContacts: [],
            activeHours: {},
            wordsCount: 0
        };

        const dialogs = await client.getDialogs({ limit: 10 });
        
        for (const dialog of dialogs) {
            if (!dialog.isUser) continue; 

            const msgs = await client.getMessages(dialog.entity, { limit: 50 }); 
            
            let chatCount = 0;
            const oneYearAgo = Date.now() / 1000 - 31536000;

            msgs.forEach(msg => {
                if (msg.date > oneYearAgo) {
                    chatCount++;
                    stats.totalMessages++;
                    
                    if (msg.message) stats.wordsCount += msg.message.split(' ').length;
                    
                    const hour = new Date(msg.date * 1000).getHours();
                    stats.activeHours[hour] = (stats.activeHours[hour] || 0) + 1;
                }
            });

            if (chatCount > 0) {
                stats.topContacts.push({
                    name: dialog.title || 'Unknown',
                    count: chatCount
                });
            }
        }
        
        stats.topContacts.sort((a, b) => b.count - a.count);

        await client.disconnect();

        // Cache result
        await supabase.from('user_stats').upsert({
            telegram_id: req.user.id,
            stats_json: stats
        });

        res.json(stats);
    } catch (e) {
        console.error('Stats error:', e);
        // Fallback instead of crash
        res.json({
             totalMessages: 0,
             wordsCount: 0,
             topContacts: [],
             error: "Analysis failed or timed out"
        });
    }
});

// Explicitly serve index.html for root route
app.get('/', (req, res) => {
    res.sendFile(path.join(publicPath, 'index.html'));
});

// Vercel Export Handler
const PORT = process.env.PORT || 3000;
if (require.main === module) {
    app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
}

module.exports = app;
