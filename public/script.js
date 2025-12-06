const tg = window.Telegram.WebApp;
tg.expand();
tg.ready();

const API_URL = '/api'; // Relative path since frontend & backend are on same port

// Utility: Headers with InitData
const getHeaders = () => ({
    'Content-Type': 'application/json',
    'X-Telegram-Init-Data': tg.initData
});

// State Management
const views = {
    loader: document.getElementById('loader-view'),
    auth: document.getElementById('auth-view'),
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

// 1. App Init
async function init() {
    try {
        const res = await fetch(`${API_URL}/status`, { headers: getHeaders() });
        const data = await res.json();
        
        if (data.authenticated) {
            loadStats();
        } else {
            showView('auth');
        }
    } catch (e) {
        tg.showAlert('Error connecting to server');
        // Show auth as fallback if server check fails, might be network issue or first load
        showView('auth'); 
    }
}

// 2. Auth Logic
window.sendCode = async function() {
    const phone = document.getElementById('phone-input').value;
    if (!phone) return tg.showAlert('Enter phone number');
    
    tg.MainButton.showProgress();
    
    try {
        const res = await fetch(`${API_URL}/auth/send-code`, {
            method: 'POST',
            headers: getHeaders(),
            body: JSON.stringify({ phoneNumber: phone })
        });
        
        const data = await res.json();
        if (data.success) {
            document.getElementById('step-phone').style.display = 'none';
            document.getElementById('step-code').style.display = 'block';
        } else {
            tg.showAlert(data.error || 'Error sending code');
        }
    } catch (e) {
        tg.showAlert('Network Error');
    } finally {
        tg.MainButton.hideProgress();
    }
}

window.signIn = async function() {
    const code = document.getElementById('code-input').value;
    const password = document.getElementById('pass-input').value;
    
    if (!code) return tg.showAlert('Enter code');
    
    views.auth.innerHTML = '<div class="loader"></div><p>Verifying & Analyzing...</p>';
    
    try {
        const res = await fetch(`${API_URL}/auth/sign-in`, {
            method: 'POST',
            headers: getHeaders(),
            body: JSON.stringify({ code, password })
        });
        
        const data = await res.json();
        if (data.success) {
            loadStats();
        } else {
            tg.showAlert(data.error || 'Auth failed');
            window.location.reload();
        }
    } catch (e) {
        tg.showAlert('Network Error');
        window.location.reload();
    }
}

// 3. Stats Logic
async function loadStats() {
    showView('loader');
    const loaderText = document.getElementById('loader-text');
    if(loaderText) loaderText.innerText = "Analyzing messages (this may take a minute)...";

    try {
        const res = await fetch(`${API_URL}/stats`, { headers: getHeaders() });
        const stats = await res.json();
        
        if (stats.error) {
             tg.showAlert(stats.error);
             return;
        }

        renderDashboard(stats);
        showView('dashboard');
    } catch (e) {
        tg.showAlert('Failed to load stats');
    }
}

function renderDashboard(stats) {
    // Animation for numbers
    document.getElementById('total-msgs').textContent = stats.totalMessages.toLocaleString();
    document.getElementById('words-count').textContent = stats.wordsCount.toLocaleString();
    
    // Top Contact
    if (stats.topContacts && stats.topContacts.length > 0) {
        const top = stats.topContacts[0];
        document.getElementById('top-contact').textContent = top.name;
        document.getElementById('top-contact-count').textContent = `${top.count} messages`;
    } else {
        document.getElementById('top-contact').textContent = "None";
    }

    // Peak Hour Logic
    const hours = stats.activeHours;
    let peak = 12;
    if (hours && Object.keys(hours).length > 0) {
        peak = Object.keys(hours).reduce((a, b) => hours[a] > hours[b] ? a : b, 12);
    }
    document.getElementById('peak-hour').textContent = `${peak}:00`;
}

// Start
init();

