import { openBatsmanModal, showSelectBowlerModal } from './modals.js';
// import { openEditPlayerModal } from './edit_player.js'; // Removed to avoid circular dependency
import { MATCH_ID, API_URL } from './config.js';
import { handleWicketFall } from './modals.js';

export function handleServerResponse(data) {
    if (!data) return;

    if (data.status === 'wicket_fall') {
        handleWicketFall(data);
    } else if (data.status === 'over_complete') {
        console.log("Over Complete!");
        if (data.data) refreshUI(data.data);
        showSelectBowlerModal();
    } else if (data.status === 'inning_break') {
        alert(data.message);
        if (window.switchTab) window.switchTab('squad');
        fetch(`${API_URL}/match_data?match_id=${MATCH_ID}`)
            .then(r => r.json())
            .then(d => refreshUI(d));

    } else if (data.data) {
        refreshUI(data.data);
    } else if (data.innings) {
        refreshUI(data);
    }
}

/**
 * HELPER: Updates text content ONLY if it has changed.
 * Prevents unnecessary browser repaints and text flickering.
 */
function safeUpdate(elementId, newValue) {
    const el = document.getElementById(elementId);
    if (!el) return;

    // Convert to string for strict comparison
    const newStr = String(newValue || "");

    if (el.textContent !== newStr) {
        el.textContent = newStr;
    }
}

/**
 * HELPER: Updates image source ONLY if the URL is different.
 * Prevents the "Image Reload Jump" (width collapsing to 0px) which causes the layout to shake.
 */
function safeUpdateImg(elementId, newSrc) {
    const el = document.getElementById(elementId);
    if (!el) return;

    // Resolve Path logic for Logos (Fixing the missing ../ issue)
    let processedSrc = newSrc;
    if (processedSrc && typeof processedSrc === 'string') {
        if (processedSrc.startsWith('/static/')) {
            processedSrc = '..' + processedSrc; // Converts /static/x -> ../static/x
        } else if (processedSrc.startsWith('static/')) {
            processedSrc = '../' + processedSrc;
        }
    }

    // 1. If newSrc is provided and differs from the current source, update it.
    // 2. We use getAttribute('src') to compare the raw string, ensuring exact matching.
    if (processedSrc && el.getAttribute('src') !== processedSrc) {
        el.src = processedSrc;
        el.style.display = 'block'; // Ensure it's visible if it was hidden
    }
    // Note: If newSrc is null/undefined (no logo), we do nothing. 
    // This keeps the placeholder or previous state stable without flickering.
}

/**
 * HELPER: Updates a specific style property ONLY if it has changed.
 * Handles "Default" color values by falling back to a default CSS variable or color.
 */
function safeUpdateStyle(elementId, property, value) {
    const el = document.getElementById(elementId);
    if (!el) return;

    let finalValue = value;
    // Handle "Default" or empty values - fallback to transparent or specific default
    if (!finalValue || finalValue.toLowerCase() === 'default') {
        finalValue = 'transparent'; // Or use a default variable like 'var(--team-default)'
    }

    if (el.style[property] !== finalValue) {
        el.style[property] = finalValue;
    }
}

/**
 * SETUP: Color Pickers
 * Allows clicking the team color box to open a picker and save to DB.
 */
const COLOR_OPTIONS = [
    { name: 'Yellow', code: '#FFFF00' },
    { name: 'Default', code: 'default' },
    { name: 'Black', code: '#000000' },
    { name: 'White', code: '#FFFFFF' },
    { name: 'Blue', code: '#0000FF' },
    { name: 'SkyBlue', code: '#87CEEB' },
    { name: 'Red', code: '#FF0000' },
    { name: 'Green', code: '#008000' },
    { name: 'LightGreen', code: '#90EE90' },
    { name: 'Pink', code: '#FFC0CB' },
    { name: 'Orange', code: '#FFA500' },
    { name: 'Grey', code: '#808080' },
    { name: 'Purple', code: '#800080' },
    { name: 'Maroon', code: '#800000' },
    { name: 'Brown', code: '#A52A2A' },
    { name: 'Violet', code: '#EE82EE' },
    { name: 'Teal', code: '#008080' },
    { name: 'Navy', code: '#000080' }
];

export function setupColorPickers() {
    setupSinglePicker('teamA_color_box', () => window.currentMatchData?.batting_team_id);
    setupSinglePicker('teamB_color_box', () => window.currentMatchData?.bowling_team_id);

    // Close popup on outside click
    document.addEventListener('click', (e) => {
        const popup = document.getElementById('customColorPicker');
        if (!popup || popup.style.display === 'none') return;

        const isClickInside = popup.contains(e.target) ||
            e.target.id === 'teamA_color_box' ||
            e.target.id === 'teamB_color_box';

        if (!isClickInside) {
            popup.style.display = 'none';
        }
    });
}

function setupSinglePicker(boxId, getTeamIdFn) {
    const box = document.getElementById(boxId);
    if (!box) return;

    box.addEventListener('click', (e) => {
        e.stopPropagation(); // Prevent immediate close
        const teamId = getTeamIdFn();
        if (!teamId) {
            alert("No team loaded yet!");
            return;
        }
        openColorPicker(e, teamId, box);
    });
}

function openColorPicker(event, teamId, targetBox) {
    const popup = document.getElementById('customColorPicker');
    const grid = document.getElementById('colorOptionsGrid');
    if (!popup || !grid) return;

    // Populate Options
    grid.innerHTML = '';
    COLOR_OPTIONS.forEach(opt => {
        const row = document.createElement('div');
        row.className = 'color-option';

        const preview = document.createElement('div');
        preview.className = 'color-preview-box';
        if (opt.code === 'default') {
            preview.style.background = 'transparent';
            preview.style.border = '1px dashed #000';
        } else {
            preview.style.background = opt.code;
        }

        const label = document.createElement('span');
        label.className = 'color-name';
        label.textContent = opt.name;

        row.appendChild(preview);
        row.appendChild(label);

        row.onclick = () => selectColor(teamId, opt.code, targetBox);
        grid.appendChild(row);
    });

    // Position Popup
    const rect = targetBox.getBoundingClientRect();
    popup.style.display = 'block';

    // Position below the box, aligned left
    // Adjust logic to handle if it goes off screen if needed, but simple for now
    popup.style.left = `${rect.left}px`;
    popup.style.top = `${rect.bottom + 5}px`;
}

