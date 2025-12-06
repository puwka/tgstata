const crypto = require('crypto');

/**
 * Validates the data received from Telegram WebApp
 * @param {string} telegramInitData - The initData string from WebApp
 * @param {string} botToken - Your Telegram Bot Token
 * @returns {boolean} - True if valid
 */
function verifyTelegramWebAppData(telegramInitData, botToken) {
    if (!telegramInitData || !botToken) return false;

    const initData = new URLSearchParams(telegramInitData);
    const hash = initData.get('hash');
    const dataToCheck = [];
    
    initData.sort();
    initData.forEach((val, key) => {
        if (key !== 'hash') dataToCheck.push(`${key}=${val}`);
    });

    const secret = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
    const _hash = crypto.createHmac('sha256', secret).update(dataToCheck.join('\n')).digest('hex');

    return _hash === hash;
}

module.exports = { verifyTelegramWebAppData };

