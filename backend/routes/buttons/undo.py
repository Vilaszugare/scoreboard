from fastapi import APIRouter
import database
from common import (
    fetch_match_state, swap_strikers, SimpleMatchRequest
)
from routes.matches import fetch_full_match_state
from sse_manager import manager

router = APIRouter()

@router.post("/matches/{match_id}/undo_last_ball")
async def undo_last_ball(match_id: int):
    # Wrapper for the detailed logic, allows calling via ID in URL
    dummy_payload = SimpleMatchRequest(match_id=match_id)
    return await undo_last_action(dummy_payload)

@router.post("/undo_last_action")
async def undo_last_action(payload: SimpleMatchRequest):
    try:
        async with database.db_pool.acquire() as conn:
            async with conn.transaction():
                match_id = payload.match_id
                
                # 1. FETCH LATEST EVENT
                last_event = await conn.fetchrow("""
                    SELECT id, event_type, event_id 
                    FROM match_events 
                    WHERE match_id = $1 
                    ORDER BY id DESC LIMIT 1
                """, match_id)

                if not last_event:
                    # Fallback logic could go here if needed, but per plan if no events, no undo.
                    return {"status": "error", "message": "No actions to undo"}

                event_type = last_event['event_type']
                event_row_id = last_event['id']
                target_id = last_event['event_id']

                print(f"UNDO: Found event {event_type} (ID: {target_id})")

                # ==========================================
                # CASE A: UNDO A BALL
                # ==========================================
                if event_type == 'BALL':
                    # 1. Fetch Key Data Before Deletion
                    ball = await conn.fetchrow("""
                        SELECT * FROM balls WHERE id = $1
                    """, target_id)
                    
                    if not ball:
                         # Ball already gone? Just clean event.
                         await conn.execute("DELETE FROM match_events WHERE id = $1", event_row_id)
                         return {"status": "error", "message": "Ball record missing"}

                    runs = ball['runs_off_bat']
                    extras = ball['extras']
                    striker_id = ball['striker_id']
                    
                    # 2. Revert Scores (Matches Table)
                    total_runs = runs + extras
                    ball_deduct = 0
                    if (ball['extras'] == 0) or (ball['action_type'] in ['wicket', 'bye', 'leg-bye']):
                        ball_deduct = 1
                    if ball['action_type'] == 'noball':
                         ball_deduct = 0 # No balls don't count
                        
                    await conn.execute("""
                        UPDATE matches 
                        SET team_score = team_score - $1,
                            balls = balls - $2,
                            wickets = CASE WHEN $3 THEN wickets - 1 ELSE wickets END
                        WHERE id = $4
                    """, total_runs, ball_deduct, ball['is_wicket'], match_id)
                    
                    # 3. Revert Player Stats
                    is_legal = (ball['extras'] == 0)
                    batter_balls = 0
                    if is_legal or ball['action_type'] in ['noball', 'wicket', 'bye', 'leg-bye']:
                        batter_balls = 1
                    
                    # Wide balls don't count for batter balls
                    if ball['action_type'] == 'wide': batter_balls = 0

                    await conn.execute("UPDATE players SET runs = runs - $1, balls = balls - $2 WHERE id = $3", runs, batter_balls, striker_id)
                    
                    if ball['is_four']: await conn.execute("UPDATE players SET fours = fours - 1 WHERE id = $1", striker_id)
                    if ball['is_six']: await conn.execute("UPDATE players SET sixes = sixes - 1 WHERE id = $1", striker_id)
                    
                    # Wicket Undo
                    if ball['is_wicket']:
                        await conn.execute("UPDATE players SET is_out = FALSE WHERE id = $1", ball['player_out_id'])
                        await conn.execute("DELETE FROM wickets WHERE ball_id = $1", target_id)
                        
                        # Correctly restore striker/non-striker slots
                        matches_row = await conn.fetchrow("SELECT current_striker_id, non_striker_id FROM matches WHERE id = $1", match_id)
                        if not matches_row['current_striker_id']:
                             await conn.execute("UPDATE matches SET current_striker_id = $1 WHERE id = $2", ball['striker_id'], match_id)
                        elif matches_row['current_striker_id'] and not matches_row['non_striker_id']:
                             if ball['player_out_id'] != matches_row['current_striker_id']:
                                 await conn.execute("UPDATE matches SET non_striker_id = $1 WHERE id = $2", ball['player_out_id'], match_id)

                    # 4. DELETE THE BALL & EVENT
                    await conn.execute("DELETE FROM balls WHERE id = $1", target_id)
                    await conn.execute("DELETE FROM match_events WHERE id = $1", event_row_id)
                    
                    # Check for over boundary crossing? (e.g. 2.1 -> 2.0 -> 1.5)
                    # If we reverted valid balls, we might need to decrement overs if balls became negative/wrapped?
                    # logic: balls - ball_deduct. If existing balls=0 and ball_deduct=1 -> balls=-1.
                    # We rely on previous logic: if balls < 0 -> overs-1, balls=5.
                    
                    fresh_match = await fetch_match_state(conn, match_id)
                    if fresh_match['balls'] < 0: 
                        await conn.execute("UPDATE matches SET overs = overs - 1, balls = 5 WHERE id = $1", match_id)
                        # Swap back strikers too if they swapped at over end?
                        await swap_strikers(conn, fresh_match, match_id)
                
                # ==========================================
                # CASE B: UNDO PLAYER SELECTION (Bowler)
                # ==========================================
                elif event_type == 'NEW_BOWLER':
                    await conn.execute("UPDATE matches SET current_bowler_id = NULL WHERE id = $1", match_id)
                    await conn.execute("DELETE FROM match_events WHERE id = $1", event_row_id)

                # ==========================================
                # CASE C: UNDO PLAYER SELECTION (Batter)
                # ==========================================
                elif event_type == 'NEW_BATTER':
                    # Determine slot
                    row = await conn.fetchrow("SELECT current_striker_id, non_striker_id FROM matches WHERE id=$1", match_id)
                    
                    if row['current_striker_id'] == target_id:
                        await conn.execute("UPDATE matches SET current_striker_id = NULL WHERE id = $1", match_id)
                    elif row['non_striker_id'] == target_id:
                        await conn.execute("UPDATE matches SET non_striker_id = NULL WHERE id = $1", match_id)
                    
                    await conn.execute("UPDATE players SET is_batted = FALSE WHERE id = $1", target_id)
                    await conn.execute("DELETE FROM match_events WHERE id = $1", event_row_id)

                # 5. Broadcast Update
                full_state = await fetch_full_match_state(conn, match_id)
                await manager.broadcast(match_id, full_state)
                
                return {"status": "success", "message": "Undo Successful", "data": full_state}

    except Exception as e:
        import traceback
        traceback.print_exc()
        return {"status": "error", "message": str(e)}