async function selectColor(teamId, colorCode, targetBox) {
    const popup = document.getElementById('customColorPicker');
    if (popup) popup.style.display = 'none';

    // Optimistic Update
    targetBox.style.background = colorCode === 'default' ? 'transparent' : colorCode;

    try {
        const response = await fetch(`${API_URL}/teams/${teamId}/set_color`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ color: colorCode })
        });

        const result = await response.json();
        if (result.status === "success") {
            console.log("Color saved:", colorCode);
        } else {
            console.error("Failed to save color:", result);
            // Show the specific error from backend if available
            const setErr = result.error || result.detail || "Unknown Error";
            alert(`Failed to save color.\nServer says: ${setErr}`);
        }
    } catch (err) {
        console.error("API Error:", err);
        alert("Error saving color.");
    }
}

/**
 * OPTIMIZED UI REFRESH
 * Only updates DOM elements that have actually changed.
 */
export function refreshUI(data) {
    if (!data || !data.innings) return;

    // --- 1. Images (The Primary Cause of Shaking) ---
    // safeUpdateImg will ONLY touch the DOM if the logo URL is new.
    safeUpdateImg('header_batting_logo', data.batting_team_logo);
    safeUpdateImg('header_bowling_logo', data.bowling_team_logo);

    // --- 1.5 Team Colors ---
    safeUpdateStyle('teamA_color_box', 'background', data.batting_team_color);
    safeUpdateStyle('teamB_color_box', 'background', data.bowling_team_color);

    // --- 2. Text Content (Prevents micro-flickering) ---
    safeUpdate('header_team_name', data.batting_team || "Batting Team");
    safeUpdate('header_bowling_name', data.bowling_team || "Bowling Team");

    // Construct Score String
    const scoreStr = `${data.innings.runs}/${data.innings.wickets}`;
    safeUpdate('header_score', scoreStr);

    // Overs String Logic
    let oversStr = String(data.innings.overs);
    if (!oversStr.includes('.')) oversStr += ".0";
    safeUpdate('header_overs', `(${oversStr} ov)`);

    // --- 3. Stats ---
    safeUpdate('header_crr', data.crr || "0.00");
    safeUpdate('header_proj', data.projected_score || "0");

    // --- 4. Top Bar Info ---
    safeUpdate('top_match_no', `Match No. ${data.match_number || '--'}`);
    safeUpdate('top_match_overs', `${data.total_overs || 0} Overs`);
    safeUpdate('top_match_type', data.match_type || 'League Match');

    // --- 4.5 Partnership ---
    const partEl = document.getElementById('partnership_val');
    if (partEl) {
        if (data.current_partnership) {
            const pRuns = data.current_partnership.runs;
            const pBalls = data.current_partnership.balls;
            partEl.textContent = `${pRuns} (${pBalls})`;

            // Optional: Make it green if partnership is good (>50)
            if (pRuns >= 50) partEl.style.color = "#00e676";
            else partEl.style.color = "#fff";
        } else {
            partEl.textContent = "0 (0)";
            partEl.style.color = "#fff";
        }
    }

    // --- 5. "This Over" Box ---
    const thisOverEl = document.getElementById('this_over_runs');
    if (thisOverEl) {
        const runs = data.this_over_runs !== undefined ? data.this_over_runs : 0;
        const runsStr = `${runs} runs`;
        if (thisOverEl.textContent !== runsStr) {
            thisOverEl.textContent = runsStr;
            thisOverEl.style.color = runs > 0 ? "#fff" : "#aaa";
        }
    }

    // 5.5 Render Ball Badges
    const ballsContainer = document.getElementById('this_over_balls_container');
    if (ballsContainer && data.this_over_balls) {
        // Clear current content
        ballsContainer.innerHTML = '';

        data.this_over_balls.forEach(ball => {
            const badge = document.createElement('span');
            badge.className = 'ball-badge'; // Base class

            let label = String(ball.runs);
            let colorClass = 'ball-dot'; // Default white

            // Logic for visual style
            if (ball.is_wicket) {
                label = 'W';
                colorClass = 'ball-w';
            } else if (ball.runs === 4) {
                colorClass = 'ball-4';
            } else if (ball.runs === 6) {
                colorClass = 'ball-6';
            } else if (ball.extra_type) {
                // Formatting extras: WD, NB, LB
                // If it is 1wd, usually labeled 'wd'. If 5wd (4+1), labeled '5wd'?
                // For simplicity:
                label = ball.extra_type.substring(0, 2).toUpperCase(); // WD, NB, LB, BY
                if (ball.runs > 0) {
                    // For wides, runs are usually 1. If 5wides, runs off bat is 0, extras 5.
                    // The backend 'runs' in ball object is 'runs_off_bat'. 
                    // We need total runs for the badge? No, badge usually shows the event.
                    // If 5 wides: extra=5.
                    // Let's show (Total Runs + Type) if > 1? e.g. "5WD"
                    if (ball.extras > 1) {
                        label = `${ball.extras}${label}`;
                    }
                }
                colorClass = 'ball-extra';
            } else {
                // Normal ball
                if (ball.runs > 0) {
                    // 1, 2, 3 runs - use default white/gray but maybe different text?
                    // Image shows 0, 1 as white circles.
                }
            }

            badge.classList.add(colorClass);
            badge.textContent = label;
            ballsContainer.appendChild(badge);
        });
    }

    // --- 6. Conditional Elements (Target) ---
    const targetBox = document.getElementById('target-display');
    const currentInning = data.innings.current_inning || 1;
    const targetScore = data.innings.target || 0;

    if (targetBox) {
        if (currentInning === 2 && targetScore > 0) {
            targetBox.style.display = 'block';
            // InnerHTML is risky for flickering, but usually okay for simple spans. 
            // We can check display style first.
            const newHtml = `Target: <span style="color:#ffd700; font-weight:bold;">${targetScore}</span>`;
            if (targetBox.innerHTML !== newHtml) targetBox.innerHTML = newHtml;
        } else {
            targetBox.style.display = 'none';
        }
    }

    // Bowling Score (Target - 1 display OR Full Previous Inning Stats)
    const bowlScoreEl = document.getElementById('header_bowling_score');
    if (bowlScoreEl) {
        if (currentInning === 2) {
            // New Logic: Show Runs/Wickets (Overs)
            if (data.previous_inning) {
                const p = data.previous_inning;
                const scoreStr = `${p.runs}/${p.wickets} <span style="font-size:0.6em; vertical-align:middle;">(${p.overs} ov)</span>`;
                if (bowlScoreEl.innerHTML !== scoreStr) {
                    bowlScoreEl.innerHTML = scoreStr;
                    bowlScoreEl.style.display = 'block';
                }
            } else if (targetScore > 0) {
                // Fallback: Just show Runs (Target - 1)
                const firstInningRuns = String(targetScore - 1);
                if (bowlScoreEl.innerText !== firstInningRuns) {
                    bowlScoreEl.innerText = firstInningRuns;
                    bowlScoreEl.style.display = 'block';
                }
            }
        } else {
            bowlScoreEl.innerText = "";
        }
    }

    // --- 7. Button States (End Inning / Save Match) ---
    const actionBtn = document.getElementById('btn_end_inning');
    if (actionBtn) {
        const isSecondInnings = (data.innings.current_inning === 2);
        const currentRuns = data.innings.runs;
        const target = data.innings.target;
        const totalBalls = (data.total_overs || 20) * 6;
        const [ovs, bls] = oversStr.split('.').map(Number); // Re-using oversStr calculated above
        const ballsBowled = (ovs * 6) + (bls || 0);

        const battingWon = (isSecondInnings && target > 0 && currentRuns >= target);
        const bowlingWonOrOver = (isSecondInnings && ballsBowled >= totalBalls);
        const isMatchOver = battingWon || bowlingWonOrOver;

        // Logic for Text/Style updates (Simplified for readability, usually doesn't flicker much)
        if (data.status === 'completed') {
            safeUpdate('btn_end_inning', "Match Locked 🔒");
            actionBtn.disabled = true;
            actionBtn.style.background = "#555";
            actionBtn.style.display = 'inline-block';
        }
        else if (isMatchOver) {
            safeUpdate('btn_end_inning', "💾 Save Match");
            actionBtn.disabled = false;
            actionBtn.style.background = "#28a745";
            actionBtn.style.display = 'inline-block';
            actionBtn.dataset.action = "save_match";
        }
        else if (!isSecondInnings) {
            safeUpdate('btn_end_inning', "End Inning");
            actionBtn.style.background = "#333";
            actionBtn.style.display = 'inline-block';
            actionBtn.dataset.action = "end_inning";
        }
        else {
            actionBtn.style.display = 'none';
        }
    }

    updateNotificationBar(data);

    // --- 8. Player Cards (Batsmen/Bowler) ---
    // Note: These usually don't shake because they are complex HTML replacements.
    // If they do start shaking, apply similar diffing logic inside updateBatsmanUI/updateBowlerCard.

    let p1 = null;
    let p2 = null;

    if (data.current_batsmen && data.current_batsmen.length > 0) {
        p1 = data.current_batsmen.find(p => p.on_strike === true || p.on_strike === 1);
        p2 = data.current_batsmen.find(p => !p.on_strike || p.on_strike === 0 || p.on_strike === false);
        if (!p1 && !p2 && data.current_batsmen.length === 1) {
            p1 = data.current_batsmen[0];
        }
    }

    // PASS LAST OUT DATA HERE
    updateBatsmanUI(p1, p2, data.last_out);
    updateBowlerCard(data.current_bowler ? data.current_bowler : null);

    window.currentMatchData = data;

    // --- QUICK SQUAD HOOK ---
    // Check if we have initialized the squad panel yet (prevent constant reloading)
    if (!window.squadPanelLoaded && data.batting_team_id) { // using batting_team_id as proxy for data loaded
        if (window.initQuickSquadPanel) {
            window.initQuickSquadPanel(data);
            window.squadPanelLoaded = true; // Set a flag so it runs only once per load
        }
    }

    // --- 9. Match Completion State ---
    if (data.status === 'completed') {
        toggleScoringButtons(true);
        const undoBtn = document.querySelector('.btn-undo');
        if (undoBtn) {
            undoBtn.disabled = false;
            undoBtn.style.display = 'inline-block';
            undoBtn.style.opacity = '1.0';
            undoBtn.style.cursor = 'pointer';
        }

        const banner = document.querySelector('.toss-banner');
        if (banner) {
            // Only update if content changed to avoid flicker
            const newBannerHtml = `<strong>MATCH COMPLETED:</strong> ${data.result_message || "Result Saved"}`;
            if (banner.innerHTML !== newBannerHtml) {
                banner.innerHTML = newBannerHtml;
                banner.style.background = "#333";
                banner.style.color = "#fff";
            }
        }
    } else {
        toggleScoringButtons(false);
    }
}

