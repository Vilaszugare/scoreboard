
// Player Profile Logic
import { API_URL } from './config.js';

import { openEditPlayerModal } from './edit_player.js';

let isProfileCssLoaded = false;
let isProfileHtmlLoaded = false;

export async function openPlayerProfileModal(playerId) {
    if (!playerId) {
        alert("Player ID missing");
        return;
    }

    // 1. Ensure CSS is loaded
    if (!isProfileCssLoaded) {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = '../static/css/player_profile.css';
        document.head.appendChild(link);
        isProfileCssLoaded = true;
    }

    // 2. Ensure HTML is loaded
    if (!isProfileHtmlLoaded || !document.getElementById('playerProfileModal')) {
        try {
            // FIX: Using absolute path from root as 'pages' is mounted at '/'
            const resp = await fetch('/player_profile.html');
            if (resp.ok) {
                const html = await resp.text();
                document.body.insertAdjacentHTML('beforeend', html);
                isProfileHtmlLoaded = true;
            } else {
                console.error("Failed to load profile HTML");
                alert("Error loading profile module");
                return;
            }
        } catch (e) {
            console.error(e);
            return;
        }
    }

    // 3. Fetch Player Data
    // Attempt to find player in current match data first (fastest) - contains CURRENT MATCH STATS
    let player = findPlayerInMatch(playerId) || { id: playerId };

    // Fetch Full Career Stats from Backend
    try {
        const res = await fetch(`${API_URL}/players/${playerId}`);
        if (res.ok) {
            const fullStats = await res.json();
            // Merge: We want 'player' (Current) to overwrite API basic info if needed,
            // BUT we want API Career stats to be available.
            // Since API now uses 'career_runs' vs 'runs', no conflict on stats.
            player = { ...fullStats, ...player };
            // Note: 'player' (from UI) has 'runs', 'balls' etc. (Current)
            // 'fullStats' (from API) has 'career_runs', 'career_balls' etc. and basic info.
        } else {
            console.warn("Player Stats fetch failed", res.status);
        }
    } catch (e) {
        console.warn("Could not fetch career stats", e);
    }

    // 4. Populate Modal
    populateProfileModal(player);

    // Attach Edit Button Listener
    // Attach Edit Button Listener
    const modalEl = document.getElementById('playerProfileModal');
    if (modalEl) {
        const editBtn = modalEl.querySelector('.pp-edit-btn');
        if (editBtn) {
            editBtn.onclick = () => {
                // Close profile modal first? Or keep it open?
                // Usually keeping it open is better context, but depends on UX.
                // The user image shows Edit Modal *over* something (maybe profile).
                // Let's just open it on top.
                openEditPlayerModal(player);
            };
        }
    }

    // 5. Show Modal
    const modal = document.getElementById('playerProfileModal');
    if (modal) modal.showModal();
}

function findPlayerInMatch(playerId) {
    const data = window.currentMatchData;
    if (!data) return null;

    // Check Batsmen
    if (data.current_batsmen) {
        const p = data.current_batsmen.find(b => b.id === playerId);
        if (p) return { ...p, team: data.batting_team };
    }

    // Check Bowler
    if (data.current_bowler && data.current_bowler.id === playerId) {
        return { ...data.current_bowler, team: data.bowling_team };
    }

    return null;
}

function populateProfileModal(player) {
    // Basic Info
    setText('pp_header_name', player.name || "Unknown Player");
    setText('pp_role', player.role || "Player");
    setText('pp_team', player.team_name || player.team || "--");

    // Avatar
    const img = document.getElementById('pp_avatar');
    if (img) img.src = player.photo_url || "../static/images/player_placeholder.png";

    // Current Match Stats (Batting)
    setText('pp_cur_runs', player.runs !== undefined ? player.runs : "-");
    setText('pp_cur_balls', player.balls !== undefined ? player.balls : "-");
    setText('pp_cur_4s', player.fours !== undefined ? player.fours : "-");
    setText('pp_cur_6s', player.sixes !== undefined ? player.sixes : "-");
    setText('pp_cur_sr', player.sr !== undefined ? player.sr : "-");

    // Career Stats
    setText('pp_car_mat', player.matches || 0);
    setText('pp_car_inng', player.innings || 0);
    setText('pp_car_runs', player.career_runs || 0);
    setText('pp_car_balls', player.career_balls || 0);
    setText('pp_car_4s', player.career_fours || 0);
    setText('pp_car_6s', player.career_sixes || 0);

    setText('pp_car_best', player.best_score || 0);
    setText('pp_car_sr', player.career_sr || 0);
    setText('pp_car_avg', player.career_avg || 0);
}

function setText(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
}
