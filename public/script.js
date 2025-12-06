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
const totalSlides = slides.length;
let autoAdvanceTimer = null;
const SLIDE_DURATION = 5000; // 5 seconds per slide

/* --- INIT --- */
async function init() {
    // 1. Setup UI
    createProgressBars();
    
    // 2. Fetch Data
    try {
        const headers = { 'Content-Type': 'application/json' };
        if (tg.initData) headers['X-Telegram-Init-Data'] = tg.initData;

        const res = await fetch(`${API_URL}/stats`, { headers });
        const data = await res.json();
        
        // 3. Populate Data
        populateData(data);
        
        // 4. Start Show
        document.getElementById('loader-view').style.display = 'none';
        document.getElementById('story-container').style.display = 'block';
        startSlide(0);

    } catch (e) {
        console.error(e);
        tg.showAlert("Failed to load data. Please try again.");
    }
}

/* --- DATA POPULATION --- */
function populateData(stats) {
    // Name
    const user = tg.initDataUnsafe?.user;
    if (user?.first_name) document.getElementById('user-name').textContent = user.first_name;

    // Photo
    if (stats.photoUrl) {
        document.getElementById('user-photo').src = stats.photoUrl;
        document.getElementById('user-photo-container').style.display = 'block';
        document.getElementById('default-emoji').style.display = 'none';
    }

    // Slide 2: Numbers
    document.getElementById('total-msgs').textContent = (stats.totalMessages || 0).toLocaleString();
    document.getElementById('words-count').textContent = (stats.wordsCount || 0).toLocaleString();

    // Slide 3: Content
    const type = stats.contentType || {};
    document.getElementById('stat-text').textContent = (type.text || 0).toLocaleString();
    document.getElementById('stat-photo').textContent = (type.photo || 0).toLocaleString();
    document.getElementById('stat-voice').textContent = (type.voice || 0).toLocaleString();
    document.getElementById('stat-sticker').textContent = (type.sticker || 0).toLocaleString();
    document.getElementById('persona-type').textContent = stats.persona || "User";

    // Slide 4: Top Contact
    if (stats.topContacts && stats.topContacts.length > 0) {
        document.getElementById('top-contact-name').textContent = stats.topContacts[0].name;
        document.getElementById('top-contact-count').textContent = stats.topContacts[0].count + " messages";
    }
}

/* --- STORY LOGIC --- */
function createProgressBars() {
    const container = document.getElementById('progress-container');
    container.innerHTML = '';
    for (let i = 0; i < totalSlides; i++) {
        const seg = document.createElement('div');
        seg.className = 'progress-segment';
        seg.innerHTML = `<div class="progress-fill" id="prog-${i}"></div>`;
        container.appendChild(seg);
    }
}

function startSlide(index) {
    if (index < 0 || index >= totalSlides) return;
    
    // Reset previous slides
    slides.forEach((s, i) => {
        s.classList.remove('active');
        // Reset animations
        s.querySelectorAll('.animate-up, .animate-zoom').forEach(el => {
            el.style.animation = 'none';
            el.offsetHeight; /* trigger reflow */
            el.style.animation = ''; 
        });
    });

    // Reset progress bars
    for(let i=0; i<totalSlides; i++) {
        const bar = document.getElementById(`prog-${i}`);
        bar.className = 'progress-fill'; // reset
        if (i < index) bar.classList.add('completed');
    }

    // Activate current
    currentSlide = index;
    slides[index].classList.add('active');
    
    // Animate active progress
    setTimeout(() => {
        document.getElementById(`prog-${index}`).classList.add('active');
    }, 10);

    // Timer REMOVED per user request
    clearTimeout(autoAdvanceTimer);
    // if (index < totalSlides - 1) { 
    //     autoAdvanceTimer = setTimeout(() => nextSlide(), SLIDE_DURATION);
    // }
}

window.nextSlide = function() {
    if (currentSlide < totalSlides - 1) {
        document.getElementById(`prog-${currentSlide}`).classList.add('completed'); // Force complete current bar
        startSlide(currentSlide + 1);
    } else {
        // Close app on last slide tap? Or just stay.
        // Telegram.WebApp.close(); 
    }
};

window.prevSlide = function() {
    if (currentSlide > 0) {
        startSlide(currentSlide - 1);
    }
};

// Start
init();
