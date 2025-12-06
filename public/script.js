const tg = window.Telegram.WebApp;
tg.expand();
tg.ready();

const API_URL = '/api';

const getHeaders = () => ({
    'Content-Type': 'application/json',
    'X-Telegram-Init-Data': tg.initData
});

const views = {
    loader: document.getElementById('loader-view'),
    dashboard: document.getElementById('dashboard-view')
};

const showView = (name) => {
    Object.values(views).forEach(el => el.style.display = 'none');
    if (name === 'dashboard') {
        views[name].style.display = 'grid';
    } else {
        views[name].style.display = 'flex';
    }
};

// Automatic Seamless Init
async function init() {
    if (!tg.initData) {
        console.warn('No initData available.');
    }

    // Immediately load stats. Auth is handled via headers automatically.
    loadStats();
}

async function loadStats() {
    showView('loader');
    const loaderText = document.getElementById('loader-text');
    if(loaderText) loaderText.innerText = "Analyzing your profile...";

    try {
        const res = await fetch(`${API_URL}/stats`, { headers: getHeaders() });
        
        if (res.status === 401) {
             tg.showAlert("Session expired or invalid.");
             return;
        }
        
        const stats = await res.json();
        
        if (stats.error) {
             // If "No Session" error comes from backend, we show zeros or mock data
             console.warn(stats.error);
        }

        renderDashboard(stats);
        showView('dashboard');
    } catch (e) {
        console.error(e);
        tg.showAlert('Failed to connect to server');
    }
}

function renderDashboard(stats) {
    // Fill with data or zeros if empty
    document.getElementById('total-msgs').textContent = (stats.totalMessages || 0).toLocaleString();
    document.getElementById('words-count').textContent = (stats.wordsCount || 0).toLocaleString();
    
    // Top Contact
    if (stats.topContacts && stats.topContacts.length > 0) {
        const top = stats.topContacts[0];
        document.getElementById('top-contact').textContent = top.name;
        document.getElementById('top-contact-count').textContent = `${top.count} messages`;
    } else {
        document.getElementById('top-contact').textContent = "No data available";
        document.getElementById('top-contact-count').textContent = "Need MTProto Session";
    }

    // Peak Hour Logic
    const hours = stats.activeHours || {};
    let peak = "--";
    if (Object.keys(hours).length > 0) {
        peak = Object.keys(hours).reduce((a, b) => hours[a] > hours[b] ? a : b, 12);
        peak = `${peak}:00`;
    }
    document.getElementById('peak-hour').textContent = peak;
}

// Start immediately
init();
