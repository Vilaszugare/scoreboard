from fastapi import HTTPException
from pydantic import BaseModel
from typing import Optional, Dict, Any, List
import asyncpg
import database

# --- Pydantic Models ---
class CreateMatchRequest(BaseModel):
    batting_team_id: int
    bowling_team_id: int
    total_overs: int

class ScoreUpdate(BaseModel):
    match_id: int
    action: str 
    value: Any 
    type: Optional[str] = None
    extra_data: Optional[Dict[str, Any]] = None

class NewBatsmanRequest(BaseModel):
    match_id: int
    new_player_id: int
    role: Optional[str] = 'striker' 

class SquadSelectionRequest(BaseModel):
    team_id: int
    player_ids: List[int]

class SimpleMatchRequest(BaseModel):
    match_id: int

class EndMatchRequest(BaseModel):
    match_id: int
    forced_winner_id: Optional[int] = None

# --- Helper Functions ---
def get_strike_rate(runs, balls):
    if balls == 0: return 0.0
    return round((runs / balls) * 100, 2)

async def fetch_match_state(conn, match_id: int):
    try:
        print(f"DEBUG: Fetching match {match_id}")
        row = await conn.fetchrow("SELECT * FROM matches WHERE id = $1", match_id)
        if row:
            print(f"DEBUG: Match {match_id} found. Keys: {row.keys()}")
            return dict(row)
        print(f"DEBUG: Match {match_id} NOT found in DB")
        return None
    except Exception as e:
        print(f"fetch_match_state error: {e}")
        return None

async def fetch_player(conn, player_id):
    if not player_id: return None
    return await conn.fetchrow("SELECT * FROM players WHERE id = $1", player_id)

async def swap_strikers(conn, match_data, match_id: int):
    new_striker = match_data['non_striker_id']
    new_non_striker = match_data['current_striker_id']
    await conn.execute("""
        UPDATE matches 
        SET current_striker_id = $1, non_striker_id = $2 
        WHERE id = $3
    """, new_striker, new_non_striker, match_id)

async def check_over_completion(conn, match_data, match_id: int):
    if match_data['balls'] >= 6:
        new_overs = match_data['overs'] + 1
        await conn.execute("UPDATE matches SET overs = $1, balls = 0 WHERE id = $2", new_overs, match_id)
        await swap_strikers(conn, match_data, match_id)

async def build_match_response(conn, match_id: int):
    match = await fetch_match_state(conn, match_id)
    if not match:
        return {"error": "Match not found"}
    
    striker = await fetch_player(conn, match['current_striker_id'])
    non_striker = await fetch_player(conn, match['non_striker_id'])
    
    batsmen = []
    if striker:
        if striker['is_out']:
             batsmen.append({ "empty": True, "on_strike": True })
        else:
            batsmen.append({
                "name": striker['name'],
                "runs": striker['runs'],
                "balls": striker['balls'],
                "fours": striker['fours'],
                "sixes": striker['sixes'],
                "strike_rate": get_strike_rate(striker['runs'], striker['balls']),
                "on_strike": True
            })
    else:
        batsmen.append({ "empty": True, "on_strike": True })

    if non_striker:
        if non_striker['is_out']:
             batsmen.append({ "empty": True, "on_strike": False })
        else:
            batsmen.append({
                "name": non_striker['name'],
                "runs": non_striker['runs'],
                "balls": non_striker['balls'],
                "fours": non_striker['fours'],
                "sixes": non_striker['sixes'],
                "strike_rate": get_strike_rate(non_striker['runs'], non_striker['balls']),
                "on_strike": False
            })
    else:
         batsmen.append({ "empty": True, "on_strike": False })

    # Bowler Stats
    bowler_data = None
    if match['current_bowler_id']:
        bowler = await fetch_player(conn, match['current_bowler_id'])
        if bowler:
            stats = await conn.fetchrow("""
                SELECT 
                    SUM(runs_off_bat) as runs_off_bat,
                    SUM(CASE WHEN extra_type IN ('wide', 'noball') THEN extras ELSE 0 END) as bowler_extras,
                    COUNT(*) FILTER (WHERE is_wicket = TRUE AND wicket_type != 'runout') as wickets,
                    COUNT(*) FILTER (WHERE extra_type IS NULL OR extra_type IN ('bye', 'leg-bye', 'wicket')) as legal_balls
                FROM balls
                WHERE bowler_id = $1 AND match_id = $2
            """, bowler['id'], match_id)
            
            runs_conceded = (stats['runs_off_bat'] or 0) + (stats['bowler_extras'] or 0)
            wickets = stats['wickets'] or 0
            legal_balls = stats['legal_balls'] or 0
            
            overs_display = f"{legal_balls // 6}.{legal_balls % 6}"
            
            econ = 0.0
            if legal_balls > 0:
                overs_float = legal_balls / 6.0
                econ = round(runs_conceded / overs_float, 2)
            
            dots = await conn.fetchval("""
                SELECT COUNT(*) FROM balls 
                WHERE bowler_id = $1 AND match_id = $2 
                AND runs_off_bat = 0 AND (extras = 0 OR extra_type NOT IN ('wide', 'noball'))
            """, bowler['id'], match_id)

            maidens = 0 
            
            bowler_data = {
                "id": bowler['id'],
                "name": bowler['name'],
                "overs": overs_display,
                "maidens": maidens,
                "runs_conceded": runs_conceded,
                "wickets": wickets,
                "econ": f"{econ:.2f}",
                "dots": dots or 0,
                "extras": stats['bowler_extras'] or 0
            }

    # Toss Details
    toss_winner_name = None
    if match.get('toss_winner_id'):
        toss_team = await conn.fetchrow("SELECT name FROM teams WHERE id = $1", match['toss_winner_id'])
        if toss_team: toss_winner_name = toss_team['name']

    # Dynamic Team ID Calculation
    batting_id = match.get('team_batting_id')
    bowling_id = match.get('team_bowling_id')
    
    # If toss info is available, calculate strictly to ensure correctness across innings
    if match.get('toss_winner_id') and match.get('toss_decision') and match.get('team_a_id') and match.get('team_b_id'):
        winner_id = match['toss_winner_id']
        loser_id = match['team_b_id'] if winner_id == match['team_a_id'] else match['team_a_id']
        
        # Who batted first?
        if match['toss_decision'] == 'bat':
            first_bat = winner_id
            first_bowl = loser_id
        else:
            first_bat = loser_id
            first_bowl = winner_id
            
        if match.get('current_inning', 1) == 2:
            batting_id = first_bowl
            bowling_id = first_bat
        else:
            batting_id = first_bat
            bowling_id = first_bowl

    return {
        "innings": {
            "runs": match['team_score'],
            "wickets": match['wickets'],
            "overs": f"{match['overs']}.{match['balls']}",
            "target": match.get('target_score', 0),
            "current_inning": match.get('current_inning', 1)
        },
        "current_batsmen": batsmen,
        "current_bowler": bowler_data,
        "batting_team": match['team_name_batting'],
        "bowling_team": match['team_name_bowling'],
        "batting_team_id": batting_id,
        "bowling_team_id": bowling_id,
        "toss_winner_name": toss_winner_name,
        "toss_decision": match.get('toss_decision'),
        "result_message": match.get('result_message'),
        "total_overs": match.get('total_overs', 20)
    }
