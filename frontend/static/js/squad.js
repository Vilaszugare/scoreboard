import { API_URL } from './config.js';
import { saveSquadToBackend } from './api.js';
import { fetchAndRenderCommentary } from './commentary.js';

export function switchTab(tabName) {
    const panels = ['matchCenterPanel', 'squadPanel', 'scorecardPanel', 'graphPanel', 'commentaryPanel'];
    panels.forEach(p => {
        const el = document.getElementById(p);
        if (el) el.style.display = 'none';
    });

    if (tabName === 'match') {
        const el = document.getElementById('matchCenterPanel');
        if (el) el.style.display = 'grid';
    } else if (tabName === 'squad') {
        const el = document.getElementById('squadPanel');
        if (el) el.style.display = 'block';
        loadTeams();
    } else if (tabName === 'scorecard') {
        const el = document.getElementById('scorecardPanel');
        if (el) el.style.display = 'block';
        if (window.loadScorecard) window.loadScorecard();
    } else if (tabName === 'graph') {
        const el = document.getElementById('graphPanel');
        if (el) el.style.display = 'block';
    } else if (tabName === 'commentary') {
        const el = document.getElementById('commentaryPanel');
        if (el) el.style.display = 'block';
        fetchAndRenderCommentary(1); // Default to 1st Inning
    }

    const buttons = document.querySelectorAll('.tab-bar button');
    buttons.forEach(btn => {
        btn.classList.remove('active');
        if (tabName === 'match' && btn.textContent.trim() === 'Match Center') btn.classList.add('active');
        if (tabName === 'squad' && btn.textContent.includes('Squad')) btn.classList.add('active');
        if (tabName === 'scorecard' && btn.textContent.includes('Scorecard')) btn.classList.add('active');
        if (tabName === 'graph' && btn.textContent.includes('Graph')) btn.classList.add('active');
        if (tabName === 'commentary' && btn.textContent.includes('Commentary')) btn.classList.add('active');
    });
}

async function loadTeams() {
    try {
        const res = await fetch(`${API_URL}/teams`);
        const data = await res.json();
        const select = document.getElementById('squadTeamSelect');
        if (!select) return;
        const currentVal = select.value;
        select.innerHTML = '<option value="" disabled selected>Select Team...</option>';
        if (data.teams) {
            data.teams.forEach(t => {
                const opt = document.createElement('option');
                opt.value = t.id;
                opt.textContent = t.name;
                select.appendChild(opt);
            });
        }
        if (currentVal) select.value = currentVal;
    } catch (e) { console.error(e); }
}

export async function loadSquadPlayers() {
    const select = document.getElementById('squadTeamSelect');
    if (!select) return;
    const teamId = select.value;
    if (!teamId) return;

    const list = document.getElementById('squadList');
    if (!list) return;

    list.innerHTML = '<div style="color:#888; grid-column:1/-1; text-align:center;">Loading...</div>';

    try {
        const res = await fetch(`${API_URL}/teams/${teamId}/players`);
        const data = await res.json();

        list.innerHTML = '';
        if (data.players) {
            data.players.forEach(p => {
                const label = document.createElement('label');
                label.className = 'squad-item';
                label.style.display = 'flex';
                label.style.alignItems = 'center';
                label.style.background = '#222';
                label.style.padding = '12px';
                label.style.borderRadius = '8px';
                label.style.cursor = 'pointer';
                label.style.border = '1px solid #333';
                label.onmouseover = () => label.style.background = '#2a2a2a';
                label.onmouseout = () => label.style.background = '#222';

                const checkbox = document.createElement('input');
                checkbox.type = 'checkbox';
                checkbox.value = p.id;
                checkbox.style.width = '18px';
                checkbox.style.height = '18px';
                checkbox.style.marginRight = '12px';
                checkbox.onchange = updateSquadCount;

                label.appendChild(checkbox);

                const info = document.createElement('div');
                info.innerHTML = `<div style="font-weight:600; font-size:15px; color:#eee;">${p.name}</div><div style="font-size:13px;color:#888; margin-top:2px;">${p.role || 'Player'}</div>`;
                label.appendChild(info);

                list.appendChild(label);
            });
        }
        updateSquadCount();
    } catch (e) {
        list.innerHTML = 'Error loading players.';
        console.error(e);
    }
}

export function updateSquadCount() {
    const list = document.getElementById('squadList');
    if (!list) return;
    const checked = list.querySelectorAll('input:checked').length;
    const countEl = document.getElementById('squadCount');
    if (countEl) {
        countEl.textContent = checked;
        if (checked > 11) {
            countEl.style.color = '#ff3b3b'; // Red
        } else if (checked === 11) {
            countEl.style.color = '#2db34a'; // Green
        } else {
            countEl.style.color = '#2b66ff'; // Blue
        }
    }
}

export async function saveSquad() {
    const select = document.getElementById('squadTeamSelect');
    if (!select) return;
    const teamId = select.value;
    if (!teamId) return alert("Select a Team");

    const list = document.getElementById('squadList');
    if (!list) return;
    const checkboxes = list.querySelectorAll('input:checked');
    if (checkboxes.length !== 11) {
        if (!confirm(`You have selected ${checkboxes.length} players. Official playing 11 squad is recommended. Proceed anyway?`)) return;
    }

    const playerIds = Array.from(checkboxes).map(cb => parseInt(cb.value));

    const btn = document.getElementById('saveSquadBtn');
    if (!btn) return;
    const oldText = btn.textContent;
    btn.textContent = "Saving...";
    btn.disabled = true;

    try {
        const data = await saveSquadToBackend(teamId, playerIds);
        if (data.status === 'success') {
            alert("Squad Saved Successfully!");
        } else {
            alert("Error: " + (data.message || "Unknown"));
        }
    } catch (e) {
        console.error(e);
        alert("Request Failed");
    } finally {
        btn.textContent = oldText;
        btn.disabled = false;
    }
}

// Expose to window for HTML calls
window.switchTab = switchTab;
window.loadSquadPlayers = loadSquadPlayers;
window.saveSquad = saveSquad;
window.updateSquadCount = updateSquadCount; // Used in checkbox onchange (generated in JS but still good to expose or just use function reference)
// NOTE: updateSquadCount is attached as `checkbox.onchange = updateSquadCount` in `loadSquadPlayers`.
// Since `loadSquadPlayers` is in this module, it uses the local `updateSquadCount` function.
// So exposing it to window is not strictly necessary for the checkboxes, but might be useful for debugging.
