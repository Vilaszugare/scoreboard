import { API_URL, MATCH_ID } from './config.js';
import { refreshUI } from './ui.js';

let targetBatsmanRole = 'striker';
let currentBattingSquad = [];

export function initModals() {
    console.log("Initializing Modals...");

    // --- CONFIRM BUTTON ---
    const confirmBtn = document.getElementById('confirmBatsmanBtn');
    if (confirmBtn) {
        console.log("Found confirmBatsmanBtn");
        const newBtn = confirmBtn.cloneNode(true);
        confirmBtn.parentNode.replaceChild(newBtn, confirmBtn);

        newBtn.addEventListener('click', async () => {
            console.log("Confirm Batsman Clicked");
            const select = document.getElementById('newBatsmanSelect');
            const newPlayerId = select.value;

            if (!newPlayerId) return;

            console.log(`Setting ${targetBatsmanRole} to player ${newPlayerId}`);

            try {
                const response = await fetch(`${API_URL}/matches/${MATCH_ID}/set_batsman`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        match_id: MATCH_ID, // Still sending match_id for Pydantic validation if needed, though unused in route logic
                        new_player_id: parseInt(newPlayerId),
                        role: targetBatsmanRole
                    })
                });
                const data = await response.json();
                const modal = document.getElementById('newBatsmanModal');
                if (modal) modal.close();

                refreshUI(data);
            } catch (error) {
                console.error("Error setting batsman", error);
                alert("Failed to set new batsman.");
            }
        });
    } else {
        console.error("confirmBatsmanBtn NOT found");
    }

    // --- BOWLER BUTTON ---
    const confirmBowlerBtn = document.getElementById('confirmBowlerBtn');
    if (confirmBowlerBtn) {
        const newBtn = confirmBowlerBtn.cloneNode(true);
        confirmBowlerBtn.parentNode.replaceChild(newBtn, confirmBowlerBtn);

        newBtn.addEventListener('click', async () => {
            const select = document.getElementById('bowlerSelect');
            const newBowlerId = select.value;
            if (!newBowlerId) return;
            try {
                const response = await fetch(`${API_URL}/set_bowler`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ match_id: MATCH_ID, new_player_id: parseInt(newBowlerId) })
                });
                const data = await response.json();
                document.getElementById('selectBowlerModal').close();
                if (data) {
                    import('./ui.js').then(module => {
                        if (module.refreshUI) module.refreshUI(data);
                    });
                } else refreshUI(data);
            } catch (error) {
                console.error("Error setting bowler", error);
                alert("Failed to set bowler.");
            }
        });
    }

    // --- CANCEL BUTTON ---
    const cancelBtn = document.getElementById('cancelBatsmanBtn');
    if (cancelBtn) {
        console.log("Found cancelBatsmanBtn, attaching listener.");
        // Use a more direct approach for debugging: add listener directly, removing old just in case
        const newBtn = cancelBtn.cloneNode(true);
        cancelBtn.parentNode.replaceChild(newBtn, cancelBtn);

        newBtn.addEventListener('click', (e) => {
            e.preventDefault(); // Good practice
            console.log("Cancel Batsman Clicked");
            const modal = document.getElementById('newBatsmanModal');
            if (modal) {
                modal.close();
                console.log("Modal closed via Cancel button");
            } else {
                console.error("Modal not found when cancelling");
            }
        });
    } else {
        console.error("cancelBatsmanBtn NOT found in DOM");
    }

    // --- BACKDROP CLICK ---
    function closeOnBackdrop(dialogId) {
        const dialog = document.getElementById(dialogId);
        if (!dialog) {
            console.error(`Dialog ${dialogId} not found for backdrop listener`);
            return;
        }
        console.log(`Adding backdrop listener to ${dialogId}`);
        dialog.addEventListener('click', (event) => {
            const rect = dialog.getBoundingClientRect();
            // Check if click is outside the dialog bounds
            const isInDialog = (rect.top <= event.clientY && event.clientY <= rect.top + rect.height &&
                rect.left <= event.clientX && event.clientX <= rect.left + rect.width);

            // For <dialog>, clicking on the backdrop is usually clicking on the element itself,
            // BUT checking intersection is safer if padding/layout is tricky.
            // Standard approach: event.target === dialog

            if (event.target === dialog) {
                console.log(`Backdrop clicked on ${dialogId}`);
                dialog.close();
            }
        });
    }

    closeOnBackdrop('newBatsmanModal');
    closeOnBackdrop('selectBowlerModal');
}

