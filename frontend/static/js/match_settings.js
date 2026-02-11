// Logic for Match Settings Modal
const API_URL = "http://localhost:8000/api";

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
        if (matchNoInput) {
            matchNoInput.value = (d.match_number !== undefined && d.match_number !== null) ? d.match_number : "";
        }

        const oversInput = document.getElementById('ms-overs');
        if (oversInput) oversInput.value = d.total_overs || 20;

        const ballsInput = document.getElementById('ms-balls-per-over');
        if (ballsInput) ballsInput.value = 6;

        const stateInput = document.getElementById('ms-match-state');
        if (stateInput) stateInput.value = d.match_type || "Group Match";

        // Populate Teams Dropdown (with empty option at top)
        const tossSelect = document.getElementById('ms-toss-winner');
        const batSelect = document.getElementById('ms-bat-first');

        // Helper to generate options
        const createOps = () => {
            const t1 = d.team_a_name || d.batting_team || "Team A";
            const t2 = d.team_b_name || d.bowling_team || "Team B";
            const t1_id = d.team_a_id || d.batting_team_id;
            const t2_id = d.team_b_id || d.bowling_team_id;

            // Added empty option for "Blank by Default" feature
            return `<option value="" selected></option>
                     <option value="${t1_id}">${t1}</option>
                     <option value="${t2_id}">${t2}</option>`;
        };

        if (tossSelect) tossSelect.innerHTML = createOps();
        if (batSelect) batSelect.innerHTML = createOps();

        // FEATURE 1: BLANK BY DEFAULT
        // We do NOT set the values to d.toss_winner or derived Bat First.
        // We intentionally leave them as "" (from the `selected` empty option above).

        if (tossSelect) tossSelect.value = "";

        // FEATURE 2: AUTO-LOCK BATTING TEAM
        if (batSelect) {
            batSelect.value = ""; // Blank by default

            // Check if match has started
            // Condition: Striker Selected OR Balls Bowled > 0
            // This is safer than just checking innings.

            let hasStarted = false;

            // Check for striker
            if (d.current_striker_id || d.non_striker_id) {
                hasStarted = true;
            }
            // Check for balls via total overs (simple proxy) or balls count if available
            // d.innings.overs is "X.Y". If not "0.0", it started.
            if (d.innings && d.innings.overs && d.innings.overs !== "0.0") {
                hasStarted = true;
            }

            if (hasStarted) {
                batSelect.disabled = true;
                batSelect.title = "Cannot change batting team after play has started";
                batSelect.style.cursor = "not-allowed";
                batSelect.style.opacity = "0.7";

                // Optional: If locked, maybe show the CURRENT batting team instead of blank?
                // The constraint says "Open: Dropdowns are blank".
                // But locking a blank dropdown means they can't set it? 
                // Wait, if it's locked, they CANNOT change it. 
                // But if they save, blank sends nothing, so backend keeps value. 
                // So "Blank + Locked" effectively means "Read-Only / No Change". 
                // This seems correct per the "Safe Edit" goal.
            } else {
                batSelect.disabled = false;
                batSelect.title = "Select team to bat first";
                batSelect.style.cursor = "pointer";
                batSelect.style.opacity = "1";
            }
        }
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
    console.log("Starting Match Settings Update...");

    // 1. GET THE HIDDEN DATABASE ID (The Target)
    const urlParams = new URLSearchParams(window.location.search);
    const dbMatchId = urlParams.get('match_id');

    if (!dbMatchId) {
        alert("Critical Error: Cannot find Match ID in URL. Please refresh the page.");
        return;
    }

    // 2. GET THE NEW VALUES
    const newMatchNo = parseInt(document.getElementById('ms-match-no').value);
    const newOvers = parseInt(document.getElementById('ms-overs').value);
    const newBallsPerOver = parseInt(document.getElementById('ms-balls-per-over').value);
    const newStatus = document.getElementById('ms-match-state').value;

    // Get Raw Values (might be empty strings)
    const rawTossWinner = document.getElementById('ms-toss-winner').value;
    const rawBatFirst = document.getElementById('ms-bat-first').value;

    // 3. PREPARE THE DATA PACKAGE
    const payload = {
        match_number: newMatchNo,
        total_overs: newOvers,
        balls_per_over: newBallsPerOver,
        match_status: newStatus
    };

    // FEATURE 1 IMPLEMENTATION: Only send if not empty
    if (rawTossWinner !== "") {
        payload.toss_winner_id = parseInt(rawTossWinner);
    }

    // For Bat First, only send if not empty AND not disabled (redundant but safe)
    if (rawBatFirst !== "") {
        payload.batting_team_id = parseInt(rawBatFirst);
    }

    console.log("Sending Payload to ID " + dbMatchId, payload);

    try {
        // 4. SEND TO BACKEND (Using the ID to find the row)
        const res = await fetch(`${API_URL}/matches/${dbMatchId}/settings`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (res.ok) {
            alert("✅ Match Settings Updated Successfully!");
            document.getElementById('matchSettingsModal').close();

            // Refresh page to see the new Match Number
            window.location.reload();
        } else {
            // Show detailed error if it fails
            const err = await res.json();
            console.error("Backend Error:", err);
            const errMsg = typeof err.detail === 'object' ? JSON.stringify(err.detail) : err.detail;
            alert("Update Failed:\n" + errMsg);
        }
    } catch (e) {
        console.error("Network Error:", e);
        alert("Error connecting to server. Check console for details.");
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
