import { API_URL, MATCH_ID } from './config.js';
import { handleServerResponse, refreshUI } from './ui.js';
import { showSelectBowlerModal } from './modals.js';

export async function updateScore(action, value = null, extraData = {}) {
    if (!MATCH_ID) {
        alert("Error: Match ID is missing");
        return;
    }
    try {
        const payload = { match_id: MATCH_ID, action, value, ...extraData };
        console.log('Sending Payload:', payload);

        const response = await fetch(`${API_URL}/update_score`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const errText = await response.text();
            throw new Error(`Server returned ${response.status}: ${errText}`);
        }

        const data = await response.json();
        console.log('Score updated:', data);

        handleServerResponse(data);
    } catch (error) {
        console.error('Error updating score:', error);
    }
}

export async function undoLastAction() {
    if (!confirm("Are you sure you want to Undo the last ball?")) return;
    try {
        console.log("Undoing last action...");
        const response = await fetch(`${API_URL}/undo_last_action`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ match_id: MATCH_ID })
        });
        const data = await response.json();
        if (data.status === 'success') {
            console.log("Undo successful", data);
            if (data.data) {
                refreshUI(data.data);
            } else {
                fetch(`${API_URL}/match_data?match_id=${MATCH_ID}`)
                    .then(r => r.json())
                    .then(d => refreshUI(d));
            }
        } else {
            alert("Undo Failed: " + (data.message || "Unknown error"));
        }
    } catch (e) {
        console.error(e);
        alert("Undo Request Failed");
    }
}

export async function endInning() {
    try {
        console.log("Ending Inning...");
        const response = await fetch(`${API_URL}/end_inning`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ match_id: MATCH_ID })
        });
        const data = await response.json();
        handleServerResponse(data);
    } catch (e) {
        console.error(e);
        alert("Failed to end inning");
    }
}

export async function saveSquadToBackend(teamId, playerIds) {
    // renamed from saveSquad to avoid confusion with the window.saveSquad UI handler
    // But user asked to move "saveSquad (API part)" here.
    // The original code had window.saveSquad doing both UI and API.
    // I am splitting it. This function performs the fetch.

    try {
        const mId = MATCH_ID || 1;
        const res = await fetch(`${API_URL}/matches/${mId}/select_squad`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ team_id: parseInt(teamId), player_ids: playerIds })
        });
        const data = await res.json();
        return data; // Return full data to let UI handle success/error message
    } catch (e) {
        console.error(e);
        throw e;
    }
}
export async function endMatch(matchId) {
    try {
        const response = await fetch(`${API_URL}/end_match`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ match_id: matchId })
        });
        return await response.json();
    } catch (e) {
        console.error("End Match Error:", e);
        return { status: "error", message: e.message };
    }
}

export async function rotateStrike(matchId) {
    try {
        const res = await fetch(`${API_URL}/matches/${matchId}/rotate_strike`, {
            method: 'POST'
        });
        return await res.json();
    } catch (e) {
        console.error("Error rotating strike:", e);
    }
}


export async function uploadLogo(teamId, fileInput) {
    const file = fileInput.files[0];
    if (!file) return alert("Please select a file first");

    const formData = new FormData();
    formData.append("file", file);

    try {
        const response = await fetch(`/api/teams/${teamId}/upload_logo`, {
            method: 'POST',
            body: formData // No headers needed, browser sets multipart/form-data auto
        });

        const data = await response.json();

        if (data.status === 'success') {
            alert("Logo Uploaded!");
            // Refresh to see the new logo
            location.reload();
        } else {
            alert("Upload Failed: " + data.message);
        }
    } catch (error) {
        console.error("Error:", error);
        alert("Upload Error");
    }
}

export async function updatePlayer(playerId, payload) {
    try {
        const res = await fetch(`${API_URL}/players/${playerId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        return await res.json();
    } catch (e) {
        console.error("Update Player Error:", e);
        return { status: "error", message: e.message };
    }
}

// --- LIVE STREAM LOGIC (SSE) ---
let eventSource = null;

export function initLiveScore(matchId) {
    if (!matchId) return;

    // 1. Close existing connection if any (prevents duplicates)
    if (eventSource) {
        console.log("⚠️ Closing previous SSE connection");
        eventSource.close();
    }

    console.log(`📡 Connecting to SSE Stream for Match ${matchId}...`);

    // 2. Open Connection
    eventSource = new EventSource(`${API_URL}/stream/${matchId}`);

    // 3. Listen for Updates
    eventSource.onmessage = function (event) {
        // Parse the JSON data sent by Python
        const data = JSON.parse(event.data);
        // console.log("⚡ SSE Update:", data); // Uncomment for debug

        // Dynamically import UI to avoid circular dependency issues
        import('./ui.js').then(ui => {
            if (ui.refreshUI) ui.refreshUI(data);
        });
    };

    // 4. Handle Errors (Auto-reconnect is built-in to browser)
    eventSource.onerror = function (err) {
        // Browser will auto-retry connection in ~3 seconds
        // We only log warnings to keep console clean
        if (eventSource.readyState === EventSource.CLOSED) {
            console.warn("⚠️ Stream Closed.");
        } else {
            // console.warn("⚠️ Stream interrupted. Reconnecting...");
        }
    };
}