export async function openBatsmanModal(title, teamId) {
    console.log(`🚀 Opening Batsman Modal for Team: ${teamId}, Role: ${targetBatsmanRole}`);

    // 1. We reuse the existing <dialog id="newBatsmanModal"> container
    const modal = document.getElementById('newBatsmanModal');

    // 2. Fetch the HTML Template
    try {
        const t = new Date().getTime();
        // NOTE: Uses same path logic as bowler modal
        // backend mounts frontend/pages at root
        let response = await fetch(`/modal_batsman.html?t=${t}`);
        if (!response.ok) response = await fetch(`modal_batsman.html?t=${t}`);
        if (!response.ok) throw new Error("Batsman template not found");

        const htmlText = await response.text();
        modal.innerHTML = htmlText;

        // Update Title dynamically (e.g., "Select Striker")
        const titleEl = modal.querySelector('#batsmanModalTitle');
        if (titleEl && title) titleEl.textContent = title;

    } catch (e) {
        console.error(e);
        alert("Error loading interface");
        return;
    }

    // 3. Fetch Available Players (Batting Squad)
    try {
        // We use the available_players endpoint which filters out players who are already out
        const url = `${API_URL}/available_players?match_id=${MATCH_ID}&team_id=${teamId}`;
        const res = await fetch(url);
        const data = await res.json();
        currentBattingSquad = data.players || [];
    } catch (e) {
        console.error(e);
        currentBattingSquad = [];
    }

    // 4. Render List
    renderBatsmanList(currentBattingSquad);

    // 5. Attach Events

    // Close
    modal.querySelector('#closeBatsmanModal').onclick = () => modal.close();

    // Search
    const searchInput = modal.querySelector('#batterSearchInput');
    if (searchInput) {
        searchInput.onkeyup = (e) => {
            const query = e.target.value.toLowerCase();
            const filtered = currentBattingSquad.filter(p => p.name.toLowerCase().includes(query));
            renderBatsmanList(filtered);
        };
    }

    // Add New Batter
    const addBtn = modal.querySelector('#btnAddNewBatter');
    if (addBtn) {
        const nameInput = modal.querySelector('#newBatterNameInput');

        // 1. ADD ENTER KEY LISTENER
        if (nameInput) {
            nameInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    addBtn.click();
                }
            });
        }

        addBtn.onclick = async () => {
            const name = nameInput.value.trim();
            if (!name) return alert("Enter a name");

            // Use the teamId passed to this function
            if (!teamId) return alert("Error: Batting Team ID missing");

            addBtn.textContent = "Saving...";
            addBtn.disabled = true;

            try {
                const res = await fetch(`${API_URL}/players/quick_add`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name: name, team_id: teamId, role: 'Batsman' })
                });

                if (res.ok) {
                    const result = await res.json();
                    // FIX: Backend returns the player object directly, not wrapped in 'player'
                    // If backend returns { "id": 1, "name": "Vilas", ... }
                    currentBattingSquad.unshift(result);

                    renderBatsmanList(currentBattingSquad);
                    nameInput.value = "";
                    nameInput.focus(); // Keep focus for rapid entry
                } else {
                    alert("Failed to add batter");
                }
            } catch (e) { console.error(e); }
            finally {
                addBtn.textContent = "Add New Batter";
                addBtn.disabled = false;
            }
        };
    }

    modal.showModal();
}

