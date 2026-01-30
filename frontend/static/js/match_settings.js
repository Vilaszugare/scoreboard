// Logic for Match Settings Modal

// 1. OPEN MODAL
window.openMatchSettingsModal = function () {
    const modal = document.getElementById('matchSettingsModal');
    if (!modal) {
        console.error("Match Settings Modal not found in DOM");
        return;
    }

    // Check if data exists
    if (window.currentMatchData) {
        const d = window.currentMatchData;

        // Populate Inputs
        const matchNoInput = document.getElementById('ms-match-no');
        if (matchNoInput) matchNoInput.value = d.match_number || ""; // Use match_number, not id for display usually, but d.id fallback

        const oversInput = document.getElementById('ms-overs');
        if (oversInput) oversInput.value = d.total_overs || 20;

        const ballsInput = document.getElementById('ms-balls-per-over');
        if (ballsInput) ballsInput.value = 6; // Default to 6, or fetch if available in data

        const stateInput = document.getElementById('ms-match-state');
        // d.status is usually 'live', 'completed'. d.match_type might be "League Match" etc.
        // The user prompt says "Match State: Group Match". In ui.js refreshUI uses data.match_type.
        if (stateInput) stateInput.value = d.match_type || "League Match";

        // Populate Teams Dropdown
        const tossSelect = document.getElementById('ms-toss-winner');
        const batSelect = document.getElementById('ms-bat-first');

        // Helper to generate options
        const createOps = () => {
            // We need team IDs and Names. 
            // currentMatchData has team_a_id/team_b_id? ui.js uses batting_team_id/bowling_team_id.
            // refreshUI in ui.js derives team_a/team_b from matches logic.
            // Let's assume currentMatchData has: batting_team, bowling_team, batting_team_id, bowling_team_id
            // And hopefully team_a_id etc if we want to be precise. 
            // Detailed view in matches.py fetch_full_match_state returns team_a_id, team_b_id.

            const t1 = d.team_a_name || d.batting_team || "Team A";
            const t2 = d.team_b_name || d.bowling_team || "Team B";

            // matches.py returns team_a_id and team_b_id in the payload
            const t1_id = d.team_a_id || d.batting_team_id;
            const t2_id = d.team_b_id || d.bowling_team_id;

            // If we only have batting/bowling, we might duplicate if we aren't careful, 
            // but let's try to show the two teams involved.

            return `<option value="${t1_id}">${t1}</option>
                     <option value="${t2_id}">${t2}</option>`;
        };

        if (tossSelect) tossSelect.innerHTML = createOps();
        if (batSelect) batSelect.innerHTML = createOps();

        // Select current values
        // matches.py returns toss_winner (id) -> d.toss_winner
        if (d.toss_winner && tossSelect) tossSelect.value = d.toss_winner;

        // Bat first team? 
        // If current inning is 1, batting team is Bat First Team.
        // If current inning is 2, bowling team was Bat First Team.
        // Use d.toss_decision to infer or matches.py might have it.
        // matches.py has toss_decision ('bat' or 'bowl') and toss_winner.
        // If toss_winner choice was 'bat', then toss_winner is Bat First.
        // If 'bowl', then other team is Bat First.

        let batFirstId = null;
        if (d.toss_winner && d.toss_decision) {
            if (d.toss_decision === 'bat') {
                batFirstId = d.toss_winner;
            } else {
                // The other team
                const t1_id = d.team_a_id || d.batting_team_id;
                const t2_id = d.team_b_id || d.bowling_team_id;
                batFirstId = (d.toss_winner == t1_id) ? t2_id : t1_id;
            }
        } else {
            // Fallback: Inning 1 batting team
            if (d.innings && d.innings.current_inning === 1) {
                batFirstId = d.batting_team_id;
            }
        }

        if (batFirstId && batSelect) batSelect.value = batFirstId;
    }

    modal.showModal();
}

// 2. Adjust Values (+/- Buttons)
window.adjustSettingValue = function (elementId, amount) {
    const input = document.getElementById(elementId);
    if (input) {
        let val = parseInt(input.value) || 0;
        val += amount;
        if (val < 1) val = 1;
        input.value = val;
    }
}

// 3. Update Function
window.submitMatchSettings = async function () {
    if (!window.currentMatchData) return;

    // 1. Gather Data from Inputs
    const matchId = window.currentMatchData.id; // Or match_id
    const newMatchNo = parseInt(document.getElementById('ms-match-no').value);
    const newOvers = parseInt(document.getElementById('ms-overs').value);
    const newBallsPerOver = parseInt(document.getElementById('ms-balls-per-over').value);
    const newStatus = document.getElementById('ms-match-state').value;
    const newTossWinner = parseInt(document.getElementById('ms-toss-winner').value);
    const newBatFirst = parseInt(document.getElementById('ms-bat-first').value);

    // 2. Prepare Payload
    const payload = {
        match_number: newMatchNo,
        total_overs: newOvers,
        balls_per_over: newBallsPerOver,
        match_status: newStatus, // Will be mapped to match_type in backend
        toss_winner_id: newTossWinner,
        batting_team_id: newBatFirst
    };

    try {
        // 3. Send to Backend
        const res = await fetch(`${API_URL}/matches/${matchId}/settings`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (res.ok) {
            alert("Match Settings Updated!");
            document.getElementById('matchSettingsModal').close();
            // Refresh the main UI to show changes
            if (window.bootstrap) window.bootstrap();
            // If ID changed, we might need to redirect or reload with new ID params, but let's just refresh.
            if (newMatchNo !== matchId) {
                // If ID was updated, we might need to update URL param if it's there?
                // Assuming URL params ?match_id=...
                const url = new URL(window.location);
                url.searchParams.set('match_id', newMatchNo);
                window.history.pushState({}, '', url);
                window.location.reload();
            }
        } else {
            const err = await res.json();
            alert("Update Failed: " + (err.detail || "Unknown error"));
        }
    } catch (e) {
        console.error(e);
        alert("Error connecting to server");
    }
}

// 4. Delete Function
window.deleteMatchAction = async function () {
    if (!window.currentMatchData) return;

    if (confirm("⚠️ DANGER: Are you sure you want to DELETE this match completely? This cannot be undone.")) {
        const matchId = window.currentMatchData.id; // OR match_id

        try {
            const res = await fetch(`${API_URL}/matches/${matchId}`, {
                method: 'DELETE'
            });

            if (res.ok) {
                alert("Match Deleted.");
                window.location.href = "/"; // Redirect to Home/Dashboard
            } else {
                alert("Delete Failed");
            }
        } catch (e) {
            console.error(e);
            alert("Error deleting match");
        }
    }
}
