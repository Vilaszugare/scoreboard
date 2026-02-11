# Bug Fix: Toss Update Logic

## Goal
Fix the bug where updating `toss_winner_id` automatically swaps the `batting_team_id` and `bowling_team_id`, disturbing the match state.
Ensure "Edit Match" only updates the Toss Details visually ("Team B elected to bat") without changing the actual batting team if the match is in progress.

## Proposed Changes

### 1. `backend/routes/matches.py` (Read Logic)
The `fetch_full_match_state` function currently recalculates `batting_team_id` based on `toss_winner` and `toss_decision`. This ignores the persistent DB state.

- **Modify SQL Query**: Ensure `m.batting_team_id` and `m.bowling_team_id` are selected.
- **Remove Calculation Logic**: Delete the block that swaps teams based on Toss.
- **Use DB Values**: Set `batting_team_id` directly from the DB record, defaulting to `team_a_id` / `team_b_id` only if null.

### 2. `backend/routes/match_settings_routes.py` (Write Logic)
The `update_match_settings` endpoint auto-calculates `toss_decision` based on the locked batting team. This forces "Team B elected to Bowl" when we want "Team B elected to Bat" (even if A is batting).

- **Modify Query**: Select `m.toss_decision` to get the current state.
- **Conditional Logic**:
    - IF `match_started`: Preserve existing `toss_decision`. Do NOT recalculate.
    - IF `!match_started`: Keep existing auto-calculation logic (allow full setup).
- **Update SQL**: Pass the resolved `toss_decision`.

## Verification Plan

### Manual Verification
1.  **Setup**: Create a match with Team A vs Team B.
2.  **Start Play**: Add some runs/balls so `current_inning` > 1 or `overs` > 0 (Match Started).
3.  **Check State**: Ensure Team A is batting.
4.  **Edit Toss**:
    -   Open "Edit Match".
    -   Change Toss Winner from A to B.
    -   Keep "Bat First" as A (since it's locked/disabled).
    -   Save.
5.  **Verify**:
    -   Refresh Match Page.
    -   Check "Toss Details" text: Should say "Team B elected to bat" (or whatever the previous decision was, but with B).
    -   **CRITICAL**: Check Scorecard/Batting Team. It MUST still be Team A.

### Automated Test (Script)
I will write a script `tests/test_toss_fix.py` to simulate this flow directly against the API / DB functions (since I can't browse).
