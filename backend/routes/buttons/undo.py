from fastapi import APIRouter
import database
# Common imports
from common import (
    fetch_match_state, swap_strikers, SimpleMatchRequest
)
# Import fetch_full_match_state from the sibling matches module
from routes.matches import fetch_full_match_state

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
                
                # --- 1. FETCH MATCH STATE (Required for checks below) ---
                match = await fetch_match_state(conn, match_id)
                if not match: 
                    return {"status": "error", "message": "Match not found"}

                # --- 2. CHECK: IS MATCH COMPLETED? (Unlock Logic) ---
                if match['status'] == 'completed':
                    await conn.execute("""
                        UPDATE matches 
                        SET status = 'live', result_message = NULL, winner_id = NULL 
                        WHERE id = $1
                    """, match_id)

                # --- 3. CHECK: UNDO INNING BREAK? (Back to 1st Inning) ---
                # Logic: If Inning 2 has started but 0 balls have been bowled in Inning 2 yet.
                if match.get('current_inning') == 2:
                    balls_in_inn_2 = await conn.fetchval("""
                        SELECT COUNT(*) FROM balls WHERE match_id = $1 AND inning_no = 2
                    """, match_id)
                    
                    if balls_in_inn_2 == 0:
                        # Restore Inning 1 Stats
                        inn1_stats = await conn.fetchrow("""
                            SELECT 
                                COALESCE(SUM(runs_off_bat + extras), 0) as runs,
                                COUNT(CASE WHEN is_wicket = TRUE THEN 1 END) as wickets,
                                COUNT(CASE WHEN extra_type IS NULL OR extra_type IN ('bye', 'leg-bye', 'wicket') THEN 1 END) as valid_balls
                            FROM balls WHERE match_id = $1 AND inning_no = 1
                        """, match_id)
                        
                        # Swap Teams Back
                        # Current Batting (Team B) becomes Bowling. Current Bowling (Team A) becomes Batting.
                        old_batting = match['team_name_batting'] 
                        old_bowling = match['team_name_bowling']
                        
                        # Restore Active Players from the very last ball of Inning 1
                        last_ball = await conn.fetchrow("""
                            SELECT striker_id, non_striker_id, bowler_id 
                            FROM balls WHERE match_id=$1 AND inning_no=1 
                            ORDER BY id DESC LIMIT 1
                        """, match_id)
                        
                        s_id = last_ball['striker_id'] if last_ball else None
                        ns_id = last_ball['non_striker_id'] if last_ball else None
                        b_id = last_ball['bowler_id'] if last_ball else None

                        await conn.execute("""
                            UPDATE matches 
                            SET current_inning = 1, target_score = 0,
                                team_name_batting = $1, team_name_bowling = $2,
                                team_score = $3, wickets = $4,
                                overs = $5, balls = $6,
                                current_striker_id = $7, non_striker_id = $8, current_bowler_id = $9
                            WHERE id = $10
                        """, old_bowling, old_batting, 
                             inn1_stats['runs'], inn1_stats['wickets'], 
                             inn1_stats['valid_balls'] // 6, inn1_stats['valid_balls'] % 6,
                             s_id, ns_id, b_id, match_id)

                        return {"status": "success", "message": "Reverted to 1st Inning", "data": await fetch_full_match_state(conn, match_id)}

                # --- 3.5. CHECK: JUST SELECTED BOWLER (New Over, 0 Balls) ---
                # Logic: If balls=0 for current over AND bowler is set -> Deselect Bowler
                current_balls = match['balls'] # Balls in current over (0-5)
                current_bowler_id = match['current_bowler_id']
                
                # We need to be careful: calculate TOTAL balls to ensure it's not the start of match (0.0) with NO bowler? 
                # Actually, at start of match (0.0), if bowler IS selected, we might want to undo that too?
                # The user requirement: "If I have just selected a new bowler for a new over... haven't bowled a ball yet"
                # This explicitly implies removing the bowler assignment.
                
                if current_balls == 0 and current_bowler_id is not None:
                     # Check if it's genuinely a "new over" state where we want to go back to "Select Bowler"
                     # If it is the VERY first over of an inning, we still want to allow deselecting the opening bowler.
                     
                     await conn.execute("UPDATE matches SET current_bowler_id = NULL WHERE id = $1", match_id)
                     
                     return {"status": "bowler_deselected", "message": "Bowler deselected", "data": await fetch_full_match_state(conn, match_id)}

                # --- 4. STANDARD UNDO (Delete Last Ball) ---
                # If we are here, it means we are undoing an actual ball (runs/wickets/etc)
                
                ball = await conn.fetchrow("""
                    SELECT * FROM balls WHERE match_id = $1 ORDER BY id DESC LIMIT 1
                """, match_id)
                
                if not ball:
                    return {"status": "error", "message": "No balls to undo"}
                
                ball_id = ball['id']
                striker_id = ball['striker_id']
                runs_bat = ball['runs_off_bat']
                extras = ball['extras']
                extra_type = ball['extra_type']
                is_wicket = ball['is_wicket']
                is_four = ball['is_four']
                is_six = ball['is_six']
                ball_no = ball['ball_no']
                action_type = ball['action_type']
                
                # Revert Match Score
                total_runs = runs_bat + extras
                if total_runs != 0:
                     await conn.execute("UPDATE matches SET team_score = team_score - $1 WHERE id = $2", total_runs, match_id)

                # Revert Match Balls/Overs
                is_legal_ball = True
                if action_type in ['wide', 'noball', 'penalty']:
                    is_legal_ball = False
                    
                # Refetch state to get accurate balls/overs before decrementing
                match_now = await fetch_match_state(conn, match_id)
                current_balls = match_now['balls']
                current_overs = match_now['overs']
                
                if is_legal_ball:
                    if current_balls > 0:
                        await conn.execute("UPDATE matches SET balls = balls - 1 WHERE id = $1", match_id)
                    else:
                        # Reverting an Over Change (e.g. 2.0 -> 1.5)
                        if ball_no == 6 and current_overs > 0:
                            await conn.execute("UPDATE matches SET overs = overs - 1, balls = 5 WHERE id = $1", match_id)
                            # Swap strikers back (because they swapped at over end)
                            await swap_strikers(conn, match_now, match_id) 

                # Revert Player Stats
                if action_type != 'penalty':
                    batter_balls_sub = 1 if is_legal_ball or action_type in ['noball', 'wicket'] or action_type in ['bye', 'leg-bye'] else 0
                    
                    if action_type == 'wide': batter_balls_sub = 0
                    elif action_type == 'noball': batter_balls_sub = 1
                    
                    if runs_bat > 0 or batter_balls_sub > 0:
                         await conn.execute("""
                            UPDATE players 
                            SET runs = runs - $1, balls = balls - $2
                            WHERE id = $3
                        """, runs_bat, batter_balls_sub, striker_id)
                    
                    if is_four:
                         await conn.execute("UPDATE players SET fours = fours - 1 WHERE id = $1", striker_id)
                    if is_six:
                         await conn.execute("UPDATE players SET sixes = sixes - 1 WHERE id = $1", striker_id)

                # Revert Wicket (Bring the dead player back!)
                if is_wicket:
                    player_out_id = striker_id 
                    wicket_info = await conn.fetchrow("SELECT player_out_id FROM wickets WHERE ball_id = $1", ball_id)
                    if wicket_info:
                         player_out_id = wicket_info['player_out_id']
                    
                    # 1. Mark player as NOT OUT
                    await conn.execute("UPDATE players SET is_out = FALSE WHERE id = $1", player_out_id)
                    # 2. Reduce wicket count
                    await conn.execute("UPDATE matches SET wickets = wickets - 1 WHERE id = $1", match_id)
                    
                    # 3. Put player back on crease (This overwrites whoever came in next!)
                    if player_out_id == striker_id:
                         await conn.execute("UPDATE matches SET current_striker_id = $1 WHERE id = $2", player_out_id, match_id)
                    else:
                         await conn.execute("UPDATE matches SET non_striker_id = $1 WHERE id = $2", player_out_id, match_id)

                    await conn.execute("DELETE FROM wickets WHERE ball_id = $1", ball_id)

                # Revert Swap (Run based)
                must_swap = False
                if action_type != 'penalty':
                    run_check = runs_bat
                    if action_type in ['bye', 'leg-bye']: run_check = extras
                    if action_type == 'noball': run_check = int(runs_bat)
                    
                    if run_check % 2 != 0:
                        must_swap = True
                
                if must_swap:
                     await swap_strikers(conn, match_now, match_id) 

                # Finally: Delete the Ball Record
                await conn.execute("DELETE FROM balls WHERE id = $1", ball_id)
                
                # --- SMART UNDO RESTORATION ---
                # Check A: If we had NO bowler selected (e.g. we undid the selection previously/undoing across over boundary)
                # Check B: Or if the user explicitly wants to ensure the cached bowler is always correct based on history.
                # Use Case: Undo 1.0 -> 0.5. We need to fetch the bowler of 0.5 to set as current.
                
                if match['current_bowler_id'] is None:
                     # Fetch the NEW last ball (the one exposed after deletion)
                     restored_ball = await conn.fetchrow("""
                        SELECT bowler_id FROM balls WHERE match_id = $1 ORDER BY id DESC LIMIT 1
                     """, match_id)
                     
                     if restored_ball and restored_ball['bowler_id']:
                         await conn.execute("UPDATE matches SET current_bowler_id = $1 WHERE id = $2", 
                                            restored_ball['bowler_id'], match_id)
                
                return {"status": "success", "message": f"Undid ball {ball_id}", "data": await fetch_full_match_state(conn, match_id)}
                
    except Exception as e:
        print(f"Undo Error: {e}")
        return {"status": "error", "message": str(e)}