export function toggleScoringButtons(disabled) {
    const batBtns = document.querySelectorAll('.btn-run');
    const actBtns = document.querySelectorAll('.btn-action');
    const undoBtn = document.querySelector('.btn-undo');

    const setState = (btn) => {
        // If hard disabled (match over), keep disabled
        if (disabled) {
            btn.disabled = true;
            btn.style.opacity = '0.5';
            btn.style.cursor = 'not-allowed';
        } else {
            // "Smart" Enable
            // We enable them technically, but the click handler will block them if players missing.
            // This allows the user to click and see the "Why" alert.
            btn.disabled = false;
            btn.style.opacity = '1.0';
            btn.style.cursor = 'pointer';
        }
    };

    batBtns.forEach(setState);
    actBtns.forEach(btn => {
        setState(btn);
    });

    if (undoBtn) setState(undoBtn);
}

function updateNotificationBar(data) {
    if (!data) return;
    const banner = document.querySelector('.toss-banner');
    if (!banner) return;

    const currentRuns = parseInt(data.innings.runs) || 0;
    const currentWickets = parseInt(data.innings.wickets) || 0; // This includes manual adjustments
    const target = parseInt(data.innings.target) || 0;
    const isSecondInnings = (data.innings.current_inning === 2);

    const oversStr = data.innings.overs || "0.0";
    const [overs, balls] = oversStr.split('.').map(Number);
    const ballsBowled = (overs * 6) + (balls || 0);
    const totalOvers = data.total_overs || 20;
    const totalBallsMatch = totalOvers * 6;

    // --- CASE 1: BATTING TEAM WINS (CHASE SUCCESSFUL) ---
    if (isSecondInnings && target > 0 && currentRuns >= target) {
        // Calculate Wickets in Hand accurately
        const wicketsLeft = 10 - currentWickets;

        banner.textContent = `MATCH COMPLETED: ${data.batting_team} won by ${wicketsLeft} wickets`;
        banner.style.background = '#ffd700';
        banner.style.color = '#000';
        banner.style.fontWeight = 'bold';
        return;
    }

    // --- CASE 2: BOWLING TEAM WINS (DEFENDED TARGET) ---
    if (isSecondInnings && ballsBowled >= totalBallsMatch && currentRuns < (target - 1)) {
        const margin = (target - 1) - currentRuns;
        banner.textContent = `MATCH COMPLETED: ${data.bowling_team} won by ${margin} runs`;
        banner.style.background = '#ffd700';
        banner.style.color = '#000';
        banner.style.fontWeight = 'bold';
        return;
    }

    // --- CASE 3: ALL OUT (DEFENDED TARGET) ---
    if (isSecondInnings && currentWickets >= 10 && currentRuns < target) {
        const margin = (target - 1) - currentRuns;
        banner.textContent = `MATCH COMPLETED: ${data.bowling_team} won by ${margin} runs`;
        banner.style.background = '#ffd700';
        banner.style.color = '#000';
        banner.style.fontWeight = 'bold';
        return;
    }

    // --- CASE 4: TIE ---
    if (isSecondInnings && (ballsBowled >= totalBallsMatch || currentWickets >= 10) && currentRuns === (target - 1)) {
        banner.textContent = "MATCH TIED!";
        banner.style.background = '#ffa500';
        banner.style.color = '#fff';
        banner.style.fontWeight = 'bold';
        return;
    }

    // --- NEW: Match Equation (2nd Inning) ---
    if (isSecondInnings && target > 0) {
        const runsNeeded = target - currentRuns;
        const ballsRemaining = totalBallsMatch - ballsBowled;

        // Example: "India needs 46 runs from 22 balls"
        if (runsNeeded > 0 && ballsRemaining >= 0) {
            banner.textContent = `${data.batting_team} needs ${runsNeeded} runs from ${ballsRemaining} balls`;
            banner.style.background = '#000'; // Or a dark distinct color
            banner.style.color = '#fff';     // White text
            banner.style.fontWeight = 'bold';
            return;
        }
    }

    // --- DEFAULT: SHOW TOSS OR RESULT MESSAGE ---
    if (data.result_message && data.result_message !== 'live' && data.result_message !== 'scheduled') {
        banner.textContent = data.result_message;
        banner.style.background = '#ffd700';
        banner.style.color = '#000';
    } else if (data.toss_winner_name && data.toss_decision) {
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

// --- OPEN PLAYER SELECTION WRAPPER ---
window.openPlayerSelection = function (role) {
    console.log(`Need to select: ${role}`);
    window.selectingForRole = role;

    if (role === 'bowler') {
        if (window.showSelectBowlerModal) {
            window.showSelectBowlerModal();
        } else {
            console.error("showSelectBowlerModal not found");
        }
    } else {
        if (window.changeBatsman) {
            window.changeBatsman(role);
        } else {
            console.error("changeBatsman function not found!");
            alert("Error: interactions not loaded.");
        }
    }
};

export function updateBowlerCard(bowler) {
    const cardContainer = document.getElementById('bowler-card');
    if (!cardContainer) return;

    // Debugging logic
    console.log("Debug Bowler:", bowler);
    const bName = (bowler && bowler.name) ? bowler.name.trim().toLowerCase() : "";
    const isPlaceholder = ["select bowler", "bowler name"].includes(bName);

    if (!bowler || !bowler.name || isPlaceholder) {
        // Show Animated Button with ⚾ Icon
        cardContainer.innerHTML = `
            <div class="player-placeholder">
                <button class="btn-pulse" onclick="window.openPlayerSelection('bowler')">
                    ⚾ Select Bowler
                </button>
            </div>`;
    } else {
        // Standardize Stats String (O - M - R - W)
        const maidens = bowler.maidens || 0;
        const runs = bowler.runs_conceded || 0;
        const wkts = bowler.wickets || 0;
        // const statsStr = `${bowler.overs} - ${maidens} - ${runs} - ${wkts}`;
        // USER REQUEST: "small integer in one line"
        const statsStr = `${bowler.overs} - ${maidens} - ${runs} - ${wkts}`;

        const econ = bowler.econ || "0.00";
        const extras = bowler.extras || "0";
        const dots = bowler.dots || "0";

        // Determine Image (Use photo if available, otherwise default circle)
        // DEFAULT IMAGE LOGIC
        const defaultImg = '/static/images/avatar_placeholder.png';
        const photoUrl = bowler.photo_url || defaultImg;

        const imgHtml = `<img src="${photoUrl}" class="player-photo-lg" alt="Bowler" 
                            style="width:50px; height:50px; border-radius:50%; object-fit:cover;" 
                            onerror="this.onerror=null;this.src='${defaultImg}';">`;

        cardContainer.innerHTML = `
             <div class="bowler-header-bg bowler-header-flex" style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid #333; padding-bottom:5px; margin-bottom:5px;">
                <span id="tv_bowler" class="text-white-bold-sm">${bowler.name}</span>
                <button onclick="window.showSelectBowlerModal()" class="btn-change-xs" style="opacity:0.6;">⋮</button>
            </div>

            <div class="player-flex-layout" style="display:flex; gap:10px; align-items:center;">
                ${imgHtml}
                <div class="stats-content" style="flex:1;">
                    
                    <!-- Top Row: Stats + Buttons inline -->
                    <div class="card-actions-row">
                        <div id="tv_curBo_score" class="text-stats-sm">
                            ${statsStr}
                        </div>
                        <button onclick="window.togglePlayerOverlay(${bowler.id})" class="btn-show-xs">
                            Show
                        </button>
                    </div>

                    <!-- Details Row -->
                    <div class="stats-detail-row" style="font-size:11px; color:#ccc; margin-top:2px;">
                        Econ: <span id="tv_curBo_econ">${econ}</span> &nbsp;
                        Dots: <span id="tv_curBo_dots">${dots}</span> &nbsp;
                        Extras: <span id="tv_curBo_extras">${extras}</span>
                    </div>

                    <!-- Profile Button (Small) -->
                     <div style="margin-top:2px;">
                        <button onclick="window.openPlayerProfile(${bowler.id})" class="btn-profile-xs">
                            Profile
                        </button>
                    </div>
                </div>
            </div>
        `;
    }
}

export function updateBatsmanUI(striker, nonStriker, lastOut) {
    const isRealPlayer = (p) => p && p.id && p.name !== "Unknown" && p.name !== "";

    // Helper to generate Last Out HTML
    const getLastOutHtml = () => {
        if (!lastOut) return "";
        return `
            <div class="last-out-card-strip">
                <div class="badg-lo">Last Out</div>
                <div class="lo-details-col">
                    <span class="lo-name">${lastOut.batter_name}</span>
                    <span class="lo-how">${lastOut.dismissal}</span>
                </div>
                <div class="lo-score-right">
                    ${lastOut.runs}(${lastOut.balls}b ${lastOut.fours}x4 ${lastOut.sixes}x6)
                </div>
            </div>
        `;
    };

    // --- NEW: Render Last Out in External Container ---
    const lastOutDisplay = document.getElementById('last-out-display');
    const p2Spacer = document.getElementById('p2-spacer');
    const bowlerSpacer = document.getElementById('bowler-spacer');

    if (lastOutDisplay) {
        const loContent = getLastOutHtml();
        if (loContent) {
            lastOutDisplay.innerHTML = loContent;
            lastOutDisplay.style.display = 'block';

            // Sync Spacers (Same size, invisible)
            if (p2Spacer) {
                p2Spacer.innerHTML = loContent;
                p2Spacer.style.display = 'block';
                p2Spacer.style.visibility = 'hidden'; // Invisible but takes space
            }
            if (bowlerSpacer) {
                bowlerSpacer.innerHTML = loContent;
                bowlerSpacer.style.display = 'block';
                bowlerSpacer.style.visibility = 'hidden';
            }

        } else {
            lastOutDisplay.style.display = 'none';
            lastOutDisplay.innerHTML = '';

            // Hide Spacers
            if (p2Spacer) {
                p2Spacer.style.display = 'none';
                p2Spacer.innerHTML = '';
            }
            if (bowlerSpacer) {
                bowlerSpacer.style.display = 'none';
                bowlerSpacer.innerHTML = '';
            }
        }
    }

    // 1. STRIKER CARD
    const p1Card = document.getElementById('p1-card');
    if (isRealPlayer(striker)) {
        // IMAGE LOGIC
        const defaultImg = '/static/images/avatar_placeholder.png';
        const photoUrl = striker.photo_url || defaultImg;

        const imgHtml = `<img src="${photoUrl}" class="player-photo" alt="${striker.name}" 
                            style="width:50px; height:50px; border-radius:50%; object-fit:cover;" 
                            onerror="this.onerror=null;this.src='${defaultImg}';">`;

        p1Card.innerHTML = `
            <div class="card-padding" style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid #333; padding-bottom:5px; margin-bottom:5px;">
                <span class="text-white-bold-sm">
                    🏏 ${striker.name} <span style="color:#4caf50; font-size:10px;">(Striker)</span>
                </span>
                <button onclick="window.changeBatsman('striker')" class="btn-change-xs" style="opacity:0.6;">⋮</button>
            </div>

            <div class="player-flex-layout" style="display:flex; gap:10px; align-items:center;">
                ${imgHtml}
                
                <div class="stats-content" style="flex:1;">
                    
                    <div class="card-actions-row">
                         <div class="score-highlight" style="font-size:20px; font-weight:bold; color:#fff;">
                            ${striker.runs} <span style="font-size:14px; color:#aaa;">(${striker.balls})</span>
                        </div>
                        <button onclick="window.togglePlayerOverlay(${striker.id})" class="btn-show-xs">
                            Show
                        </button>
                    </div>

                    <div class="stats-detail-row" style="font-size:11px; color:#ccc; margin-top:2px;">
                        4s: ${striker.fours} &nbsp; 6s: ${striker.sixes} &nbsp; <span style="color:#ffeb3b">SR: ${striker.sr}</span>
                    </div>

                     <div style="margin-top:2px;">
                        <button onclick="window.openPlayerProfile(${striker.id})" class="btn-profile-xs">
                            Profile
                        </button>
                    </div>
                </div>
            </div>
            `;
    } else {
        // Red Button Logic
        p1Card.innerHTML = `
            <div style="padding: 20px; display:flex; flex-direction:column; align-items:center; justify-content:center; height:100%;">
                <button class="btn-select-pulse" onclick="window.changeBatsman('striker')">
                    Select Striker
                </button>
            </div>`;
    }

    // 2. NON-STRIKER CARD
    const p2Card = document.getElementById('p2-card');
    if (isRealPlayer(nonStriker)) {
        // IMAGE LOGIC
        const defaultImg = '/static/images/avatar_placeholder.png';
        const photoUrl = nonStriker.photo_url || defaultImg;

        const imgHtml = `<img src="${photoUrl}" class="player-photo" alt="${nonStriker.name}" 
                            style="width:50px; height:50px; border-radius:50%; object-fit:cover;" 
                            onerror="this.onerror=null;this.src='${defaultImg}';">`;

        p2Card.innerHTML = `
            <div class="card-padding" style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid #333; padding-bottom:5px; margin-bottom:5px;">
                <span class="text-white-bold-sm">${nonStriker.name}</span>
                <button onclick="window.changeBatsman('non_striker')" class="btn-change-xs" style="opacity:0.6;">⋮</button>
            </div>

            <div class="player-flex-layout" style="display:flex; gap:10px; align-items:center;">
                ${imgHtml}
                
                <div class="stats-content" style="flex:1;">
                     <div class="card-actions-row">
                        <div class="score-highlight" style="font-size:20px; font-weight:bold; color:#fff;">
                            ${nonStriker.runs} <span style="font-size:14px; color:#aaa;">(${nonStriker.balls})</span>
                        </div>
                        <button onclick="window.togglePlayerOverlay(${nonStriker.id})" class="btn-show-xs">
                            Show
                        </button>
                    </div>

                    <div class="stats-detail-row" style="font-size:11px; color:#ccc; margin-top:2px;">
                        4s: ${nonStriker.fours} &nbsp; 6s: ${nonStriker.sixes} &nbsp; <span style="color:#ffeb3b">SR: ${nonStriker.sr}</span>
                    </div>

                    <div style="margin-top:2px;">
                        <button onclick="window.openPlayerProfile(${nonStriker.id})" class="btn-profile-xs">
                            Profile
                        </button>
                    </div>
                </div>
            </div>`;
    } else {
        p2Card.innerHTML = `
            <div style="padding: 20px; display:flex; align-items:center; justify-content:center; height:100%;">
                <button class="btn-select-pulse" onclick="window.changeBatsman('non_striker')">
                    Select Non-Striker
                </button>
            </div>`;
    }

    // --- NEW LOGIC START: TOGGLE ROTATE BUTTON ---
    const rotateBtn = document.getElementById('btn_rotate_strike');
    if (rotateBtn) {
        if (isRealPlayer(striker) && isRealPlayer(nonStriker)) {
            // Both players exist -> Show Button
            rotateBtn.style.display = "block";
        } else {
            // One or both missing -> Hide Button
            rotateBtn.style.display = "none";
        }
    }
}

// --- MANUAL SCORE OVERRIDE LOGIC ---

// Global State for Override
window.editingTeamRole = null; // 'batting' or 'bowling'

// --- QUICK SQUAD EDIT LOGIC ---

let quickTeamA_ID = null;
let quickTeamB_ID = null;

// Call this function once when match data loads (e.g., inside refreshUI)
window.initQuickSquadPanel = function (data) {
    if (!data) return;

    // 1. Set Team IDs & Names
    // Use the IDs from the match data.
    // Note: data.team_a_id might not exist directly if the response structure is flattened or specific to current state.
    // However, looking at previous data structures, we often have batting_team_id and bowling_team_id.
    // But for "Team A" and "Team B" specifically, we might need to rely on what's available.
    // The user snippet suggested: data.team_a_id || data.batting_team_id
    // I will assume team_a_id/team_b_id might be present in a comprehensive match object, 
    // but if it's the live polling data, it might fluctuate.
    // Let's stick to the snippet logic but be careful.

    // In a live match value, batting_team_id changes. 
    // If we want "Team A" to be static, we need the match fixture details.
    // Assuming data object has this or we fallback to batting/bowling at init time.

    quickTeamA_ID = data.team_a_id || data.batting_team_id;
    quickTeamB_ID = data.team_b_id || data.bowling_team_id;

    // Update Headers
    const nameA = data.team_a_name || data.batting_team || "Team A";
    const nameB = data.team_b_name || data.bowling_team || "Team B";

    const labelA = document.getElementById('quick-team-name-a');
    if (labelA) labelA.textContent = nameA;

    const labelB = document.getElementById('quick-team-name-b');
    if (labelB) labelB.textContent = nameB;

    // 2. Fetch & Render Lists
    fetchAndRenderSquad(quickTeamA_ID, 'list-squad-a');
    fetchAndRenderSquad(quickTeamB_ID, 'list-squad-b');
}

window.refreshQuickSquads = function () {
    if (quickTeamA_ID) fetchAndRenderSquad(quickTeamA_ID, 'list-squad-a');
    if (quickTeamB_ID) fetchAndRenderSquad(quickTeamB_ID, 'list-squad-b');
}

async function fetchAndRenderSquad(teamId, listElementId) {
    if (!teamId) return;
    const listEl = document.getElementById(listElementId);
    if (!listEl) return;

    try {
        const res = await fetch(`${API_URL}/teams/${teamId}/players`);
        if (res.ok) {
            const data = await res.json();
            if (data.players) {
                renderPlayerList(data.players, listEl);
            } else {
                // Fallback if it returns array directly (backward compatibility if needed, though we just defined it)
                if (Array.isArray(data)) renderPlayerList(data, listEl);
            }
        }
    } catch (e) {
        console.error("Squad Fetch Error", e);
        listEl.innerHTML = "<div style='color:red'>Error loading</div>";
    }
}

function renderPlayerList(players, container) {
    container.innerHTML = "";

    // Update Count (assumes sibling element exists with id 'count-a' or 'count-b' relative to container id)
    // container id is 'list-squad-a' or 'list-squad-b'
    const parts = container.id.split('-');
    const side = parts.length > 0 ? parts[parts.length - 1] : ''; // 'a' or 'b'
    const countEl = document.getElementById(`count-${side}`);
    if (countEl) countEl.textContent = players.length;

    players.forEach((p, index) => {
        const row = document.createElement('div');
        row.className = 'quick-player-row';

        const safeName = p.name.replace(/'/g, "\\'");

        row.innerHTML = `
            <div class="quick-rank">${index + 1}.</div>
            <div class="quick-avatar">
                 <img src="${p.photo_url || '../static/images/avatar_placeholder.png'}" onerror="this.src='../static/images/avatar_placeholder.png'" alt="av">
            </div>
            <div class="quick-name">${p.name}</div>
            <button onclick="quickEditPlayer(${p.id}, '${safeName}')" class="btn-quick-edit">
                <!-- Pencil Icon SVG -->
                <svg width="14" height="14" viewBox="0 0 24 24" fill="white"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg> 
            </button>
        `;
        container.appendChild(row);
    });
}

// --- SCORECARD LOGIC ---

let fullScorecardData = null;

window.loadScorecard = async function () {
    if (!MATCH_ID) return;
    try {
        const res = await fetch(`${API_URL}/matches/${MATCH_ID}/scorecard`);
        if (res.ok) {
            fullScorecardData = await res.json();
            // Default to current inning, or Inning 1 if not set
            const currentInn = window.currentMatchData?.innings?.current_inning || 1;
            renderInningScorecard(currentInn);
        }
    } catch (e) {
        console.error("Scorecard Load Error:", e);
    }
}

window.renderInningScorecard = function (inn) {
    if (!fullScorecardData) return;

    // Update Tab UI
    const btn1 = document.getElementById('btn-sc-inn1');
    const btn2 = document.getElementById('btn-sc-inn2');
    if (btn1) btn1.className = (inn === 1) ? 'tab-btn active' : 'tab-btn';
    if (btn2) btn2.className = (inn === 2) ? 'tab-btn active' : 'tab-btn';

    const data = (inn === 1) ? fullScorecardData.inning1 : fullScorecardData.inning2;
    const battingBody = document.getElementById('sc-batting-body');
    const bowlingBody = document.getElementById('sc-bowling-body');
    const totalScore = document.getElementById('sc-total-score');
    const extrasEl = document.getElementById('sc-extras');

    if (battingBody) battingBody.innerHTML = "";
    if (bowlingBody) bowlingBody.innerHTML = "";

    if (!data) {
        if (totalScore) totalScore.textContent = "Inning not started";
        if (extrasEl) extrasEl.textContent = "";
        return;
    }

    // 1. Update Header
    if (totalScore) totalScore.textContent = `${data.total}-${data.wickets} (${data.overs})`;

    // 2. Render Batting
    if (battingBody) {
        data.batting.forEach(b => {
            const row = `
                <tr style="border-bottom:1px solid #222;">
                    <td style="padding:8px; color:#00e5ff; font-weight:bold;">${b.name}</td>
                    <td style="padding:8px; color:#aaa; font-size:12px;">${b.out}</td>
                    <td style="padding:8px; text-align:center; font-weight:bold;">${b.runs}</td>
                    <td style="padding:8px; text-align:center;">${b.balls}</td>
                    <td style="padding:8px; text-align:center;">${b['4s']}</td>
                    <td style="padding:8px; text-align:center;">${b['6s']}</td>
                    <td style="padding:8px; text-align:center;">${b.sr}</td>
                </tr>
            `;
            battingBody.innerHTML += row;
        });
    }

    // 3. Render Extras
    const ex = data.extras;
    if (extrasEl) extrasEl.textContent = `${ex.total} (b ${ex.b}, lb ${ex.lb}, w ${ex.w}, nb ${ex.nb}, p ${ex.p})`;

    // 4. Render Bowling
    if (bowlingBody) {
        data.bowling.forEach(b => {
            const row = `
                <tr style="border-bottom:1px solid #222;">
                    <td style="padding:8px; text-align:left; color:#00e5ff;">${b.name}</td>
                    <td style="padding:8px; text-align:center;">${b.overs_display}</td>
                    <td style="padding:8px; text-align:center;">0</td> <td style="padding:8px; text-align:center;">${b.runs}</td>
                    <td style="padding:8px; text-align:center; font-weight:bold; color:#ff5252;">${b.wkts}</td>
                    <td style="padding:8px; text-align:center;">${b.econ}</td>
                </tr>
            `;
            bowlingBody.innerHTML += row;
        });
    }
}

window.quickAddPlayer = async function (side) {
    const teamId = (side === 'A') ? quickTeamA_ID : quickTeamB_ID;
    const inputId = (side === 'A') ? 'input-add-a' : 'input-add-b';
    const listId = (side === 'A') ? 'list-squad-a' : 'list-squad-b';

    const nameInput = document.getElementById(inputId);
    const name = nameInput.value.trim();
    if (!name || !teamId) return;

    try {
        const res = await fetch(`${API_URL}/players`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ team_id: teamId, name: name, role: "Player" })
        });

        if (res.ok) {
            nameInput.value = ""; // Clear input
            fetchAndRenderSquad(teamId, listId); // Refresh list
        } else {
            alert("Error adding player: " + res.statusText);
        }
    } catch (e) {
        alert("Error adding player");
        console.error(e);
    }
}

