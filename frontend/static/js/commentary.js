import { API_URL, MATCH_ID } from './config.js';

let currentCommInning = 1;

export async function fetchAndRenderCommentary(inning) {
    if (!MATCH_ID) return;
    currentCommInning = inning;

    // Update Tabs UI
    document.querySelectorAll('.comm-tab').forEach(btn => btn.classList.remove('active'));
    const activeBtn = document.getElementById(`btnCommInn${inning}`);
    if (activeBtn) activeBtn.classList.add('active');

    const container = document.getElementById('commTimeline');
    if (!container) return;

    // container.innerHTML = '<div style="text-align:center;color:#888;padding:20px;">Refreshing...</div>';
    // Don't clear immediately to avoid flicker, maybe just spinner overlays?
    // For now simple reload.

    try {
        const res = await fetch(`${API_URL}/match/${MATCH_ID}/commentary?inning=${inning}`);
        if (!res.ok) throw new Error("Failed to fetch commentary");

        const data = await res.json();
        renderTimeline(data.timeline, container);

    } catch (e) {
        console.error(e);
        container.innerHTML = `<div style="text-align:center;color:#coral;padding:20px;">Error loading data.<br><br><button class="btn-change-xs" onclick="window.switchCommInning(${inning})">Retry</button></div>`;
    }
}

function renderTimeline(events, container) {
    if (!events || events.length === 0) {
        container.innerHTML = '<div style="text-align:center;color:#888;padding:20px;">No commentary data yet.</div>';
        return;
    }

    let html = '';

    events.forEach(ev => {
        if (ev.type === 'over_summary') {
            html += `
            <div class="comm-over-summary">
                <div>End of over: ${ev.over_number}</div>
                <div class="comm-summary-text">
                    ${ev.runs} Runs | ${ev.score_runs}/${ev.score_wickets} | CRR: ${ev.crr}
                </div>
            </div>`;
        } else if (ev.type === 'ball') {
            const ballNum = `${ev.over}.${ev.ball}`;

            // Determine Badge Style
            let badgeClass = 'dot';
            let badgeText = ev.runs_bat; // Default

            if (ev.is_wicket) {
                badgeClass = 'wicket';
                badgeText = 'W';
            } else if (ev.runs_bat === 4) {
                badgeClass = 'four';
                badgeText = '4';
            } else if (ev.runs_bat === 6) {
                badgeClass = 'six';
                badgeText = '6';
            } else if (ev.extras > 0) {
                badgeClass = 'extra';
                // Wd, Nb, Lb
                if (ev.extra_type) {
                    badgeText = ev.extra_type.substring(0, 2).toUpperCase();
                    // If runs were scored too (e.g. 1wd + 1 run), show total?
                    // Backend logic handles pure extras usually.
                } else {
                    badgeText = "Ex";
                }
            } else if (ev.runs_bat > 0) {
                badgeClass = 'dot'; // Or green?
                badgeText = ev.runs_bat;
            }

            // Highlight Text
            let text = ev.commentary;
            if (ev.is_wicket) {
                text = `<span class="comm-wicket-highlight">${text}</span>`;
            } else if (ev.runs_bat === 4 || ev.runs_bat === 6) {
                text = `<strong>${text}</strong>`;
            }

            html += `
            <div class="comm-ball-row">
                <div class="comm-ball-meta">
                    <div class="comm-ball-badge ${badgeClass}">${badgeText}</div>
                    <span>${ballNum}</span>
                </div>
                <div class="comm-text">
                    ${text}
                </div>
            </div>`;
        }
    });

    container.innerHTML = html;
}

// Expose to window
window.switchCommInning = function (inning) {
    fetchAndRenderCommentary(inning);
};

// Initial load helper
export function initCommentary() {
    // Maybe load default inning?
    // We wait for user to click tab, OR if tab is already active (reload).
    const panel = document.getElementById('commentaryPanel');
    if (panel && panel.style.display !== 'none') {
        fetchAndRenderCommentary(1); // Default to 1st inning or check match state?
    }
}
