from fastapi import APIRouter, HTTPException, Query
import database
from pydantic import BaseModel
from typing import List, Optional

router = APIRouter()

class CommentaryBall(BaseModel):
    over: int
    ball: int
    runs: int
    extras: int
    extra_type: Optional[str] = None
    is_wicket: bool
    wicket_type: Optional[str] = None
    player_out_name: Optional[str] = None
    batter_name: str
    bowler_name: str
    commentary_text: str

class OverSummary(BaseModel):
    over_number: int
    runs_conceded: int
    wickets: int
    batting_team_score: int
    batting_team_wickets: int
    current_run_rate: float
    bowler_name: str
    
class CommentaryResponse(BaseModel):
    match_id: int
    inning: int
    events: List[dict] # Mixed list of balls and over summaries

@router.get("/match/{match_id}/commentary")
async def get_match_commentary(match_id: int, inning: Optional[int] = None):
    try:
        async with database.db_pool.acquire() as conn:
            # 1. Determine Inning
            if inning is None:
                match = await conn.fetchrow("SELECT current_inning FROM matches WHERE id = $1", match_id)
                if not match:
                    raise HTTPException(status_code=404, detail="Match not found")
                inning = match['current_inning']

            # 2. Fetch Ball-by-Ball Data with Joins
            # We need: runs, extras, wicket info, batter name, bowler name
            query = """
                SELECT 
                    b.id, b.over_no, b.ball_no, 
                    b.runs_off_bat, b.extras, b.extra_type, 
                    b.is_wicket,
                    p_bat.name as batter_name,
                    p_bowl.name as bowler_name,
                    
                    w.wicket_type,
                    p_out.name as player_out_name
                    
                FROM balls b
                JOIN players p_bat ON b.striker_id = p_bat.id
                JOIN players p_bowl ON b.bowler_id = p_bowl.id
                LEFT JOIN wickets w ON b.id = w.ball_id
                LEFT JOIN players p_out ON w.player_out_id = p_out.id
                
                WHERE b.match_id = $1 AND b.inning_no = $2
                ORDER BY b.id DESC
            """
            
            rows = await conn.fetch(query, match_id, inning)
            
            # 3. Process into Timeline Events
            events = []
            
            # Track score for "End of Over" calculation (reverse order traversal logic needed?)
            # Actually, to generate "End of Over 1: 10/0", we need the cumulative score at that point.
            # But we are iterating in REVERSE (latest first).
            # So, we can't easily calculate cumulative score unless we fetch the FINAL score and subtract?
            # OR, we fetch all balls ASCENDING, build the timeline, then reverse it.
            
            # Let's re-fetch ASCENDING for easier calculation
            rows_asc = await conn.fetch(query.replace("ORDER BY b.id DESC", "ORDER BY b.id ASC"), match_id, inning)
            
            timeline = []
            
            total_runs = 0
            total_wickets = 0
            
            current_over = -1
            over_runs = 0
            over_wickets = 0
            last_bowler = ""
            
            # Iterate ASCENDING to build state
            for row in rows_asc:
                # Check for New Over
                # Note: over_no starts at 0 or 1? usually 0-indexed in DB based on typical schemas, 
                # but let's assume 0.0 means 1st over.
                
                # Check if we moved to a new over
                # But wait, we want "End of Over" AFTER the balls of that over.
                
                this_over = row['over_no']
                if current_over != -1 and this_over > current_over:
                    # Summary for the completed over (current_over)
                    summary = {
                        "type": "over_summary",
                        "over_number": current_over + 1,
                        "runs": over_runs, # runs in this over
                        "score_runs": total_runs, # total score at end of over
                        "score_wickets": total_wickets,
                        "bowler_name": last_bowler,
                        "crr": round(total_runs / (current_over + 1), 2)
                    }
                    timeline.append(summary)
                    
                    # Reset for new over
                    over_runs = 0
                    over_wickets = 0
                
                if current_over != this_over:
                    current_over = this_over
                
                last_bowler = row['bowler_name']
                
                # Ball Event
                runs = row['runs_off_bat'] + row['extras']
                total_runs += runs
                over_runs += runs
                
                if row['is_wicket']:
                    total_wickets += 1
                    over_wickets += 1
                
                # Generate Commentary Text
                # Simple generation for now
                # "Abc to Ajay, 2 runs"
                # "Abc to Ajay, FOUR"
                # "Abc to Ajay, OUT (Caught)"
                
                ball_text = ""
                if row['is_wicket']:
                    w_type = row['wicket_type'] or "out"
                    ball_text = f"{row['bowler_name']} to {row['player_out_name']}, OUT ({w_type})"
                elif row['runs_off_bat'] == 4:
                    ball_text = f"{row['bowler_name']} to {row['batter_name']}, FOUR"
                elif row['runs_off_bat'] == 6:
                    ball_text = f"{row['bowler_name']} to {row['batter_name']}, SIX"
                else:
                    run_str = "run" if runs == 1 else "runs"
                    extra_str = ""
                    if row['extras'] > 0:
                        extra_str = f" ({row['extra_type']} {row['extras']})"
                    
                    ball_text = f"{row['bowler_name']} to {row['batter_name']}, {runs} {run_str}{extra_str}"
                
                ball_event = {
                    "type": "ball",
                    "over": row['over_no'],
                    "ball": row['ball_no'], # 1-6 usually
                    "runs_bat": row['runs_off_bat'],
                    "extras": row['extras'],
                    "extra_type": row['extra_type'],
                    "is_wicket": row['is_wicket'],
                    "batter": row['batter_name'],
                    "commentary": ball_text
                }
                timeline.append(ball_event)
                
            # Handle the last incomplete over (or if match just finished)
            # If we just finished processing the last ball, we don't naturally add "End of Over" summary 
            # unless the loop logic above hits a "next over" which doesn't exist.
            # So we check if the last processed ball completed an over? 
            # Actually, standard commentary shows "End of Over" even for current over? 
            # No, "End of Over" usually implies the over is DONE.
            # But the detailed image shows "End of over: 1 | 10 runs..."
            # Let's add a summary for the current state if balls exist
            if rows_asc:
                 # Check if the last ball was valid ball 6? Or just show summary so far?
                 # Image shows "End of over: 1" implies over 1 is done.
                 # If we are in over 0.3, we don't show "End of over 1".
                 pass

            # Now REVERSE the timeline for display (Newest first)
            timeline.reverse()
            
            return {
                "match_id": match_id,
                "inning": inning,
                "timeline": timeline
            }

    except Exception as e:
        print(f"Error serving commentary: {e}")
        return {"error": str(e)}
