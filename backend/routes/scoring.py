from fastapi import APIRouter
import database
from common import (
    fetch_match_state, build_match_response, fetch_player, swap_strikers, check_over_completion,
    SimpleMatchRequest, ScoreUpdate, NewBatsmanRequest, EndMatchRequest
)
from .matches import fetch_full_match_state



# ... existing imports ...
# ADD THIS LINE:
from sse_manager import manager

router = APIRouter()

@router.post("/end_inning")
async def end_inning(payload: SimpleMatchRequest):
    try:
        async with database.db_pool.acquire() as conn:
            async with conn.transaction():
                match_id = payload.match_id
                match = await fetch_match_state(conn, match_id)
                if not match: return {"status": "error", "message": "Match not found"}
                
                # 1. Calculate Target
                first_inn_score = match['team_score']
                target = first_inn_score + 1
                
                # 2. Swap Teams (Names & IDs)
                old_batting = match['team_name_batting']
                old_bowling = match['team_name_bowling']
                
                # Fetch IDs 
                old_batting_id = match['batting_team_id']
                old_bowling_id = match['bowling_team_id']
                
                new_batting = old_bowling
                new_bowling = old_batting
                
                new_batting_id = old_bowling_id
                new_bowling_id = old_batting_id
                
                # 3. Reset for Inning 2
                await conn.execute("""
                    UPDATE matches 
                    SET 
                        current_inning = 2,
                        target_score = $1,
                        team_name_batting = $2,
                        team_name_bowling = $3,
                        batting_team_id = $5,
                        bowling_team_id = $6,
                        team_score = 0,
                        wickets = 0,
                        overs = 0, 
                        balls = 0,
                        current_striker_id = NULL,
                        non_striker_id = NULL,
                        current_bowler_id = NULL
                    WHERE id = $4
                """, target, new_batting, new_bowling, match_id, new_batting_id, new_bowling_id)
                
                # --- INSERT THIS BLOCK BEFORE RETURN ---
                # Fetch state to show the target immediately to viewers
                full_state = await fetch_full_match_state(conn, match_id)
                await manager.broadcast(match_id, full_state)
                # ---------------------------------------

                return {
                    "status": "inning_break",
                    "target": target,
                    "new_batting_team": new_batting,
                    "message": f"Innings Break! Target set: {target} runs"
                }

    except Exception as e:
        print(f"Error ending inning: {e}")
        return {"status": "error", "message": str(e)}



