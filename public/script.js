const tg = window.Telegram.WebApp;
tg.expand();
tg.ready();

// Force colors
tg.setHeaderColor('#000000');
tg.setBackgroundColor('#000000');

const API_URL = '/api';

/* --- LOCALIZATION --- */
const translations = {
    en: {
        title_1: "Rising Star!", sub_1: "You joined Telegram", unit_days: "days ago",
        title_2: "Chatterbox", sub_2: "Total messages sent", unit_msgs: "messages",
        title_3: "Voice Master", sub_3: "You prefer to be heard", unit_voice: "voice messages",
        title_4: "Camera Lover", sub_4: "Video circles recorded", unit_video: "circles",
        title_5: "Ghost Mode", sub_5: "Opened app but silent", unit_times: "times",
        title_6: "Addicted?", sub_6: "Longest daily streak", unit_days_row: "days in a row",
        btn_next: "Continue", btn_back: "Back", btn_close: "Close App"
    },
    ru: {
        title_1: "Восходящая звезда!", sub_1: "Ты в Telegram уже", unit_days: "дней",
        title_2: "Болтун года", sub_2: "Всего отправлено сообщений", unit_msgs: "сообщений",
        title_3: "Голос улиц", sub_3: "Тебя точно было слышно", unit_voice: "голосовых",
        title_4: "Камера тебя любит", sub_4: "Записано видео-кружков", unit_video: "кружков",
        title_5: "Режим призрака", sub_5: "Заходил, но молчал", unit_times: "раз",
        title_6: "Зависимость?", sub_6: "Самый долгий стрик", unit_days_row: "дней подряд",
        btn_next: "Продолжить", btn_back: "Назад", btn_close: "Закрыть"
    }
};

/* --- STATE --- */
let currentSlide = 0;

/* --- INIT --- */
async function init() {
    // 1. Apply Lang immediately
    applyLocalization();

    // 2. Fetch Data
    try {
        const headers = { 'Content-Type': 'application/json' };
        if (tg.initData) headers['X-Telegram-Init-Data'] = tg.initData;

        // Timeout fetch to avoid hanging forever
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 8000); // 8 sec max

        const res = await fetch(`${API_URL}/stats`, { 
            headers, 
            signal: controller.signal 
        });
        clearTimeout(timeoutId);

        const data = await res.json();
        populateData(data);

    } catch (e) {
        console.error("Fetch failed:", e);
        // If fail, we still show UI with zeros, don't block user
        tg.showAlert("Data loading failed, showing demo.");
    } finally {
        // ALWAYS hide loader
        document.getElementById('loader').style.display = 'none';
        document.getElementById('app').style.display = 'block';
        updateSlideState();
    }
}

// SAFETY NET: Hide loader after 5s anyway if JS hangs
setTimeout(() => {
    const loader = document.getElementById('loader');
    const app = document.getElementById('app');
    if (loader && loader.style.display !== 'none') {
        console.warn("Force hiding loader");
        loader.style.display = 'none';
        app.style.display = 'block';
        updateSlideState();
    }
}, 5000);

function applyLocalization() {
    try {
        const lang = (tg.initDataUnsafe?.user?.language_code === 'ru') ? 'ru' : 'en';
        const texts = translations[lang];
        if (!texts) return;
        
        document.querySelectorAll('[data-key]').forEach(el => {
            const key = el.getAttribute('data-key');
            if (texts[key]) el.textContent = texts[key];
        });
    } catch(e) { console.warn(e); }
}

function updateSlideState() {
    const allSlides = document.querySelectorAll('.slide');
    allSlides.forEach((s, i) => {
        if (i === currentSlide) s.classList.add('active');
        else s.classList.remove('active');
    });
}

function populateData(stats) {
    if (!stats) return;

    const animateValue = (id, start, end, duration) => {
        const obj = document.getElementById(id);
        if (!obj) return;
        let startTimestamp = null;
        const step = (timestamp) => {
            if (!startTimestamp) startTimestamp = timestamp;
            const progress = Math.min((timestamp - startTimestamp) / duration, 1);
            // Ease Out Quart
            const ease = 1 - Math.pow(1 - progress, 4);
            obj.innerHTML = Math.floor(ease * (end - start) + start).toLocaleString();
            if (progress < 1) window.requestAnimationFrame(step);
        };
        window.requestAnimationFrame(step);
    };

    animateValue("days-on-tg", 0, stats.daysOnTg || 100, 2000);
    animateValue("total-msgs", 0, stats.totalMessages || 500, 2000);
    animateValue("stat-voice", 0, stats.voices || 0, 2000);
    animateValue("stat-video", 0, stats.videoNotes || 0, 2000);
    animateValue("ghost-count", 0, stats.ghostModeCount || 10, 2000);
    animateValue("days-streak", 0, stats.daysStreak || 1, 2000);

    // Photo
    if (stats.photoUrl) {
        const img = document.getElementById('user-photo');
        const cont = document.getElementById('user-photo-container');
        if(img && cont) {
            img.src = stats.photoUrl;
            cont.style.display = 'block';
        }
    }
}

window.nextSlide = function() {
    const allSlides = document.querySelectorAll('.slide');
    if (currentSlide < allSlides.length - 1) {
        currentSlide++;
        updateSlideState();
    } else {
        tg.close();
    }
};

window.prevSlide = function() {
    if (currentSlide > 0) {
        currentSlide--;
        updateSlideState();
    }
};

// Start
init();
