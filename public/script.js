const tg = window.Telegram.WebApp;
tg.expand();
tg.ready();
tg.setHeaderColor('#0f0f13');
tg.setBackgroundColor('#0f0f13');

const API_URL = '/api';

/* --- STATE --- */
let currentSlide = 0;
const slides = document.querySelectorAll('.glass-card');
const total = slides.length;

/* --- LOCALIZATION --- */
const i18n = {
    ru: {
        title_1: "Итоги 2024", sub_1: "Твой год в Telegram", unit_ready: "Готов узнать?",
        title_2: "Легенда", sub_2: "Ты с нами уже", unit_days: "Дней",
        title_3: "Общение", sub_3: "Отправлено сообщений", unit_msgs: "Сообщений",
        title_4: "Голос", sub_4: "Любишь поговорить", unit_voice: "Голосовых",
        title_5: "Призрак", sub_5: "Заходил, но молчал", unit_times: "Раз",
        title_6: "Серия", sub_6: "Заходил подряд", unit_days_row: "Дней",
    }
};

/* --- INIT --- */
async function init() {
    createProgress();
    
    // Apply Lang
    if (tg.initDataUnsafe?.user?.language_code === 'ru') {
        applyLang(i18n.ru);
    }

    try {
        const headers = { 'Content-Type': 'application/json' };
        if (tg.initData) headers['X-Telegram-Init-Data'] = tg.initData;

        const res = await fetch(`${API_URL}/stats`, { headers });
        const data = await res.json();
        
        populate(data);
        document.getElementById('loader').style.display = 'none';

    } catch (e) {
        console.error(e);
        document.getElementById('loader').style.display = 'none'; // Allow showing static UI at least
    }
}

function applyLang(dict) {
    document.querySelectorAll('[data-key]').forEach(el => {
        const k = el.getAttribute('data-key');
        if (dict[k]) el.innerText = dict[k];
    });
}

function createProgress() {
    const box = document.getElementById('progress-bar');
    box.innerHTML = '';
    for(let i=0; i<total; i++) {
        box.innerHTML += `<div class="prog-seg"><div class="prog-fill" id="p-${i}"></div></div>`;
    }
    updateProgress();
}

function updateProgress() {
    for(let i=0; i<total; i++) {
        const el = document.getElementById(`p-${i}`);
        if(i < currentSlide) el.className = 'prog-fill done';
        else if(i === currentSlide) el.className = 'prog-fill done'; // Fill current immediately
        else el.className = 'prog-fill';
    }
}

function populate(stats) {
    const user = tg.initDataUnsafe?.user;
    if (user?.first_name) document.getElementById('user-name').innerText = user.first_name;

    animateVal("days-on-tg", stats.daysOnTg || 100);
    animateVal("total-msgs", stats.totalMessages || 500);
    animateVal("stat-voice", stats.voices || 0);
    animateVal("ghost-count", stats.ghostModeCount || 20);
    animateVal("days-streak", stats.daysStreak || 5);
    
    // Calculate year
    const joinYear = new Date().getFullYear() - Math.floor((stats.daysOnTg||0)/365);
    document.getElementById('join-year').innerText = joinYear > 2013 ? joinYear : 2013;
}

function animateVal(id, end) {
    const el = document.getElementById(id);
    if(!el) return;
    let start = 0;
    const dur = 1500;
    let startTime = null;
    
    const step = (ts) => {
        if(!startTime) startTime = ts;
        const prog = Math.min((ts - startTime)/dur, 1);
        const ease = 1 - Math.pow(1 - prog, 3); // Cubic ease out
        el.innerText = Math.floor(ease * end).toLocaleString();
        if(prog < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
}

/* --- NAV --- */
window.nextSlide = function() {
    if(currentSlide < total - 1) {
        slides[currentSlide].classList.remove('active');
        currentSlide++;
        slides[currentSlide].classList.add('active');
        updateProgress();
    } else {
        tg.close();
    }
}

window.prevSlide = function() {
    if(currentSlide > 0) {
        slides[currentSlide].classList.remove('active');
        currentSlide--;
        slides[currentSlide].classList.add('active');
        updateProgress();
    }
}

init();
