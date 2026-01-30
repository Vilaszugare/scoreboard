// frontend/static/js/main.js
import { bootstrap } from './ui.js';
import { initButtons } from './events.js';
import { initModals } from './modals.js';
import { API_URL, MATCH_ID } from './config.js';
import './squad.js'; // Ensure switchTab is exposed

console.log("🚀 App Started");

// Global variable to control polling
let pollingInterval = null;

function startLiveUpdates(matchId) {
    if (pollingInterval) clearInterval(pollingInterval);

    console.log("📡 Starting Live Updates for Viewers...");

    pollingInterval = setInterval(async () => {
        // 1. Check if the tab is visible
        if (document.hidden) return;

        try {
            // 2. Fetch the latest data silently
            // Uses the correct endpoint structure: /match_data?match_id=...
            const response = await fetch(`${API_URL}/match_data?match_id=${matchId}`);

            if (response.ok) {
                const data = await response.json();

                // 3. Update the UI silently
                import('./ui.js').then(ui => {
                    if (ui.refreshUI) ui.refreshUI(data);
                });
            }
        } catch (e) {
            console.warn("Live update failed, retrying...", e);
        }
    }, 2000); // 2 seconds
}

// Stop updates when leaving
window.addEventListener('beforeunload', () => {
    if (pollingInterval) clearInterval(pollingInterval);
});

document.addEventListener('DOMContentLoaded', () => {
    console.log("✅ DOM Loaded. Initializing App...");
    initButtons();
    initModals();
    bootstrap();

    if (MATCH_ID) {
        startLiveUpdates(MATCH_ID);
    }
});

window.refreshMatchData = bootstrap;

// --- EXPOSE FUNCTIONS TO HTML (The Bridge) ---

// 1. Rotate Strike Logic
window.rotateStrike = async function () {
    const btn = document.getElementById('btn_rotate_strike');
    if (btn) btn.classList.add('spin-once'); // Start Animation

    if (!MATCH_ID) return alert("Error: No Match ID");

    try {
        console.log("🔄 Rotating Strike...");
        const response = await fetch(`${API_URL}/matches/${MATCH_ID}/rotate_strike`, {
            method: 'POST'
        });

        if (response.ok) {
            console.log("✅ Strike Rotated!");
            setTimeout(() => { if (btn) btn.classList.remove('spin-once'); }, 500);

            // Re-use built-in refresh wrapper if available or reload
            const resData = await response.json();
            import('./ui.js').then(ui => {
                if (ui.refreshUI && resData) ui.refreshUI(resData);
                else window.location.reload();
            });
        } else {
            alert("Failed to rotate strike");
        }
    } catch (e) {
        console.error(e);
        alert("Network Error");
    }
};

// 2. Open Modal Logic

// 3. Zoom Control Logic
let currentZoom = 100;

window.changeZoom = function (amount) {
    currentZoom += amount;

    // Set Limits (e.g., minimum 50%, maximum 150%)
    if (currentZoom < 50) currentZoom = 50;
    if (currentZoom > 150) currentZoom = 150;

    // Apply Style
    document.body.style.zoom = `${currentZoom}%`;

    // Update Text
    const zoomText = document.getElementById('zoom-text');
    if (zoomText) {
        zoomText.textContent = `${currentZoom}%`;
    }
};

window.togglePlayerOverlay = function (playerId) {
    console.log("Toggle Overlay for Player ID:", playerId);
    alert("Toggle Overlay Feature Coming Soon!");
};


// 119: window.openPlayerProfile = function (playerId) {
// 120:     console.log("Open Profile for Player ID:", playerId);
// 121:     // alert("Player Profile Modal Coming Soon!");
//          // Redirect to new Module
//          import('./player_profile.js').then(mod => {
//              mod.openPlayerProfileModal(playerId);
//          });
// 122: };

window.openPlayerProfile = function (playerId) {
    import('./player_profile.js')
        .then(module => {
            module.openPlayerProfileModal(playerId);
        })
        .catch(err => console.error("Failed to load profile module", err));
};


