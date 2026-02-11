# Deep Dive Technical Architecture Report

## 1. Technology Stack & Implementation Map

### **FastAPI Usage**
*   **Main Application Instance:**  
    Defined in `backend/main.py` as `app = FastAPI(lifespan=lifespan)`. This is the entry point for the ASDGI server (Uvicorn).
*   **Key Route Files:**
    *   `backend/routes/matches.py`: Handles match fetching, state calculation (`fetch_full_match_state`), and basic match operations.
    *   `backend/routes/scoring.py`: The "engine" of the app. Handles ball-by-ball updates (`update_score`), wicket processing, and broadcasting updates via SSE.
    *   `backend/routes/teams.py`: Manages team creation, logo uploads, and player lists.
    *   `backend/routes/match_settings_routes.py`: Handles "Smart Toss" and match configuration updates.

### **Database Interaction**
*   **Driver:** `asyncpg` (Asynchronous PostgreSQL driver).
*   **Connection Pool:**  
    Created in `backend/database.py` inside the `init_db()` function using `asyncpg.create_pool()`.
    *   **Lifecycle:** The pool is initialized on startup and closed on shutdown via the `lifespan` context manager in `backend/main.py`.
*   **Query Execution:**  
    Queries are executed using `async with database.db_pool.acquire() as conn:` blocks throughout the route files.

### **Frontend-Backend Bridge**
*   The frontend communicates with the backend primarily through `fetch()` calls located in `frontend/static/js/api.js`.
*   **Example Cycle: "Scoring a Run"**
    1.  **User Action:** Scorer clicks a button (e.g., "1 Run") in the HTML interface.
    2.  **JS Function:** `updateScore('run', 1)` is called in `frontend/static/js/api.js`.
    3.  **API Call:** JS performs a `POST` request to `/api/update_score` with a JSON payload (`{match_id: 123, action: 'run', value: 1}`).
    4.  **Backend Route:** `backend/routes/scoring.py` receives the request.
    5.  **DB Query:** The backend executes an `INSERT INTO balls` and `UPDATE matches SET team_score ...` inside a transaction.
    6.  **Real-time Update:** The backend calls `manager.broadcast(match_id, state)`, pushing the new score to all clients via SSE.

---

## 2. Real-Time Logic Analysis (SSE vs. Polling)

### **Verdict: SSE (Server-Sent Events)**

This project definitively uses **Server-Sent Events (SSE)** for real-time updates. While the folder name "polling12" suggests a legacy approach, the code proves otherwise.

### **Evidence:**
1.  **Backend Stream Endpoint:**  
    `backend/main.py` defines the SSE endpoint:
    ```python
    @app.get("/api/stream/{match_id}")
    async def stream_match_data(match_id: int):
        return StreamingResponse(event_generator(), media_type="text/event-stream")
    ```
2.  **Frontend Connection:**  
    `frontend/static/js/api.js` connects to this stream:
    ```javascript
    eventSource = new EventSource(`${API_URL}/stream/${matchId}`);
    eventSource.onmessage = function (event) { ... }
    ```
3.  **Broadcasting:**  
    In `backend/routes/scoring.py`, every score update triggers a broadcast:
    ```python
    await manager.broadcast(match_id, full_state)
    ```

*Note: There is a fallback "Safety Poll" in `frontend/static/js/main.js` that runs every 30 seconds (`setInterval`), but the primary engine is SSE.*

---

## 3. Critical Data Flow Tracing

### **Trace "Match Creation"**
1.  **JS Trigger:** The `createMatch` logic (likely in `modals.js` or `dashboard.html` script) gathers form data.
2.  **API Endpoint:** Sends `POST` request to `/api/matches` (Handled in `backend/routes/matches.py`).
3.  **SQL Execution:**
    ```sql
    INSERT INTO matches (
        team_a_id, team_b_id, batting_team_id, bowling_team_id, ...
    ) VALUES (...) RETURNING id
    ```

### **Trace "Scoring Update" (e.g., Wide Ball)**
1.  **JS Trigger:** Button click calls `updateScore('wide', 0)` in `api.js`.
2.  **API Endpoint:** `POST /api/update_score` in `backend/routes/scoring.py`.
3.  **Logic & SQL:**
    *   Calculates runs (1 run for wide).
    *   **SQL:** `INSERT INTO balls (..., extra_type='wide', ...)`
    *   **SQL:** `UPDATE matches SET team_score = team_score + 1 ...` (Note: `balls` count is NOT incremented for a wide).
    *   **SQL:** `UPDATE players ...` (adds runs/extras to stats).
4.  **Broadcast:** The new state is pushed to all listeners.

---

## 4. Code Quality & Refactoring Opportunities

### **Identify Repetition**
*   **Match State Logic:** The function `fetch_full_match_state` in `backend/routes/matches.py` is a massive monolith (approx. 400 lines). It handles fetching basic info, calculating stats, formatting the timeline, and managing adjustments. This logic is repeated/called by almost every route (`scoring.py`, `undo.py`, `matches.py`).
    *   *Recommendation:* Break this into smaller helper functions (`get_match_summary`, `get_ball_timeline`, `get_player_stats`).

### **Dead Code**
*   `verify_commentary.py`: Appears to be a standalone script not imported by the main app.
*   `add_adjustment_columns.py`: One-off migration script.
*   `frontend/static/js/edit_player.js`: If player editing is handled in modals, this file might be redundant.

### **Security Check**
*   **Tournament Isolation:** The `create_match` endpoint in `backend/routes/matches.py` **DOES NOT** currently accept or validate a `tournament_id`. It creates matches globally (or relies on default behavior).
    *   *Risk:* Any user could theoretically create a match without it being linked to a tournament, or see matches from other tournaments if the API doesn't strictly filter by `tournament_id`.

---

## 5. Database Schema Reconstruction

Based on `backend/routes/matches.py` and `backend/routes/scoring.py`, here is the reconstructed schema for the core tables.

### **Table: `matches`**
| Column | Type | Inferred Logic |
| :--- | :--- | :--- |
| `id` | `INT` | Primary Key |
| `team_a_id` | `INT` | Initial Home Team |
| `team_b_id` | `INT` | Initial Away Team |
| `batting_team_id` | `INT` | Currently Batting Team (Dynamic) |
| `bowling_team_id` | `INT` | Currently Bowling Team (Dynamic) |
| `current_inning` | `INT` | 1 or 2 |
| `team_score` | `INT` | Total runs |
| `wickets` | `INT` | Total wickets |
| `overs` | `INT` | Completed overs |
| `balls` | `INT` | Valid balls in current over |
| `total_overs` | `INT` | Match limit (e.g., 20) |
| `status` | `TEXT` | 'live', 'completed', 'scheduled' |
| `toss_winner_id` | `INT` | Team ID who won toss |
| `toss_decision` | `TEXT` | 'bat' or 'bowl' |
| `result_message` | `TEXT` | e.g., "Team A won by 10 runs" |

### **Table: `teams`**
| Column | Type | Inferred Logic |
| :--- | :--- | :--- |
| `id` | `INT` | Primary Key |
| `name` | `TEXT` | Full Name |
| `short_name` | `TEXT` | e.g., "IND", "AUS" |
| `logo` | `TEXT` | Path to logo file |
| `logo_url` | `TEXT` | Web-accessible URL |
| `team_color` | `TEXT` | Hex code (e.g., "#FF0000") |
