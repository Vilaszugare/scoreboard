// Configuration
const API_URL = 'http://localhost:8000/api';
console.log("Logic Script Loaded: v16 - Undo Enabled");

// --- GLOBAL SQUAD CACHE (Zero Latency) ---
window.squadCache = {
    batting: null, // Stores list of batting team players
    bowling: null  // Stores list of bowling team players
};

// --- DATA LOGIC WRAPPER ---
(function () {
    if (window.logicInitialized) {
        console.log("Logic script already initialized. Skipping.");
    }
    window.logicInitialized = true;

    // --- PARSE MATCH ID ---
    const urlParams = new URLSearchParams(window.location.search);

    // IMMEDIATE CLEAR of Banner to remove static text if cached HTML is loaded
    const ban = document.querySelector('.toss-banner');
    if (ban) ban.textContent = '';

    const mIdParam = urlParams.get('match_id');
    if (!mIdParam) {
        alert("Error: No Match ID found in URL. Please open 'matches.html' and select a match.");
        throw new Error("No Match ID");
    }
    const MATCH_ID = parseInt(mIdParam);

    // State for Batsman Change
    let targetBatsmanRole = 'striker';

    // Menu Options Mapping
    const MENU_OPTIONS = {
        1: [
            { label: '1 Bat run', action: 'run', value: 1 },
            { label: '1 Bat run (declare)', action: 'run', value: 1, type: 'declare' },
            { label: '1 Bye run', action: 'bye', value: 1 },
            { label: '1 Leg-Bye run', action: 'leg-bye', value: 1 }
        ],
        2: [
            { label: '2 Bat runs', action: 'run', value: 2 },
            { label: '2 Bye runs', action: 'bye', value: 2 },
            { label: '2 Leg-Bye runs', action: 'leg-bye', value: 2 }
        ],
        3: [
            { label: '3 Bat runs', action: 'run', value: 3 },
            { label: '3 Bye runs', action: 'bye', value: 3 },
            { label: '3 Leg-Bye runs', action: 'leg-bye', value: 3 }
        ],
        4: [
            { label: 'FOUR (Boundary)', action: 'boundary', value: 4 },
            { label: '4 Bat runs (ran)', action: 'run', value: 4 },
            { label: '4 Bye runs', action: 'bye', value: 4 },
            { label: '4 Leg-Bye runs', action: 'leg-bye', value: 4 }
        ],
        5: [
            { label: '5 Bat runs', action: 'run', value: 5 },
            { label: '5 Bye runs', action: 'bye', value: 5 },
            { label: '5 Leg-Bye runs', action: 'leg-bye', value: 5 }
        ],
        6: [
            { label: 'SIX (Boundary)', action: 'boundary', value: 6 },
            { label: '6 Bat runs (ran)', action: 'run', value: 6 },
            { label: '6 Bye runs', action: 'bye', value: 6 },
            { label: '6 Leg-Bye runs', action: 'leg-bye', value: 6 }
        ],
        7: [
            { label: '7 Bat runs', action: 'run', value: 7 },
            { label: '7 Bye runs', action: 'bye', value: 7 },
            { label: '7 Leg-Bye runs', action: 'leg-bye', value: 7 }
        ]
    };

    const ACTION_OPTIONS = {
        'Wide Ball': [
            { label: 'Wide', action: 'wide', value: 0 },
            { label: 'Wide + 1 run', action: 'wide', value: 1 },
            { label: 'Wide + 1 (declare)', action: 'wide', value: 1, type: 'declare' },
            { label: 'Wide + 2 runs', action: 'wide', value: 2 },
            { label: 'Wide + 3 runs', action: 'wide', value: 3 },
            { label: 'Wide + 4 runs', action: 'wide', value: 4 },
            { label: 'Wide + 5 runs', action: 'wide', value: 5 },
            { label: 'Wide + 6 runs', action: 'wide', value: 6 },
            { label: 'Wide + 7 runs', action: 'wide', value: 7 }
        ],
        'No Ball': [
            { label: 'No ball', action: 'noball', value: 0 },
            { label: 'No ball + 1', action: 'noball', value: 1 },
            { label: 'No ball + 2', action: 'noball', value: 2 },
            { label: 'No ball + 3', action: 'noball', value: 3 },
            { label: 'No ball + FOUR (Boundary)', action: 'noball', value: 4, type: 'boundary' },
            { label: 'No ball + 4', action: 'noball', value: 4 },
            { label: 'No ball + 5', action: 'noball', value: 5 },
            { label: 'No ball + SIX (Boundary)', action: 'noball', value: 6, type: 'boundary' },
            { label: 'No ball + 6', action: 'noball', value: 6 },
            { label: 'No ball + 7', action: 'noball', value: 7 }
        ],
        'Penalty': [
            ...Array.from({ length: 10 }, (_, i) => ({ label: `+${i + 1} run (Penalty)`, action: 'penalty', value: i + 1 })),
            ...Array.from({ length: 10 }, (_, i) => ({ label: `${-(i + 1)} run (Penalty)`, action: 'penalty', value: -(i + 1) }))
        ],
        'Stumped': [
            { label: 'Fair Delivery (Stumping)', action: 'wicket', value: 'stumped', type: 'fair' },
            { label: 'Wide Ball (Stumping)', action: 'wicket', value: 'stumped', type: 'wide' }
        ],
        'Hit-Wicket': [
            { label: 'Fair Delivery', action: 'wicket', value: 'hit_wicket', type: 'fair' },
            { label: 'Wide Ball', action: 'wicket', value: 'hit_wicket', type: 'wide' }
        ],
        'Runout': [
            { label: 'Runout while taking run', action: 'wicket', value: 'runout', type: 'standard' },
            { label: 'Mankad Wicket (Non Striker out)', action: 'wicket', value: 'runout', type: 'mankad' }
        ],
        'Other Wkt': [
            { label: 'Handled the ball', action: 'wicket', value: 'other', type: 'handled_ball' },
            { label: 'Hit ball twice', action: 'wicket', value: 'other', type: 'hit_twice' },
            { label: 'Obstructing the field', action: 'wicket', value: 'other', type: 'obstructing' }
        ]
    };

    // Helper to post data
    async function updateScore(action, value = null, extraData = {}) {
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

    // --- UNDO FUNCTION ---
    async function undoLastAction() {
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
            } else if (data.status === 'bowler_deselected') {
                console.log("UNDO: Bowler Deselected. Re-opening modal.");
                if (data.data) refreshUI(data.data);

                // Requirement: "Refresh the UI so the 'Select Bowler' modal/dropdown reappears instantly."
                setTimeout(() => {
                    if (window.showSelectBowlerModal) window.showSelectBowlerModal();
                }, 100); // Small delay to ensure UI updates first

            } else {
                alert("Undo Failed: " + (data.message || "Unknown error"));
            }
        } catch (e) {
            console.error(e);
            alert("Undo Request Failed");
        }
    }

    function handleServerResponse(data) {
        if (!data) return;

        if (data.status === 'wicket_fall') {
            handleWicketFall(data);
        } else if (data.status === 'over_complete') {
            console.log("Over Complete!");
            if (data.data) refreshUI(data.data);
            showSelectBowlerModal();
        } else if (data.status === 'inning_break') {
            // HANDLE END INNING
            alert(data.message);
            window.switchTab('squad');
            fetch(`${API_URL}/match_data?match_id=${MATCH_ID}`)
                .then(r => r.json())
                .then(d => refreshUI(d));

        } else if (data.data) {
            refreshUI(data.data);
        } else if (data.innings) {
            refreshUI(data);
        }
    }

    // --- MAIN UI UPDATE FUNCTION ---
    // --- MAIN UI UPDATE FUNCTION (REWRITTEN & ROBUST) ---
    function refreshUI(data) {
        if (!data || !data.innings) return;

        // 1. ALWAYS Update Header Stats (Unconditional)
        const teamScoreEl = document.getElementById('header_score');
        if (teamScoreEl) {
            teamScoreEl.textContent = `${data.innings.runs}/${data.innings.wickets}`;
        }

        const oversTextEl = document.getElementById('header_overs');
        // Ensure overs are formatted correctly (e.g., 0.0)
        let oversStr = String(data.innings.overs);
        if (!oversStr.includes('.')) oversStr += ".0";
        if (oversTextEl) {
            oversTextEl.textContent = `(${oversStr} ov)`;
        }

        // --- TEAM DISPLAY LOGIC (FIXED) ---
        // Goal: Batting Team always on Left, Bowling Team on Right.

        let leftName, rightName, leftLogo, rightLogo;

        // Check if Team B is Batting (Explicit Check)
        // If Team B is batting, we SWAP (B on Left, A on Right)
        if (data.batting_team_id === data.team_b_id) {
            // Team B is Batting (Left)
            leftName = data.team_b || data.batting_team || "Team B";
            rightName = data.team_a || data.bowling_team || "Team A";
            leftLogo = data.team_b_logo || data.batting_team_logo;
            rightLogo = data.team_a_logo || data.bowling_team_logo;
        } else {
            // Team A is Batting OR Default (Left)
            leftName = data.team_a || data.batting_team || "Team A";
            rightName = data.team_b || data.bowling_team || "Team B";
            leftLogo = data.team_a_logo || data.batting_team_logo;
            rightLogo = data.team_b_logo || data.bowling_team_logo;
        }

        // Apply Names
        const teamNameEl = document.getElementById('header_team_name');
        if (teamNameEl) teamNameEl.textContent = leftName;

        const bowlTeamEl = document.getElementById('header_bowling_name');
        if (bowlTeamEl) bowlTeamEl.textContent = rightName;

        // Apply Logos (if elements exist)
        const batLogoEl = document.getElementById('header_batting_logo');
        if (batLogoEl && leftLogo) batLogoEl.src = leftLogo;

        const bowlLogoEl = document.getElementById('header_bowling_logo');
        if (bowlLogoEl && rightLogo) bowlLogoEl.src = rightLogo;

        // 2. The Target Logic (Crucial Fix)
        const targetBox = document.getElementById('target-display');
        const currentInning = data.innings.current_inning || 1;
        const targetScore = data.innings.target || 0; // Backend usually sends 'target' inside innings or root

        if (targetBox) {
            if (currentInning === 2 && targetScore > 0) {
                targetBox.style.display = 'block';
                targetBox.innerHTML = `Target: <span style="color:#ffd700; font-weight:bold;">${targetScore}</span>`;
            } else {
                targetBox.style.display = 'none';
            }
        }

        // Logic to show 1st Inning Score on the Right Side (Bowling Team Card)
        const bowlScoreEl = document.getElementById('header_bowling_score');
        if (bowlScoreEl) {
            if (currentInning === 2 && targetScore > 0) {
                // Calculate 1st Inning Score: (Target - 1)
                const firstInningRuns = targetScore - 1;
                // Display it
                bowlScoreEl.innerText = firstInningRuns;
                bowlScoreEl.style.display = 'block';
            } else {
                // In 1st Inning, the bowling team hasn't batted yet
                bowlScoreEl.innerText = "";
            }
        }

        // 3. The "End Inning" Button Logic (Simple Version)
        const endInningBtn = document.getElementById('btn_end_inning');
        if (endInningBtn) {
            if (currentInning === 2) {
                // If match is done or 2nd inning, hide or disable
                endInningBtn.style.display = 'none';
                // Or: endInningBtn.disabled = true; endInningBtn.textContent = "Match Done";
            } else {
                // Inning 1
                endInningBtn.style.display = 'inline-block';
                endInningBtn.disabled = false;
                endInningBtn.textContent = "End Inning";
                // Note: The click listener is already attached in initButtons()
            }
        }

        // 4. The Notification Bar (Priority Logic)
        updateNotificationBar(data);

        // --- Player Cards (Standard Update) ---
        const p1 = data.current_batsmen ? data.current_batsmen[0] : null;
        const p2 = data.current_batsmen ? data.current_batsmen[1] : null;
        updateSpecificPlayerCard('p1', p1);
        updateSpecificPlayerCard('p2', p2);

        if (data.current_bowler) {
            updateBowlerCard(data.current_bowler);
        } else {
            const nameEl = document.getElementById('tv_bowler');
            if (nameEl) nameEl.textContent = "Select Bowler";
        }

        // Save for Modals
        window.currentMatchData = data;
    }

    function updateNotificationBar(data) {
        if (!data) return;

        const banner = document.querySelector('.toss-banner');
        if (!banner) return;

        // --- Priority System ---

        // Variables
        const currentRuns = parseInt(data.innings.runs) || 0;
        const target = parseInt(data.innings.target) || 0;
        const isSecondInnings = (data.innings.current_inning === 2);

        // Calculate balls bowled: "14.2" -> 14 overs, 2 balls
        const oversStr = data.innings.overs || "0.0";
        const [overs, balls] = oversStr.split('.').map(Number);
        const ballsBowled = (overs * 6) + (balls || 0);

        const totalOvers = data.total_overs || 20;
        const totalBallsMatch = totalOvers * 6;

        console.log("NotifCalc:", { currentRuns, target, isSecondInnings, ballsBowled, totalBallsMatch });

        // Check 1: Did Batting Team Win? (Score >= Target)
        if (isSecondInnings && target > 0 && currentRuns >= target) {
            banner.textContent = `${data.batting_team} Wins!`;
            banner.style.background = '#ffd700'; // Gold
            banner.style.color = '#000';
            banner.style.fontWeight = 'bold';
            return;
        }

        // Check 2: Did Bowling Team Win? (Overs finished AND runs < target - 1)
        // Note: target-1 is the tie score. So strictly less than target-1 means loss.
        if (isSecondInnings && ballsBowled >= totalBallsMatch && currentRuns < (target - 1)) {
            banner.textContent = `${data.bowling_team} Wins!`;
            banner.style.background = '#ffd700'; // Gold
            banner.style.color = '#000';
            banner.style.fontWeight = 'bold';
            return;
        }

        // Check 3: Is it a Tie? (Overs finished AND runs == target - 1)
        if (isSecondInnings && ballsBowled >= totalBallsMatch && currentRuns === (target - 1)) {
            banner.textContent = "Match Tied!";
            banner.style.background = '#ffa500'; // Orange
            banner.style.color = '#fff';
            banner.style.fontWeight = 'bold';
            return;
        }

        // Check 4: Result Message explicitly from Backend (Backup)
        if (data.result_message) {
            banner.textContent = data.result_message;
            banner.style.background = '#ffd700';
            banner.style.color = '#000';
            banner.style.fontWeight = 'bold';
            return;
        }

        // Check 5 (Default): Toss Message
        if (data.toss_winner_name && data.toss_decision) {
            const decision = data.toss_decision.charAt(0).toUpperCase() + data.toss_decision.slice(1);
            banner.textContent = `${data.toss_winner_name} won the toss and elected to ${decision}`;
            banner.style.background = '';
            banner.style.color = '';
            banner.style.fontWeight = '';
        } else {
            banner.textContent = "";
            banner.style.background = "";
        }
    }

    function updateBowlerCard(bowler) {
        if (!bowler) return;
        const nameEl = document.getElementById('tv_bowler');
        if (nameEl) nameEl.textContent = bowler.name;

        const scoreEl = document.getElementById('tv_curBo_score');
        if (scoreEl) {
            if (bowler.figures) {
                scoreEl.textContent = bowler.figures;
            } else {
                const maidens = bowler.maidens || 0;
                const runs = bowler.runs_conceded || 0;
                const wkts = bowler.wickets || 0;
                scoreEl.textContent = `${bowler.overs} - ${maidens} - ${runs} - ${wkts}`;
            }
        }

        const econEl = document.getElementById('tv_curBo_econ');
        if (econEl) econEl.textContent = bowler.econ;
        const dotsEl = document.getElementById('tv_curBo_dots');
        if (dotsEl) dotsEl.textContent = bowler.dots;
        const extrasEl = document.getElementById('tv_curBo_extras');
        if (extrasEl) extrasEl.textContent = bowler.extras;
    }

    function updateSpecificPlayerCard(prefix, player) {
        const nameEl = document.getElementById(`${prefix}_name`);
        const scoreEl = document.getElementById(`${prefix}_score`);
        const statsEl = document.getElementById(`${prefix}_stats`);

        if (!player || player.empty || !player.name) {
            if (nameEl) nameEl.textContent = "Select Batsman";
            if (scoreEl) scoreEl.textContent = "";
            if (statsEl) statsEl.textContent = "";
            if (nameEl) nameEl.style.color = 'var(--muted)';
            return;
        }

        if (nameEl) {
            nameEl.textContent = player.name + (player.on_strike ? ' *' : '');
            nameEl.style.color = player.on_strike ? '#fff' : '#ccc';
        }
        if (scoreEl) {
            scoreEl.innerHTML = `${player.runs} <span style="color:var(--muted);font-size:13px">(${player.balls})</span>`;
            scoreEl.style.color = player.on_strike ? '#ffb347' : '#fff';
        }
        if (statsEl) {
            statsEl.innerHTML = `4s : ${player.fours} &nbsp; 6s : ${player.sixes} &nbsp; SR : ${player.strike_rate}`;
        }
    }

    function showContextMenu(triggerBtn, typeOrRuns) {
        closeContextMenu();

        let options = MENU_OPTIONS[typeOrRuns];
        if (!options) {
            options = ACTION_OPTIONS[typeOrRuns];
        }

        if (!options) {
            console.warn("No options found for:", typeOrRuns);
            return;
        }

        const menu = document.createElement('div');
        menu.className = 'context-menu';
        if (options.length > 8) {
            menu.style.maxHeight = '300px';
            menu.style.overflowY = 'auto';
        }

        menu.innerHTML = `<div class="menu-header">${typeOrRuns} Options</div>`;

        options.forEach(opt => {
            const item = document.createElement('div');
            item.className = 'menu-item';

            let labelHtml = opt.label
                .replace(/Bat runs?/, '<strong>Bat</strong>')
                .replace(/Bye runs?/, '<strong>Bye</strong>')
                .replace(/Leg-Bye runs?/, '<strong>LB</strong>')
                .replace(/(Boundary)/, '<strong>$1</strong>');

            item.innerHTML = labelHtml;

            item.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                const { action, value, ...rest } = opt;
                console.log("Option Clicked:", opt);
                updateScore(action, value, rest);
                closeContextMenu();
            });
            menu.appendChild(item);
        });

        document.body.appendChild(menu);
        const rect = triggerBtn.getBoundingClientRect();
        const menuRect = menu.getBoundingClientRect();

        let top = rect.top + window.scrollY;
        let left = rect.right + 10 + window.scrollX;

        if (left + menuRect.width > window.innerWidth) {
            left = rect.left - menuRect.width - 10 + window.scrollX;
        }
        if (top + menuRect.height > document.documentElement.scrollHeight) {
            top = document.documentElement.scrollHeight - menuRect.height - 10;
        }

        menu.style.top = `${top}px`;
        menu.style.left = `${left}px`;

        setTimeout(() => {
            document.addEventListener('click', documentClickListener);
        }, 100);
    }

    function closeContextMenu() {
        const existing = document.querySelector('.context-menu');
        if (existing) {
            existing.remove();
        }
        document.removeEventListener('click', documentClickListener);
    }

    function documentClickListener(e) {
        if (!e.target.closest('.context-menu') && !e.target.closest('.btn-run') && !e.target.closest('.btn-action')) {
            closeContextMenu();
        }
    }

    function initButtons() {
        console.log("Initializing Buttons...");
        const runBtns = document.querySelectorAll('.btn-run');
        runBtns.forEach(btn => {
            const newBtn = btn.cloneNode(true);
            btn.parentNode.replaceChild(newBtn, btn);

            newBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                const runs = parseInt(newBtn.textContent.trim());

                if (runs === 0) {
                    closeContextMenu();
                    updateScore('run', 0);
                } else {
                    showContextMenu(newBtn, runs);
                }
            });
        });

        // --- UNDO CHECK ---
        const undoBtn = document.querySelector('.btn-undo');
        if (undoBtn) {
            console.log("Undo button found! Attaching listener.");
            const newBtn = undoBtn.cloneNode(true);
            undoBtn.parentNode.replaceChild(newBtn, undoBtn);
            newBtn.addEventListener('click', (e) => {
                e.preventDefault();
                console.log("Undo Clicked");
                undoLastAction();
            });
        } else {
            console.warn("Undo button NOT found!");
        }

        const actionButtons = document.querySelectorAll('.btn-action');
        actionButtons.forEach(btn => {
            const newBtn = btn.cloneNode(true);
            btn.parentNode.replaceChild(newBtn, btn);

            const text = newBtn.textContent.trim();

            if (ACTION_OPTIONS[text]) {
                newBtn.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    showContextMenu(newBtn, text);
                });
                return;
            }

            if (text === 'End Inning') {
                newBtn.addEventListener('click', () => {
                    if (confirm("Are you sure you want to End the Inning?")) {
                        endInning();
                    }
                });
                return;
            }

            let action = '';
            let value = null;

            if (text === 'Bowled') { action = 'wicket'; value = 'bowled'; }
            else if (text === 'Caught') { action = 'wicket'; value = 'caught'; }
            else if (text === 'LBW') { action = 'wicket'; value = 'lbw'; }
            else if (text === 'Retired Out') { action = 'wicket'; value = 'retired'; }


            if (action) {
                newBtn.addEventListener('click', () => {
                    closeContextMenu();
                    updateScore(action, value);
                });
            }
        });
    }

    // --- END INNING LOGIC ---
    async function endInning() {
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

    // --- CHANGE BATSMAN LOGIC ---
    window.changeBatsman = async function (role) {
        console.log("Change Batsman Requested for:", role);
        targetBatsmanRole = role;

        // Use the ID from the backend
        const data = window.currentMatchData;
        if (!data || !data.batting_team_id) {
            alert("Error: No Batting Team ID found. Please refresh.");
            return;
        }

        await openBatsmanModal(`Select New ${role === 'striker' ? 'Striker' : 'Non-Striker'}`, data.batting_team_id);
    }

    async function openBatsmanModal(title, teamId) {
        try {
            console.log("Fetching available players for team:", teamId);

            // 1. CHECK CACHE FIRST (Instant Open)
            let players = window.squadCache.batting;

            // If cache empty or mismatch? (Simplified logic as per request)
            // Ideally we check if cached TID matches, but for now assuming cache is for current innings
            if (!players) {
                const res = await fetch(`${API_URL}/teams/${teamId}/players`);
                if (!res.ok) throw new Error("Team players fetch failed");
                const pData = await res.json();
                players = pData.players;
                window.squadCache.batting = players; // Save for next time
            }

            // const select = document.getElementById('newBatsmanSelect');
            // ... re-using 'players' variable below 
            // Note: existing code used 'pData' variable. I need to make sure 'pData' structure is handled or adapted.
            // Existing: const pData = await res.json(); 
            //           if (pData.players ...

            // My 'players' variable acts as the array.

            const select = document.getElementById('newBatsmanSelect');
            if (!select) return;

            select.innerHTML = '';

            if (players && players.length > 0) {
                players.forEach(p => {
                    const opt = document.createElement('option');
                    opt.value = p.id;
                    opt.textContent = p.name;
                    select.appendChild(opt);
                });
            } else {
                const opt = document.createElement('option');
                opt.textContent = "No players available";
                select.appendChild(opt);
            }

            const modalInfo = document.querySelector('#newBatsmanModal h3');
            if (modalInfo && title) modalInfo.textContent = title;

            const modal = document.getElementById('newBatsmanModal');
            if (modal) modal.showModal();

        } catch (e) {
            console.error("Error opening batsman modal:", e);
            alert("Error: " + e.message);
        }
    }

    // --- WICKET MODAL LOGIC ---
    async function handleWicketFall(data) {
        console.warn("Handling Wicket Fall...");

        let p1 = data.current_batsmen ? data.current_batsmen[0] : null;
        let p2 = data.current_batsmen ? data.current_batsmen[1] : null;

        targetBatsmanRole = 'striker';

        if (p1 && p1.empty) {
            targetBatsmanRole = 'striker';
        } else if (p2 && p2.empty) {
            targetBatsmanRole = 'non_striker';
        }

        await openBatsmanModal("Select New Batsman");
    }

    window.handleWicketFall = handleWicketFall;

    // --- CONFIRM BUTTONS LISTENERS ---
    function initModals() {
        const confirmBtn = document.getElementById('confirmBatsmanBtn');
        if (confirmBtn) {
            const newBtn = confirmBtn.cloneNode(true);
            confirmBtn.parentNode.replaceChild(newBtn, confirmBtn);

            newBtn.addEventListener('click', async () => {
                const select = document.getElementById('newBatsmanSelect');
                const newPlayerId = select.value;
                const newPlayerName = select.options[select.selectedIndex].text; // Get Name

                if (!newPlayerId) return;

                // 1. CLOSE MODAL INSTANTLY
                const modal = document.getElementById('newBatsmanModal');
                if (modal) modal.close();

                // 2. OPTIMISTIC UPDATE (Fake it until you make it)
                // Immediately update the text on screen so user sees result
                const nameEl = document.getElementById(targetBatsmanRole === 'striker' ? 'p1_name' : 'p2_name');
                if (nameEl) {
                    nameEl.textContent = newPlayerName + (targetBatsmanRole === 'striker' ? " *" : "");
                    nameEl.style.color = "#fff"; // Make it look active
                }

                console.log(`Setting ${targetBatsmanRole} to player ${newPlayerId}`);

                try {
                    const response = await fetch(`${API_URL}/set_new_batsman`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            match_id: MATCH_ID,
                            new_player_id: parseInt(newPlayerId),
                            role: targetBatsmanRole
                        })
                    });
                    // The SSE will handle the "real" data update later.
                    // We don't need to do anything else here.
                } catch (error) {
                    console.error("Error setting batsman", error);
                    alert("Sync Failed: Check Internet");
                }
            });
        }

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
                    if (data.data) refreshUI(data.data);
                    else refreshUI(data);
                } catch (error) {
                    console.error("Error setting bowler", error);
                    alert("Failed to set bowler.");
                }
            });
        }
    }

    // --- BOWLER MODAL LOGIC (FIXED) ---
    window.showSelectBowlerModal = async function () {
        try {
            const data = window.currentMatchData;
            if (!data || !data.bowling_team_id) {
                alert("Error: No Bowling Team ID found.");
                return;
            }

            console.log("Fetching bowling squad for team:", data.bowling_team_id);

            // 1. CHECK CACHE FIRST
            let players = window.squadCache.bowling;

            if (!players) {
                const res = await fetch(`${API_URL}/teams/${data.bowling_team_id}/players`);
                const pData = await res.json();
                players = pData.players;
                window.squadCache.bowling = players;
            }

            const select = document.getElementById('bowlerSelect');
            if (!select) return;

            select.innerHTML = '<option value="" disabled selected>Select Bowler...</option>';
            if (players && players.length > 0) {
                players.forEach(p => {
                    const opt = document.createElement('option');
                    opt.value = p.id;
                    opt.textContent = p.name;
                    select.appendChild(opt);
                });
            } else {
                const opt = document.createElement('option');
                opt.textContent = "No players found (Check Team Name)";
                select.appendChild(opt);
            }

            const modal = document.getElementById('selectBowlerModal');
            if (modal) modal.showModal();
        } catch (e) {
            console.error("Error fetching bowling squad", e);
            alert("Failed to load bowlers.");
        }
    }

    // --- BOOTSTRAP ---
    function bootstrap() {
        initButtons();
        initModals();

        // Initial Data Load
        fetch(`${API_URL}/match_data?match_id=${MATCH_ID}`)
            .then(r => r.json())
            .then(data => {
                if (data.error) {
                    alert("Failed to load match: " + data.error);
                    console.error("Match Data Error:", data.error);
                    return; // Stop further processing
                }
                refreshUI(data);

                // BACKGROUND: Pre-load squads for instant modals
                if (data.batting_team_id) {
                    fetch(`${API_URL}/teams/${data.batting_team_id}/players`)
                        .then(r => r.json()).then(d => window.squadCache.batting = d.players);
                }

                if (data.bowling_team_id) {
                    fetch(`${API_URL}/teams/${data.bowling_team_id}/players`)
                        .then(r => r.json()).then(d => window.squadCache.bowling = d.players);
                }
            })
            .catch(err => {
                console.error('API Fetch Error:', err);
                alert("Network or API Error: Cannot fetch match data.");
            });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', bootstrap);
    } else {
        bootstrap();
    }

})();


// --- SQUAD SELECTION LOGIC ---
window.switchTab = function (tabName) {
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
        if (el) el.style.display = 'block'; // Block is enough for wrapper
        loadTeams();
    } else if (tabName === 'scorecard') {
        const el = document.getElementById('scorecardPanel');
        if (el) el.style.display = 'block';
    } else if (tabName === 'graph') {
        const el = document.getElementById('graphPanel');
        if (el) el.style.display = 'block';
    } else if (tabName === 'commentary') {
        const el = document.getElementById('commentaryPanel');
        if (el) el.style.display = 'block';
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

window.loadSquadPlayers = async function () {
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

window.updateSquadCount = function () {
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

window.saveSquad = async function () {
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
        const urlParams = new URLSearchParams(window.location.search);
        const mId = urlParams.get('match_id') || 1; // Fallback to 1 if not found (though logic.js should alert)
        const res = await fetch(`${API_URL}/matches/${mId}/select_squad`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ team_id: parseInt(teamId), player_ids: playerIds })
        });
        const data = await res.json();
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