@router.post("/update_score")
async def update_score(payload: ScoreUpdate):
    try:
        async with database.db_pool.acquire() as conn:
            async with conn.transaction():
                match_id = payload.match_id
                match = await fetch_match_state(conn, match_id)
                if not match: return {"status": "error", "message": "Match not found"}
                
                striker_id = match['current_striker_id']
                non_striker_id = match['non_striker_id']
                bowler_id = match['current_bowler_id']
                
                striker_row = await fetch_player(conn, striker_id)
                striker_out_name = striker_row['name'] if striker_row else "Unknown"
                
                action = payload.action
                
                try: value = int(payload.value)
                except: value = 0
                
                wicket_type = str(payload.value) if action == 'wicket' else None
                if payload.type: wicket_type = payload.type
                
                is_legal_ball = True
                runs_batsman = 0
                runs_extras = 0
                is_wicket = (action == 'wicket')
                
                if action in ['run', 'boundary']: runs_batsman = value
                elif action == 'wide': runs_extras = 1 + value; is_legal_ball = False
                elif action == 'noball': runs_batsman = value; runs_extras = 1; is_legal_ball = False
                elif action in ['bye', 'leg-bye']: runs_extras = value; is_legal_ball = True
                elif action == 'penalty': runs_extras = value; is_legal_ball = False
                
                ball_increment = 0
                if is_legal_ball and action != 'penalty': ball_increment = 1
                
                current_over = match['overs']
                current_ball = match['balls'] + ball_increment
                
                extra_type = action if action in ['wide', 'noball', 'bye', 'leg-bye'] else None
                is_boundary_4 = (runs_batsman == 4)
                is_boundary_6 = (runs_batsman == 6)
                if payload.type == 'boundary':
                    if runs_batsman == 4: is_boundary_4 = True
                    if runs_batsman == 6: is_boundary_6 = True
                
                ball_id = await conn.fetchval("""
                    INSERT INTO balls (
                        match_id, inning_no, over_no, ball_no, 
                        striker_id, non_striker_id, bowler_id, 
                        runs_off_bat, extras, is_wicket, action_type,
                        extra_type, is_four, is_six, wicket_type
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
                    RETURNING id
                """, match_id, match.get('current_inning', 1), current_over, current_ball, 
                   striker_id, non_striker_id, bowler_id,
                   runs_batsman, runs_extras, is_wicket, action,
                   extra_type, is_boundary_4, is_boundary_6, wicket_type
                )
                
                total_runs = runs_batsman + runs_extras
                if total_runs != 0:
                    await conn.execute("UPDATE matches SET team_score = team_score + $1 WHERE id = $2", total_runs, match_id)
                
                if ball_increment > 0:
                    await conn.execute("UPDATE matches SET balls = balls + 1 WHERE id = $1", match_id)

                if action != 'penalty': 
                    batter_balls_add = 0
                    if is_legal_ball or action in ['noball', 'wicket']: batter_balls_add = 1
                    if action in ['bye', 'leg-bye']: batter_balls_add = 1
                    
                    if runs_batsman > 0 or batter_balls_add > 0:
                         await conn.execute("UPDATE players SET runs=runs+$1, balls=balls+$2 WHERE id=$3", runs_batsman, batter_balls_add, striker_id)
                         if is_boundary_4: await conn.execute("UPDATE players SET fours=fours+1 WHERE id=$1", striker_id)
                         if is_boundary_6: await conn.execute("UPDATE players SET sixes=sixes+1 WHERE id=$1", striker_id)

                if is_wicket:
                    current_wickets = match['wickets'] + 1
                    score_str = f"{match['team_score'] + total_runs}/{current_wickets}"
                    await conn.execute("INSERT INTO wickets (ball_id, player_out_id, wicket_type, score_at_dismissal) VALUES ($1, $2, $3, $4)", ball_id, striker_id, wicket_type, score_str)
                    await conn.execute("UPDATE matches SET wickets = wickets + 1 WHERE id = $1", match_id)
                    await conn.execute("UPDATE players SET is_out = TRUE WHERE id = $1", striker_id)
                    
                    # CRITICAL FIX: Vacate the crease
                    if striker_id == match['current_striker_id']:
                        await conn.execute("UPDATE matches SET current_striker_id = NULL WHERE id = $1", match_id)
                    elif striker_id == match['non_striker_id']:
                        await conn.execute("UPDATE matches SET non_striker_id = NULL WHERE id = $1", match_id)

                    if current_wickets >= 10: return {"status": "innings_over", "message": "All Out!", "data": await fetch_full_match_state(conn, match_id)}
                    return {"status": "wicket_fall", "out_player": striker_out_name, "data": await fetch_full_match_state(conn, match_id)}

                must_swap = False
                if action != 'penalty':
                    run_check = runs_batsman
                    if action in ['bye', 'leg-bye']: run_check = runs_extras
                    if action == 'noball': run_check = int(value)
                    if run_check % 2 != 0: must_swap = True
                
                if must_swap: await swap_strikers(conn, match, match_id)

                fresh_match = await fetch_match_state(conn, match_id)
                await check_over_completion(conn, fresh_match, match_id)
            # --- REPLACE THE FINAL RETURN WITH THIS BLOCK ---
            
            # 1. Fetch the fresh full state
            full_state = await fetch_full_match_state(conn, match_id)
            
            # 2. 🔥 BROADCAST TO SSE LISTENERS 🔥
            # This pushes the data to everyone watching (0.01s latency)
            await manager.broadcast(match_id, full_state)

            if fresh_match['balls'] >= 6 or (match['overs'] != fresh_match['overs']):
                 # Auto-unset bowler logic (keep existing)
                 await conn.execute("UPDATE matches SET current_bowler_id = NULL WHERE id = $1", match_id)
                 return {"status": "over_complete", "message": "Over Complete", "data": full_state}

            return {"status": "success", "data": full_state}
    except Exception as e:
        print(f"Error: {e}")
        return {"status": "error", "message": str(e)}

@router.post("/set_new_batsman")
async def set_new_batsman(payload: NewBatsmanRequest):
    try:
        async with database.db_pool.acquire() as conn:
            match_id = payload.match_id
            column = "current_striker_id"
            if payload.role == 'non_striker':
                column = "non_striker_id"
                
            await conn.execute(f"UPDATE matches SET {column} = $1 WHERE id = $2", payload.new_player_id, match_id)
            return await fetch_full_match_state(conn, match_id)
    except Exception as e:
        print(f"Error setting batsman: {e}")
        return {"error": str(e)}