function renderBatsmanList(players) {
    const container = document.getElementById('batterListContainer');
    if (!container) return;
    container.innerHTML = "";

    if (players.length === 0) {
        container.innerHTML = "<div style='padding:20px; text-align:center; color:#ccc;'>No players available. Add one!</div>";
        return;
    }

    players.forEach((p, idx) => {
        const row = document.createElement('div');
        row.className = 'player-row-red';

        // SELECT LOGIC
        row.onclick = async () => {
            if (!confirm(`Select ${p.name} as ${targetBatsmanRole}?`)) return;

            try {
                // Determine if we need to call 'set_batsman' 
                // We use the existing endpoint structure
                const response = await fetch(`${API_URL}/matches/${MATCH_ID}/set_batsman`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        match_id: MATCH_ID, // ensure pydantic validation passes
                        new_player_id: p.id,
                        role: targetBatsmanRole // 'striker' or 'non_striker'
                    })
                });

                if (response.ok) {
                    const data = await response.json();
                    document.getElementById('newBatsmanModal').close();
                    if (window.refreshUI) window.refreshUI(data);
                    else {
                        import('./ui.js').then(module => {
                            if (module.refreshUI) module.refreshUI(data);
                            else location.reload();
                        });
                    }
                } else {
                    alert("Failed to set batsman");
                }
            } catch (e) { console.error(e); }
        };

        row.innerHTML = `
            <div class="col-idx">${idx + 1}.</div>
            <div class="col-name-wide">
                <span style="font-size:18px; margin-right:8px;">🏏</span> ${p.name}
            </div>
        `;
        container.appendChild(row);
    });
}

export async function handleWicketFall(data) {
    console.log("Wicket Fall Detected:", data);

    // 1. Force Immediate UI Refresh to show the "Empty Slot" (Red Button)
    // We manually clear the card of the dismissed player to give instant feedback
    if (window.refreshMatchData) {
        window.refreshMatchData();
    }

    // 2. Open the Modal to pick the new player
    // Pass the team ID so we pick from the correct squad
    const battingTeamId = data.batting_team_id || window.currentMatchData?.batting_team_id;

    setTimeout(() => {
        openBatsmanModal("Select New Batsman", battingTeamId);
    }, 300);
}


// Global variable for filtering


let currentBowlingSquad = [];

