const tg = window.Telegram.WebApp;
tg.expand();
tg.ready();

// Force dark theme colors
tg.setHeaderColor('#000000');
tg.setBackgroundColor('#000000');

const API_URL = '/api';

/* --- STATE --- */
let currentSlide = 0;
const slides = document.querySelectorAll('.slide');
const totalSlides = slides.length; // Will be updated on init

/* --- INIT --- */
async function init() {
    try {
        const headers = { 'Content-Type': 'application/json' };
        if (tg.initData) headers['X-Telegram-Init-Data'] = tg.initData;

        const res = await fetch(`${API_URL}/stats`, { headers });
        const data = await res.json();
        
        populateData(data);
        
        document.getElementById('loader-view').style.display = 'none';
        document.getElementById('app').style.display = 'block';
        
        // Re-select slides as they are now visible
        updateSlideState();

    } catch (e) {
        console.error(e);
        tg.showAlert("Failed to load data.");
    }
}

function updateSlideState() {
    const allSlides = document.querySelectorAll('.slide');
    allSlides.forEach((s, i) => {
        if (i === currentSlide) s.classList.add('active');
        else s.classList.remove('active');
    });
}

/* --- DATA POPULATION --- */
function populateData(stats) {
    // Numbers animation helper
    const animateValue = (id, start, end, duration) => {
        const obj = document.getElementById(id);
        if (!obj) return;
        let startTimestamp = null;
        const step = (timestamp) => {
            if (!startTimestamp) startTimestamp = timestamp;
            const progress = Math.min((timestamp - startTimestamp) / duration, 1);
            obj.innerHTML = Math.floor(progress * (end - start) + start).toLocaleString();
            if (progress < 1) {
                window.requestAnimationFrame(step);
            }
        };
        window.requestAnimationFrame(step);
    };

    // 1. Days on TG
    animateValue("days-on-tg", 0, stats.daysOnTg || 365, 2000);

    // 2. Total Messages
    animateValue("total-msgs", 0, stats.totalMessages || 1000, 2000);

    // 3. Voice
    const type = stats.contentType || {};
    animateValue("stat-voice", 0, type.voice || 0, 2000);

    // 4. Video Notes (Circles)
    animateValue("stat-video", 0, stats.videoNotes || type.video_note || 0, 2000);

    // 5. Ghost Mode
    animateValue("ghost-count", 0, stats.ghostModeCount || 50, 2000);

    // 6. Streak
    animateValue("days-streak", 0, stats.daysStreak || 10, 2000);
}

/* --- NAVIGATION --- */
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