@router.post("/set_bowler")
async def set_bowler(payload: NewBatsmanRequest):
    try:
        async with database.db_pool.acquire() as conn:
            match_id = payload.match_id
            await conn.execute("""
                UPDATE matches 
                SET current_bowler_id = $1 
                WHERE id = $2
            """, payload.new_player_id, match_id)

            return await fetch_full_match_state(conn, match_id)
    except Exception as e:
        print(f"Error setting bowler: {e}")
        return {"error": str(e)}

@router.post("/end_match")
async def end_match(payload: EndMatchRequest):
    try:
        async with database.db_pool.acquire() as conn:
            async with conn.transaction():
                match_id = payload.match_id
                
                # 1. Fetch Request Data
                match = await fetch_match_state(conn, match_id)
                if not match: return {"status": "error", "message": "Match not found"}

                team_score = match.get('team_score', 0)
                wickets = match.get('wickets', 0)
                target_score = match.get('target_score') 
                target_score = int(target_score) if target_score is not None else 0
                
                total_overs = match.get('total_overs', 0)
                overs = match.get('overs', 0)
                balls = match.get('balls', 0)
                
                batting_team_id = match.get('team_batting_id')
                bowling_team_id = match.get('team_bowling_id')
                team_name_batting = match.get('team_name_batting')
                team_name_bowling = match.get('team_name_bowling')

                # Re-calculate IDs if missing (backup)
                if not batting_team_id or not bowling_team_id:
                     # This logic relies on build_match_response commonly, but here we iterate
                     # If we are in inning 2, we can infer from Toss if available, or just use existing columns if valid
                     # Note: match['team_batting_id'] might not exist as a column, it's dynamic?
                     # Step 144: fetch_match_state returns RAW ROW.
                     # Matches table usually has team_name_batting/bowling but maybe not IDs directly?
                     # Let's trust logic Step 144: lines 163-185 calculate it dynamically.
                     # We must replicate that or fetch it properly.
                     batting_team_id = None
                     bowling_team_id = None
                     if match.get('toss_winner_id'):
                        winner_id = match['toss_winner_id']
                        loser_id = match['team_b_id'] if winner_id == match['team_a_id'] else match['team_a_id']
                        first_bat = winner_id if match['toss_decision'] == 'bat' else loser_id
                        first_bowl = loser_id if match['toss_decision'] == 'bat' else winner_id
                        
                        if match.get('current_inning', 1) == 2:
                            batting_team_id = first_bowl
                            bowling_team_id = first_bat
                        else:
                            batting_team_id = first_bat
                            bowling_team_id = first_bowl

                # 2. Calculate Valid Balls
                total_balls_limit = total_overs * 6
                current_balls = (overs * 6) + balls

                # 3. Determine Winner (Referee Logic)
                winner_id = None
                result_message = "Match Ended Manually"

                # Condition A: Batting Win
                if team_score >= target_score and target_score > 0:
                    winner_id = batting_team_id
                    result_message = f"{team_name_batting} won by {10 - wickets} wickets"
                
                # Condition B: Bowling Win (Overs finished AND Score < Target-1)
                elif (current_balls >= total_balls_limit or wickets >= 10) and team_score < (target_score - 1):
                    # Note: target_score > 0 usually for 2nd inning
                    winner_id = bowling_team_id
                    runs_needed = (target_score - 1) - team_score # Or just Target - Score - 1 ?
                    # User: "{Bowling Team} won by {target_score - team_score - 1} runs"
                    margin = target_score - team_score - 1
                    result_message = f"{team_name_bowling} won by {margin} runs"

                # Condition C: Tie
                elif (current_balls >= total_balls_limit or wickets >= 10) and team_score == (target_score - 1):
                     winner_id = None
                     result_message = "Match Tied"
                
                # Manual Override
                if payload.forced_winner_id is not None:
                     winner_id = payload.forced_winner_id
                     result_message = "Match Awarded Manually"

                # 4. DB Update
                await conn.execute("""
                    UPDATE matches 
                    SET status = 'completed', 
                        winner_id = $1, 
                        result_message = $2 
                    WHERE id = $3
                """, winner_id, result_message, match_id)
                
                return {
                    "status": "success", 
                    "result": result_message, 
                    "winner_id": winner_id
                }
                
    except Exception as e:
        print(f"Error ending match: {e}")
        return {"status": "error", "message": str(e)}
