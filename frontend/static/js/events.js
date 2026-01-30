import { MENU_OPTIONS, ACTION_OPTIONS } from './config.js';
import { updateScore, undoLastAction, endInning } from './api.js';

export function isMatchReadyForScoring() {
    const data = window.currentMatchData; // Accessed from global state

    if (!data) {
        alert("Match data not loaded yet.");
        return false;
    }

    // 1. Check Batsmen
    // We assume data.current_batsmen is an array [striker, non_striker]
    const p1 = data.current_batsmen ? data.current_batsmen[0] : null;
    const p2 = data.current_batsmen ? data.current_batsmen[1] : null;

    // Helper to check if a player object is valid
    const isValid = (p) => p && p.id && p.name !== "Unknown";

    if (!isValid(p1)) {
        alert("⚠️ ACTION BLOCKED: Please select a STRIKER first.");
        // Optional: Highlight the missing box
        if (window.openPlayerSelection) window.openPlayerSelection('striker');
        return false;
    }

    if (!isValid(p2)) {
        alert("⚠️ ACTION BLOCKED: Please select a NON-STRIKER first.");
        if (window.openPlayerSelection) window.openPlayerSelection('non_striker');
        return false;
    }

    // 2. Check Bowler
    const bowler = data.current_bowler;
    if (!isValid(bowler)) {
        alert("⚠️ ACTION BLOCKED: Please select a BOWLER first.");
        if (window.showSelectBowlerModal) window.showSelectBowlerModal();
        return false;
    }

    return true; // All good!
}

