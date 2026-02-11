# SSE Optimization Plan for Project B

## 1. The Audit (Current State)
*   **Analysis:** I scanned `frontend/static/js/scorer.js` and found **zero** polling loops. The core scoring logic is event-driven.
*   **Found Polling:** The "safety net" polling loop was found in `frontend/static/js/main.js` (Lines 24-37).
    ```javascript
    pollingInterval = setInterval(async () => { ... }, 30000);
    ```
*   **The Problem:** Even though it runs only every 30s, this loop keeps the radio active on mobile devices, consuming battery. Removing it makes the app truly "Zero-Load" when idle.

## 2. The Solution (Backend Verification)
*   **Status:** ✅ **Already Implemented**
*   The backend (`backend/main.py`) already has the specific streaming endpoint requested:
    ```python
    @app.get("/api/stream/{match_id}")
    ```
*   The `scoring.py` route already uses `manager.broadcast` to push updates instantly. **No changes are needed on the Backend.**

## 3. The Implementation Plan (Refactoring Project B)

### Step 1: Remove Legacy Polling
We will modify `frontend/static/js/main.js` to delete the `setInterval` block.

**File:** `frontend/static/js/main.js`
```javascript
// [DELETE THIS BLOCK]
// if (pollingInterval) clearInterval(pollingInterval);
// pollingInterval = setInterval(async () => { ... }, 30000);
```

### Step 2: Verify & Enhance SSE Connection
The SSE connection is currently in `frontend/static/js/api.js`. We will verify it handles updates correctly.

*   **Current Code:** existing `initLiveScore` function.
*   **Enhancement:** Ensure it handles the `onmessage` event to update the DOM logic (Runs, Wickets, Overs) instantly. The current implementation already imports `refreshUI` dynamically:
    ```javascript
    import('./ui.js').then(ui => {
        if (ui.refreshUI) ui.refreshUI(data);
    });
    ```
    *This is already optimal.*

## 4. Stability Check (Reconnection Logic)
The browser's `EventSource` has built-in reconnection. However, to be robust against "screen off" scenarios (where the browser might kill the socket but not restart it), we can add an explicit visibility listener.

**New Code for `frontend/static/js/api.js`:**
```javascript
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
        // Force reconnect if closed
        if (!eventSource || eventSource.readyState === EventSource.CLOSED) {
            console.log("📱 App Foregrounded: Reconnecting Stream...");
            initLiveScore(MATCH_ID);
        }
    }
});
```

## Summary of Changes
1.  **DELETE** polling loop in `main.js`.
2.  **ADD** visibility listener in `api.js` for robust mobile support.
3.  **KEEP** existing Backend SSE logic (it works perfectly).

---
**Ready to execute?** I can apply these changes now.