window.quickEditPlayer = async function (playerId, oldName) {
    try {
        // Fetch full player details before opening modal
        const res = await fetch(`${API_URL}/players/${playerId}`);
        if (res.ok) {
            const player = await res.json();

            // Dynamic import to avoid circular dependency (ui -> edit_player -> api -> ui)
            const { openEditPlayerModal } = await import('./edit_player.js');
            openEditPlayerModal(player);
        } else {
            alert("Failed to fetch player details for editing.");
        }
    } catch (e) {
        console.error("Error opening edit modal:", e);
        alert("Error opening edit modal");
    }
}

window.openScoreModal = function (role) {
    window.editingTeamRole = role;
    const modal = document.getElementById('scoreOverrideModal');
    const title = document.getElementById('overrideModalTitle');

    // Determine current values based on role and current match state
    const data = window.currentMatchData;
    if (!data) return alert("Match data not loaded");

    let runs, wickets, oversStr;
    const isBatting = role === 'batting';
    const isSecondInning = data.innings.current_inning === 2;

    if (isBatting) {
        // Editing Current Inning (Batting Team)
        // Usually Team A in 1st Inning, Team B in 2nd Inning
        runs = data.innings.runs;
        wickets = data.innings.wickets;
        oversStr = data.innings.overs;
        title.innerText = `Edit ${isSecondInning ? "2nd" : "1st"} Inning Score`;
    } else {
        // Editing "Other" Inning (Bowling Team)
        // If 2nd Inning, this is 1st Inning Score
        // If 1st Inning, Bowling Team has no score yet (usually 0/0)
        if (isSecondInning && data.previous_inning) {
            runs = data.previous_inning.runs;
            wickets = data.previous_inning.wickets;
            oversStr = data.previous_inning.overs;
            title.innerText = "Edit 1st Inning Score";
        } else if (isSecondInning && data.innings.target > 0) {
            // Fallback for 2nd inning if previous_inning obj missing but target exists
            runs = data.innings.target - 1;
            wickets = 10; // Assumption or unknown
            oversStr = String(data.total_overs) + ".0"; // Assumption
            title.innerText = "Edit 1st Inning Score";
        } else {
            // 1st Inning - Bowling team score is 0
            runs = 0;
            wickets = 0;
            oversStr = "0.0";
            title.innerText = "Edit Bowling Team Score (Future?)";
        }
    }

    // Populate Inputs
    document.getElementById('adj_score').value = runs;
    document.getElementById('adj_wickets').value = wickets;
    document.getElementById('adj_overs').value = oversStr;

    modal.showModal();
};