// MAIN FUNCTION
export async function showSelectBowlerModal() {
    console.log("🚀 ACTIVATING NEW RED MODAL...");
    const modal = document.getElementById('selectBowlerModal');

    // 1. Fetch HTML
    try {
        const timestamp = new Date().getTime();
        // backend/main.py mounts 'frontend/pages' at root '/'
        // So 'frontend/pages/modal_bowler.html' is available at '/modal_bowler.html'
        let response = await fetch(`/modal_bowler.html?t=${timestamp}`);

        if (!response.ok) {
            console.warn("Root fetch failed, trying relative...");
            // Fallback: Try relative if base path is different
            response = await fetch(`modal_bowler.html?t=${timestamp}`);
        }

        if (!response.ok) throw new Error(`HTTP ${response.status} - File Not Found at /modal_bowler.html`);

        const htmlText = await response.text();
        modal.innerHTML = htmlText;
        console.log("✅ New Modal HTML Loaded!");
    } catch (e) {
        console.error("❌ Failed to load modal:", e);
        alert(`Failed to load modal design. Check console. Error: ${e.message}`);
        return;
    }

    // 2. Fetch Data (Squad)
    try {
        const res = await fetch(`${API_URL}/bowling_squad?match_id=${MATCH_ID}`);
        const data = await res.json();
        currentBowlingSquad = data.players || [];
    } catch (e) {
        currentBowlingSquad = [];
    }

    // 3. Render List
    renderRedBowlerList(currentBowlingSquad);

    // 4. Attach Events

    // Close Button
    const closeBtn = modal.querySelector('#closeBowlerModal');
    if (closeBtn) closeBtn.onclick = () => modal.close();

    // Search Filter
    const searchInput = modal.querySelector('#bowlerSearchInput');
    if (searchInput) {
        searchInput.onkeyup = (e) => {
            const query = e.target.value.toLowerCase();
            const filtered = currentBowlingSquad.filter(p => p.name.toLowerCase().includes(query));
            renderRedBowlerList(filtered);
        };
    }

    // --- ADD NEW PLAYER LOGIC ---
    const addBtn = modal.querySelector('#btnAddNewPlayer');
    const nameInput = modal.querySelector('#newPlayerNameInput');

    if (addBtn && nameInput) {
        // 1. ADD ENTER KEY LISTENER
        nameInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                addBtn.click();
            }
        });

        addBtn.onclick = async () => {
            const name = nameInput.value.trim();
            if (!name) return alert("Please enter a name.");

            // Get Team ID safely
            const teamId = window.currentMatchData?.bowling_team_id;
            if (!teamId) return alert("Error: Could not identify the Bowling Team. Please refresh the page.");

            // Visual Feedback
            addBtn.textContent = "Saving...";
            addBtn.disabled = true;

            try {
                // Use the new Quick Add endpoint
                const res = await fetch(`${API_URL}/players/quick_add`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name: name, team_id: teamId, role: 'Bowler' })
                });

                if (res.ok) {
                    const result = await res.json();
                    // FIX: Backend returns player object directly
                    const newPlayer = result;

                    // 1. Add to local list
                    currentBowlingSquad.unshift(newPlayer); // Add to TOP of list
                    // 2. Clear Input
                    nameInput.value = "";
                    nameInput.focus();
                    // 3. Re-render list
                    renderRedBowlerList(currentBowlingSquad);
                    // 4. Success message
                    console.log("Player added:", newPlayer);
                } else {
                    alert("Failed to save player.");
                }
            } catch (err) {
                console.error(err);
                alert("Network Error");
            } finally {
                addBtn.textContent = "Add New Player";
                addBtn.disabled = false;
            }
        };
    }

    modal.showModal();
}

// Render Function
function renderRedBowlerList(players) {
    const container = document.getElementById('bowlerListContainer');
    if (!container) return;
    container.innerHTML = "";

    if (players.length === 0) {
        container.innerHTML = "<div style='text-align:center; padding:30px; color:#ffcccc; font-style:italic;'>No players found.<br>Use the box above to add one.</div>";
        return;
    }

    players.forEach((p, idx) => {
        const row = document.createElement('div');
        row.className = 'player-row-red';
        row.onclick = () => selectBowler(p.id);

        row.innerHTML = `
            <div class="col-idx">${idx + 1}.</div>
            <div class="col-name-wide">
                <span style="font-size:18px; margin-right:8px;">👤</span>
                ${p.name}
            </div>
            <div class="col-stats">0.0-0-0</div>
        `;
        container.appendChild(row);
    });
}

// Ensure selectBowler function exists in this file (or import it)
async function selectBowler(playerId) {
    try {
        const res = await fetch(`${API_URL}/matches/${MATCH_ID}/set_bowler`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ player_id: playerId, role: 'bowler' })
        });
        if (res.ok) {
            const fullMatchData = await res.json(); // <--- GET DATA
            document.getElementById('selectBowlerModal').close();

            // INSTANT UPDATE (No Reload)
            import('./ui.js').then(m => m.refreshUI(fullMatchData));
        } else {
            alert("Error setting bowler");
        }
    } catch (e) { console.error(e); }
}

// Expose to window
window.changeBatsman = async function (role) {
    console.log("Change Batsman Requested for:", role);
    targetBatsmanRole = role;

    const data = window.currentMatchData;
    if (!data || !data.batting_team_id) {
        alert("Error: No Batting Team ID found. Please refresh.");
        return;
    }

    const title = role === 'striker' ? 'Select New Striker' : 'Select New Non-Striker';
    await openBatsmanModal(title, data.batting_team_id);
}

window.showSelectBowlerModal = showSelectBowlerModal;
window.handleWicketFall = handleWicketFall;