export function showContextMenu(triggerBtn, typeOrRuns) {
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

export function closeContextMenu() {
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

export function initButtons() {
    console.log("Initializing Buttons...");

    // --- ROTATE STRIKE BUTTON ---
    console.log("Searching for #btn_rotate_strike...");
    const rotateBtn = document.getElementById('btn_rotate_strike');
    if (rotateBtn) {
        console.log("Found #btn_rotate_strike, checking if already initialized...");
        // Clone to remove old listeners if any
        const newRotateBtn = rotateBtn.cloneNode(true);
        rotateBtn.parentNode.replaceChild(newRotateBtn, rotateBtn);

        newRotateBtn.addEventListener('click', async () => {
            console.log("Rotating Strike...");
            newRotateBtn.classList.add('spinning');

            // Remove animation class after it plays (0.5s)
            setTimeout(() => newRotateBtn.classList.remove('spinning'), 500);

            try {
                // Dynamic import as requested
                const { rotateStrike } = await import('./api.js');
                const { MATCH_ID } = await import('./config.js');

                const res = await rotateStrike(MATCH_ID);
                console.log("Rotate Result:", res);

                // INSTANT UPDATE
                if (res) {
                    import('./ui.js').then(m => m.refreshUI(res));
                } else {
                    if (window.location.reload) window.location.reload();
                }
            } catch (e) {
                console.error("Rotate Failed:", e);
                alert("Failed to rotate strike");
            }
        });
    }

    const runBtns = document.querySelectorAll('.btn-run');
    runBtns.forEach(btn => {
        const newBtn = btn.cloneNode(true);
        btn.parentNode.replaceChild(newBtn, btn);

        newBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();

            if (window.currentMatchData && window.currentMatchData.status === 'completed') {
                alert("Match is completed. No more changes allowed.");
                return;
            }

            // 1. GATEKEEPER CHECK
            if (!isMatchReadyForScoring()) return;

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

            if (window.currentMatchData && window.currentMatchData.status === 'completed') {
                alert("Match is completed. No more changes allowed.");
                return;
            }

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

        // Safety check for all action buttons (including Smart Button if it somehow gets clicked inappropriately)
        // But wait, the Smart Button NEEDS to be clickable if status != completed but "isMatchOver" is true.
        // The check `window.currentMatchData.status === 'completed'` is correct because "Save Match" state happens BEFORE 'completed'.
        // When status IS 'completed', we want to block interaction.
        // However, we should inject the check inside the specific listeners or a global wrapper.
        // The user asked to put it "Inside the click listeners for btn-run and btn-action".

        // Logic for Smart Button (btn_end_inning) is handled separately in the block below effectively?
        // No, standard `.btn-action` loop handles it unless we special case it.
        // Ah, in previous step I added a special block `if (btn.id === 'btn_end_inning')`.
        // That block is INSIDE initButtons usually? 
        // Let's verify where `btn_end_inning` block is. It was added in Step 182.
        // It resides inside `initButtons`.
        // The `.forEach` loop for `actionButtons` CONTINUES after that block or returns?
        // In Step 182 I wrote `return;` inside the `if (btn.id === ...)` block.
        // So the loop `actionButtons.forEach` will skip initialization for `btn_end_inning` in the generic part?
        // Wait, `forEach` takes a callback. `return` just exits the callback for THAT element.
        // So yes, the generic listener below is NOT attached to `btn_end_inning`.
        // I need to add the safety check to `btn_end_inning` specific listener too if I want it consistent,
        // OR rely on `status === 'completed'` check in `refreshUI` disabling it.
        // But user said: "Update initButtons... Inside the click listeners for btn-run and btn-action"

        // I will add it to the generic listener here.
        // I should also check `btn_end_inning` block if I can access it here. 
        // Actually, I am replacing the GENERIC loop logic here. 
        // I need to locate the `btn_end_inning` block I added previously (via `replace_file_content` targeting lines).
        // `replace_file_content` operates on the file content. 
        // I will just modify the `runBtns` listener and the generic `actionButtons` listener.
        // I will NOT modify `btn_end_inning` listener in this `replace_file_content` unless I target it.
        // The user instruction: "Inside the click listeners for btn-run and btn-action".

        if (ACTION_OPTIONS[text]) {
            newBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();

                if (window.currentMatchData && window.currentMatchData.status === 'completed') {
                    alert("Match is completed. No more changes allowed.");
                    return;
                }

                // 1. GATEKEEPER CHECK
                if (!isMatchReadyForScoring()) return;

                showContextMenu(newBtn, text);
            });
            return;
        }

        // --- SMART BUTTON HANDLER ---
        // Checks dataset.action provided by refreshUI
        // Note: NewBtn listener is attached once, but dataset changes dynamically.
        // We use a generic handler that reads the CURRENT dataset.action

        // However, the original structure adds a listener for SPECIFIC text "End Inning".
        // That is BRITTLE if text changes.
        // Refactoring: Check if the button IS `#btn_end_inning` specifically.
        // The loop is over `.btn-action`. 
        if (btn.id === 'btn_end_inning') {
            newBtn.addEventListener('click', async () => {
                const action = newBtn.dataset.action;
                console.log("Main Button Clicked. Action:", action);

                if (action === "save_match") {
                    if (confirm("Match Finished! Save result and lock this match?")) {
                        // Dynamic Import to avoid circular dependencies if any
                        const { endMatch } = await import('./api.js');
                        // Assuming MATCH_ID is available globally or needs import. 
                        // MATCH_ID is not imported in events.js currently?
                        // Actually, events.js doesn't import MATCH_ID.
                        // But api.js uses it internally.
                        // Wait, endMatch(matchId) takes an arg.
                        // api.js usually has MATCH_ID from config.
                        // Let's import MATCH_ID from config here too to be safe, OR just let api.js handle it if it uses default.
                        // But api.js exports `endMatch` taking `matchId`.
                        // Let's grab it from config.js using dynamic import or assume the one in `api.js` is smart?
                        // api.js `endMatch` uses `matchId` arg content.
                        // I'll import variables at the top of events.js or use a dynamic import for config?
                        // Simpler: Just rely on the one in api.js? No, I need to pass it.
                        // Let's modify the file header to import MATCH_ID first.
                        // Actually, `active` document check showed events.js imports `MENU_OPTIONS`.
                        // I will add MATCH_ID to imports in a separate step or just assume global? No.
                        // I'll use `import('./config.js')` dynamically.
                        const { MATCH_ID } = await import('./config.js');

                        const res = await endMatch(MATCH_ID);
                        if (res.status === 'success') {
                            alert("Match Saved Successfully!");
                            location.reload();
                        } else {
                            alert("Error: " + res.message);
                        }
                    }
                } else if (action === "end_inning") {
                    if (confirm("Are you sure you want to End the 1st Inning?")) {
                        endInning();
                    }
                } else if (action === "end_match_force") {
                    // Optional handling if we ever show this
                    alert("Force End implementation pending.");
                }
            });
            return; // Skip the generic logic below
        }

        let action = '';
        let value = null;

        if (text === 'Bowled') { action = 'wicket'; value = 'bowled'; }
        else if (text === 'Caught') { action = 'wicket'; value = 'caught'; }
        else if (text === 'LBW') { action = 'wicket'; value = 'lbw'; }
        else if (text === 'Retired Out') { action = 'wicket'; value = 'retired'; }


        if (action) {
            newBtn.addEventListener('click', () => {
                // 1. GATEKEEPER CHECK
                if (!isMatchReadyForScoring()) return;

                closeContextMenu();
                updateScore(action, value);
            });
        }
    });
}