window.adjustValue = function (fieldId, amount) {
    const el = document.getElementById(fieldId);
    if (!el) return;

    if (fieldId === 'adj_overs') {
        // Parse Overs Logic: 0.5 + 0.1 = 1.0
        let val = el.value || "0.0";
        if (!val.includes('.')) val += ".0";
        let parts = val.split('.');
        let ov = parseInt(parts[0]);
        let balls = parseInt(parts[1]);

        let totalBalls = (ov * 6) + balls;
        totalBalls += amount;

        if (totalBalls < 0) totalBalls = 0;

        let newOv = Math.floor(totalBalls / 6);
        let newBalls = totalBalls % 6;
        el.value = `${newOv}.${newBalls}`;
    } else {
        // Simple Int Adjustment
        let val = parseInt(el.value || 0);
        val += amount;
        if (fieldId === 'adj_wickets') {
            if (val < 0) val = 0;
            if (val > 10) val = 10;
        }
        if (val < 0 && fieldId !== 'adj_score') val = 0; // Score allows negative? Maybe penalty.
        el.value = val;
    }
};

window.submitScoreOverride = async function () {
    const runs = parseInt(document.getElementById('adj_score').value);
    const wickets = parseInt(document.getElementById('adj_wickets').value);
    const overs = document.getElementById('adj_overs').value;

    if (isNaN(runs) || isNaN(wickets)) return alert("Invalid values");

    // Determine which inning to target
    const data = window.currentMatchData;
    const currentInn = data.innings.current_inning;
    let targetInning = currentInn;

    // Logic: If we are in 2nd inning and editing the bowling team (who batted 1st), 
    // we are targeting Inning 1.
    if (window.editingTeamRole !== 'batting' && currentInn === 2) {
        targetInning = 1;
    }

    // Call API
    try {
        const payload = {
            inning: targetInning,
            target_runs: runs,
            target_wickets: wickets,
            target_overs: overs
        };

        const response = await fetch(`${API_URL}/matches/${MATCH_ID}/update_score`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const res = await response.json();
        if (res.error) {
            alert("Error: " + res.error);
        } else {
            document.getElementById('scoreOverrideModal').close();
            refreshUI(res);
            alert("Score Updated Successfully!");
        }
    } catch (e) {
        console.error(e);
        alert("Request failed");
    }
};

export function bootstrap() {
    console.log("Bootstrap: Fetching initial data...");
    setupColorPickers(); // Initialize listeners
    if (!MATCH_ID) return alert("Missing Match ID in URL params");
    fetch(`${API_URL}/match_data?match_id=${MATCH_ID}`)
        .then(r => r.json())
        .then(data => {
            if (data.error) {
                console.error("Match Data Error:", data.error);
                alert(data.error);
            }
            else {
                console.log("Match Data Loaded:", data);
                refreshUI(data);
            }
        })
        .catch(e => {
            console.error("Bootstrap Error:", e);
            alert("Failed to load match data. See console.");
        });
}

// --- ENTER KEY SUPPORT FOR SQUAD SETTINGS ---
// Dynamically attach listeners on load
document.addEventListener('DOMContentLoaded', () => {
    // Select inputs by the class seen in index.html: class="quick-input"
    const squadInputs = document.querySelectorAll('.quick-input');

    squadInputs.forEach(input => {
        input.addEventListener('keypress', function (e) {
            if (e.key === 'Enter') {
                e.preventDefault(); // Stop any default form submission

                // 2. Find the "Add Player" button associated with THIS input.
                // In index.html: <input> is followed immediately by <button>
                const addBtn = this.nextElementSibling || this.parentElement.querySelector('button');

                if (addBtn) {
                    addBtn.click(); // Trigger the existing logic (quickAddPlayer)
                }
            }
        });
    });
});
