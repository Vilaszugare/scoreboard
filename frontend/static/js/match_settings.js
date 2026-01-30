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
        if (matchNoInput) matchNoInput.value = d.match_number || "";

        const oversInput = document.getElementById('ms-overs');
        if (oversInput) oversInput.value = d.total_overs || 20;

        const ballsInput = document.getElementById('ms-balls-per-over');
        if (ballsInput) ballsInput.value = 6;

        const stateInput = document.getElementById('ms-match-state');
        if (stateInput) stateInput.value = d.match_type || "Group Match";

        // Populate Teams Dropdown
        const tossSelect = document.getElementById('ms-toss-winner');
        const batSelect = document.getElementById('ms-bat-first');

        // Helper to generate options
        const createOps = () => {
            const t1 = d.team_a_name || d.batting_team || "Team A";
            const t2 = d.team_b_name || d.bowling_team || "Team B";
            const t1_id = d.team_a_id || d.batting_team_id;
            const t2_id = d.team_b_id || d.bowling_team_id;

            return `<option value="${t1_id}">${t1}</option>
                     <option value="${t2_id}">${t2}</option>`;
        };

        if (tossSelect) tossSelect.innerHTML = createOps();
        if (batSelect) batSelect.innerHTML = createOps();

        // Select current values
        if (d.toss_winner && tossSelect) tossSelect.value = d.toss_winner;

        // Determine Bat First Team
        let batFirstId = null;
        if (d.toss_winner && d.toss_decision) {
            if (d.toss_decision === 'bat') {
                batFirstId = d.toss_winner;
            } else {
                const t1_id = d.team_a_id || d.batting_team_id;
                const t2_id = d.team_b_id || d.bowling_team_id;
                batFirstId = (d.toss_winner == t1_id) ? t2_id : t1_id;
            }
        } else {
            // Fallback
            if (d.innings && d.innings.current_inning === 1) {
                batFirstId = d.batting_team_id;
            }
        }

        if (batFirstId && batSelect) batSelect.value = batFirstId;

        // --- NEW SAFETY CHECK: Lock Batting Team if Match Started ---
        if (batSelect) {
            // Check if match has started
            // Condition: current_inning > 1 OR overs != "0.0"
            // We can check d.innings.overs if available
            let hasStarted = false;

            if (d.innings) {
                if (d.innings.current_inning > 1) {
                    hasStarted = true;
                } else {
                    // Check overs string "0.0"
                    if (d.innings.overs && d.innings.overs !== "0.0" && d.innings.overs !== "0") {
                        hasStarted = true;
                    }
                }
            }

            if (hasStarted) {
                batSelect.disabled = true;
                batSelect.title = "Cannot change batting team after play has started";
                // Optional: Add visual style
                batSelect.style.cursor = "not-allowed";
                batSelect.style.opacity = "0.7";
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
    // Priority: URL Param -> Global Data Object
    const urlParams = new URLSearchParams(window.location.search);
    let dbMatchId = urlParams.get('match_id');

    if (!dbMatchId && window.currentMatchData && window.currentMatchData.id) {
        dbMatchId = window.currentMatchData.id;
        console.log("Found Match ID from Global Data:", dbMatchId);
    }

    if (!dbMatchId) {
        alert("Critical Error: Cannot find Match ID. Please refresh the page.");
        return;
    }

    // 2. GET THE NEW VALUES (The Data to Save)
    const newMatchNo = parseInt(document.getElementById('ms-match-no').value);
    const newOvers = parseInt(document.getElementById('ms-overs').value);
    const newBallsPerOver = parseInt(document.getElementById('ms-balls-per-over').value);
    const newStatus = document.getElementById('ms-match-state').value;

    // Validate Select Inputs (Handle potential NULLs)
    let newTossWinner = parseInt(document.getElementById('ms-toss-winner').value);
    let newBatFirst = parseInt(document.getElementById('ms-bat-first').value);

    // Validation Safety Checks
    if (isNaN(newMatchNo)) { alert("Match Number must be a valid number"); return; }
    if (isNaN(newOvers)) { alert("Overs must be a valid number"); return; }
    if (isNaN(newTossWinner)) newTossWinner = null; // or handle as error
    if (isNaN(newBatFirst)) newBatFirst = null;

    // 3. PREPARE THE DATA PACKAGE
    const payload = {
        match_number: newMatchNo,
        total_overs: newOvers,
        balls_per_over: newBallsPerOver,
        match_status: newStatus,
        toss_winner_id: newTossWinner,
        batting_team_id: newBatFirst
    };

    console.log(`Sending Payload to ID ${dbMatchId}:`, payload);

    try {
        // 4. SEND TO BACKEND
        const res = await fetch(`${API_URL}/matches/${dbMatchId}/settings`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (res.ok) {
            alert("✅ Match Settings Updated Successfully!");
            document.getElementById('matchSettingsModal').close();

            // Refresh page to see changes
            window.location.reload();
        } else {
            // Show detailed error if it fails
            const err = await res.json();
            console.error("Backend Error:", err);

            let errMsg = "Unknown Error";
            if (typeof err.detail === 'string') {
                errMsg = err.detail;
            } else if (typeof err.detail === 'object') {
                errMsg = JSON.stringify(err.detail);
            }

            alert("Update Failed:\n" + errMsg);
        }
    } catch (e) {
        console.error("Network Error:", e);
        alert("Error connecting to server. Check console for details.\n" + e.message);
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
