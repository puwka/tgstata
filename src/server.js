require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
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
app.use(express.static('public'));

// --- CONFIG ---
const apiId = parseInt(process.env.TG_API_ID);
const apiHash = process.env.TG_API_HASH;
const botToken = process.env.BOT_TOKEN;

// Middleware for validation
const authMiddleware = async (req, res, next) => {
    const initData = req.headers['x-telegram-init-data'];
    // Allow bypassing auth for dev/testing if needed, but strictly enforce in prod
    if (!initData || !verifyTelegramWebAppData(initData, botToken)) {
        console.log('Auth failed for initData:', initData);
        return res.status(403).json({ error: 'Invalid authentication' });
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

// 1. Check status
app.get('/api/status', authMiddleware, async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('users')
            .select('session_string')
            .eq('telegram_id', req.user.id)
            .single();

        if (error && error.code !== 'PGRST116') { // PGRST116 is "Row not found"
            console.error('Supabase error:', error);
        }

        if (data && data.session_string) {
            return res.json({ authenticated: true });
        }
        return res.json({ authenticated: false });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// 2. Start login: Send code
app.post('/api/auth/send-code', authMiddleware, async (req, res) => {
    const { phoneNumber } = req.body;
    
    if (!apiId || !apiHash) {
        return res.status(500).json({ error: 'Server misconfigured (API_ID/HASH missing)' });
    }

    const client = new TelegramClient(new StringSession(''), apiId, apiHash, {
        connectionRetries: 5,
        useWSS: false 
    });
    
    try {
        await client.connect();
        
        const { phoneCodeHash } = await client.sendCode(
            { apiId, apiHash },
            phoneNumber
        );
        
        // SERVERLESS CHANGE: Store hash in DB, not memory
        await supabase.from('auth_temp').upsert({
            telegram_id: req.user.id,
            phone_hash: phoneCodeHash,
            phone_number: phoneNumber
        });
        
        res.json({ success: true, message: 'Code sent' });
    } catch (e) {
        console.error('Send code error:', e);
        res.status(400).json({ error: e.message || 'Failed to send code' });
    }
});

// 3. Complete login: Sign in
app.post('/api/auth/sign-in', authMiddleware, async (req, res) => {
    const { code, password } = req.body;
    
    // SERVERLESS CHANGE: Retrieve hash from DB
    const { data: cache } = await supabase
        .from('auth_temp')
        .select('*')
        .eq('telegram_id', req.user.id)
        .single();

    if (!cache) return res.status(400).json({ error: 'Session expired, try again' });

    const { phone_hash: phoneCodeHash, phone_number: phoneNumber } = cache;

    const client = new TelegramClient(new StringSession(''), apiId, apiHash, {
        connectionRetries: 5,
        useWSS: false
    });

    try {
        await client.connect(); // Need to reconnect in new instance

        await client.invoke(
            new Api.auth.SignIn({
                phoneNumber,
                phoneCodeHash,
                phoneCode: code,
            })
        );
    } catch (e) {
        if (e.message.includes('SESSION_PASSWORD_NEEDED')) {
            try {
                await client.signIn({ password, phoneNumber, phoneCode: code, phoneCodeHash });
            } catch (innerE) {
                console.error('2FA error:', innerE);
                return res.status(400).json({ error: innerE.message });
            }
        } else {
            console.error('Sign in error:', e);
            return res.status(400).json({ error: e.message });
        }
    }

    const sessionString = client.session.save();
    
    // Save session to DB
    const { error } = await supabase.from('users').upsert({
        telegram_id: req.user.id,
        session_string: sessionString
    });

    if (error) console.error('DB Save error:', error);

    // Cleanup
    await supabase.from('auth_temp').delete().eq('telegram_id', req.user.id);
    await client.disconnect();
    
    res.json({ success: true });
});

// 4. Get Stats
app.get('/api/stats', authMiddleware, async (req, res) => {
    try {
        // Check cache
        const { data: cached } = await supabase
            .from('user_stats')
            .select('stats_json')
            .eq('telegram_id', req.user.id)
            .single();

        if (cached) return res.json(cached.stats_json);

        // Get session
        const { data: userData } = await supabase
            .from('users')
            .select('session_string')
            .eq('telegram_id', req.user.id)
            .single();

        if (!userData) return res.status(401).json({ error: 'Not authorized' });

        const client = new TelegramClient(
            new StringSession(userData.session_string), apiId, apiHash, { connectionRetries: 5, useWSS: false }
        );
        
        // Vercel Timeout Warning: This connects to Telegram, which takes time.
        // If analysis takes > 10s (default Vercel timeout), this will crash.
        // We limit messages heavily here.
        await client.connect();

        // --- ANALYTICS ---
        const stats = {
            totalMessages: 0,
            topContacts: [],
            activeHours: {},
            wordsCount: 0
        };

        const dialogs = await client.getDialogs({ limit: 10 });
        
        for (const dialog of dialogs) {
            if (!dialog.isUser) continue; 

            const msgs = await client.getMessages(dialog.entity, { limit: 50 }); // Reduced limit for Vercel safety
            
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
        res.status(500).json({ error: 'Failed to calculate stats' });
    }
});

// Vercel Export Handler
const PORT = process.env.PORT || 3000;
if (require.main === module) {
    app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
}

module.exports = app;
