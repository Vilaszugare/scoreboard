from fastapi import APIRouter, HTTPException
import database
from common import (
    fetch_match_state, build_match_response, fetch_player, 
    SimpleMatchRequest, NewBatsmanRequest, SquadSelectionRequest, EndMatchRequest, CreateMatchRequest
)
from pydantic import BaseModel
import os
import glob

# Constants for Logo Search
BASE_DIR = os.path.dirname(os.path.abspath(__file__)) # backend/routes
BACKEND_DIR = os.path.dirname(BASE_DIR) # backend
PROJECT_DIR = os.path.dirname(BACKEND_DIR) # root
LOGO_DIR_ABS = os.path.join(PROJECT_DIR, "frontend", "static", "logos")

def find_logo_for_team(team_id: int):
    """
    Looks for a file matching team_{team_id}_* in the logos directory.
    Returns the web-accessible path if found, matches the format used in teams.py.
    """
    if not os.path.exists(LOGO_DIR_ABS):
        return None
    
    # Search for team_{id}_*
    pattern = os.path.join(LOGO_DIR_ABS, f"team_{team_id}_*")
    matching_files = glob.glob(pattern)
    
    if matching_files:
        # Take the first match
        full_path = matching_files[0]
        filename = os.path.basename(full_path)
        return f"/static/logos/{filename}"
    
    return None

# Schema for setting the bowler
class SetBowlerRequest(BaseModel):
    player_id: int

# Schema for adding a new player on the fly
class QuickAddPlayerRequest(BaseModel):
    name: str
    team_id: int
    role: str = "All Rounder" # Default role



class ScoreCorrectionRequest(BaseModel):
    inning: int
    target_runs: int
    target_wickets: int
    target_overs: str # Format "X.Y"


router = APIRouter()

async def fetch_full_match_state(conn, match_id: int):
    # 1. Fetch Basic Match Info (Added LOGOS, Match No, Match Type)
    # OPTIMIZED: Uses LEFT JOIN and explicit logo column
    match = await conn.fetchrow("""
             SELECT m.id, m.current_inning, m.total_overs, m.target_score, 
                    m.status, m.result_message,
                    m.current_striker_id, m.non_striker_id, m.current_bowler_id,
                    m.toss_winner_id, m.toss_decision,
                    m.team_a_id, m.team_b_id,
                    m.match_number, m.match_type,

                    t1.name as team_a_name, t1.short_name as team_a_short, t1.logo as team_a_logo, t1.team_color as team_a_color,
                    t2.name as team_b_name, t2.short_name as team_b_short, t2.logo as team_b_logo, t2.team_color as team_b_color
             FROM matches m
             LEFT JOIN teams t1 ON m.team_a_id = t1.id
             LEFT JOIN teams t2 ON m.team_b_id = t2.id
             WHERE m.id = $1
    """, match_id)

    if not match:
        return None

    # 2. Determine Teams (Batting/Bowling)
    batting_team_id = match['team_a_id']
    bowling_team_id = match['team_b_id']
    
    if match['toss_winner_id'] and match['toss_decision']:
        winner = match['toss_winner_id']
        loser = match['team_b_id'] if winner == match['team_a_id'] else match['team_a_id']

        if match['toss_decision'] == 'bat':
            first_bat, first_bowl = winner, loser
        else:
            first_bat, first_bowl = loser, winner
        
        if match.get('current_inning', 1) == 2:
            batting_team_id, bowling_team_id = first_bowl, first_bat
        else:
            batting_team_id, bowling_team_id = first_bat, first_bowl
    
    # Map Names & Logos & Colors
    if batting_team_id == match['team_a_id']:
        bat_name, bat_logo, bat_color = match['team_a_name'], match['team_a_logo'], match['team_a_color']
        bowl_name, bowl_logo, bowl_color = match['team_b_name'], match['team_b_logo'], match['team_b_color']
    else:
        bat_name, bat_logo, bat_color = match['team_b_name'], match['team_b_logo'], match['team_b_color']
        bowl_name, bowl_logo, bowl_color = match['team_a_name'], match['team_a_logo'], match['team_a_color']

    # --- LOGO FALLBACK LOGIC ---
    # If the database doesn't have a logo URL, look for it in the filesystem
    if not bat_logo:
        bat_logo = find_logo_for_team(batting_team_id)
    if not bowl_logo:
        bowl_logo = find_logo_for_team(bowling_team_id)

    # 3. Calculate Score
    current_inn = match.get('current_inning', 1)
    
    stats = await conn.fetchrow("""
        SELECT 
            COALESCE(SUM(runs_off_bat + extras), 0) as total_runs,
            COUNT(CASE WHEN is_wicket = TRUE THEN 1 END) as total_wickets,
            COUNT(CASE WHEN extra_type IS NULL OR extra_type IN ('bye', 'leg-bye', 'wicket') THEN 1 END) as valid_balls
        FROM balls 
        WHERE match_id = $1 AND inning_no = $2
    """, match_id, current_inn)

    # --- NEW: Fetch Manual Adjustments ---
    adj = await conn.fetchrow("""
        SELECT runs_adjustment, wickets_adjustment, balls_adjustment 
        FROM score_adjustments 
        WHERE match_id = $1 AND inning_no = $2
    """, match_id, current_inn)
    
    adj_runs = adj['runs_adjustment'] if adj else 0
    adj_wickets = adj['wickets_adjustment'] if adj else 0
    adj_balls = adj['balls_adjustment'] if adj else 0

    # Apply to Current Inning Stats
    runs = (stats['total_runs'] or 0) + adj_runs
    wickets = (stats['total_wickets'] or 0) + adj_wickets
    balls = (stats['valid_balls'] or 0) + adj_balls
    
    # Safety: Ensure no negative numbers
    runs = max(0, runs)
    wickets = max(0, wickets)
    balls = max(0, balls)
    
    overs_float = balls / 6.0
    
    crr = 0.0
    if balls > 0:
        crr = round(runs / overs_float, 2)

    total_overs_match = match.get('total_overs', 20)
    projected = int(crr * total_overs_match) if crr > 0 else 0

    # 4. Recent Balls (This Over)
    recent = await conn.fetch("""
        SELECT runs_off_bat, extras, extra_type, is_wicket 
        FROM balls 
        WHERE match_id = $1 AND inning_no = $2 
        ORDER BY id DESC LIMIT 18
    """, match_id, current_inn)

    this_over_runs = 0
    this_over_balls = [] # New List for UI
    
    balls_in_this_over = balls % 6
    if balls_in_this_over == 0 and balls > 0:
        balls_in_this_over = 6
    elif balls == 0:
        balls_in_this_over = 0

    valid_cnt = 0
    if balls_in_this_over > 0:
        for b in recent:
            this_over_runs += (b['runs_off_bat'] + b['extras'])
            
            # Build Ball Object
            ball_obj = {
                "runs": b['runs_off_bat'],
                "extras": b['extras'],
                "extra_type": b['extra_type'],
                "is_wicket": b['is_wicket']
            }
            this_over_balls.append(ball_obj)
            
            is_valid = True
            if b['extra_type'] in ('wide', 'no-ball'):
                is_valid = False
            
            if is_valid:
                valid_cnt += 1
            
            if valid_cnt >= balls_in_this_over:
                break
    
    # Reverse to show chronological order (1st ball -> Last ball)
    this_over_balls.reverse()


    # --- NEW: PREVIOUS INNING STATS & TARGET CORRECTION (For 2nd Inning) ---
    prev_inning_data = None
    calculated_target = match['target_score']

    if current_inn == 2:
        # Fetch Real Stats
        prev_stats = await conn.fetchrow("""
            SELECT 
                COALESCE(SUM(runs_off_bat + extras), 0) as total_runs,
                COUNT(CASE WHEN is_wicket = TRUE THEN 1 END) as total_wickets,
                COUNT(CASE WHEN extra_type IS NULL OR extra_type IN ('bye', 'leg-bye', 'wicket') THEN 1 END) as valid_balls
            FROM balls 
            WHERE match_id = $1 AND inning_no = 1
        """, match_id)
        
        # Fetch Adjustments for Inning 1
        adj_inn1 = await conn.fetchrow("""
            SELECT runs_adjustment, wickets_adjustment, balls_adjustment 
            FROM score_adjustments 
            WHERE match_id = $1 AND inning_no = 1
        """, match_id)
        
        inn1_adj_runs = adj_inn1['runs_adjustment'] if adj_inn1 else 0
        inn1_adj_wickets = adj_inn1['wickets_adjustment'] if adj_inn1 else 0
        inn1_adj_balls = adj_inn1['balls_adjustment'] if adj_inn1 else 0

        # Calculate Final Stats for Inning 1
        raw_runs = prev_stats['total_runs'] if prev_stats else 0
        raw_wkts = prev_stats['total_wickets'] if prev_stats else 0
        raw_balls = prev_stats['valid_balls'] if prev_stats else 0

        p_runs = raw_runs + inn1_adj_runs
        p_wkts = raw_wkts + inn1_adj_wickets
        p_balls = raw_balls + inn1_adj_balls
        
        # Safety
        p_runs = max(0, p_runs)
        p_wkts = max(0, p_wkts)
        p_balls = max(0, p_balls)

        p_overs = f"{p_balls // 6}.{p_balls % 6}"
        prev_inning_data = {
            "runs": p_runs,
            "wickets": p_wkts,
            "overs": p_overs
        }

        # RE-CALCULATE TARGET
        calculated_target = p_runs + 1

    # --- NEW: LAST OUT LOGIC ---
    last_out_data = None
    
    # Corrected Query: Join with wickets table to get player_out and wicket_type
    last_wicket_row = await conn.fetchrow("""
        SELECT 
            w.player_out_id, w.wicket_type,
            p_out.name as batter_name, 
            p_bowl.name as bowler_name
        FROM balls b
        JOIN wickets w ON w.ball_id = b.id
        JOIN players p_out ON w.player_out_id = p_out.id
        JOIN players p_bowl ON b.bowler_id = p_bowl.id
        WHERE b.match_id = $1 AND b.inning_no = $2 AND b.is_wicket = TRUE
        ORDER BY b.id DESC
        LIMIT 1
    """, match_id, current_inn)

    if last_wicket_row:
        # Fetch detailed stats for the batsman who got out
        batsman_stats = await conn.fetchrow("""
             SELECT runs, balls, fours, sixes 
             FROM players 
             WHERE id = $1
        """, last_wicket_row['player_out_id'])
        
        if batsman_stats:
            b_name = last_wicket_row['batter_name']
            bo_name = last_wicket_row['bowler_name']
            w_type = last_wicket_row['wicket_type'] or "out"
            w_type = w_type.lower()
            
            # Formatting dismissal text
            dismissal_text = f"b {bo_name}"
            if "run out" in w_type or "runout" in w_type:
                dismissal_text = "Run Out" 
            elif "lbw" in w_type:
                dismissal_text = f"lbw b {bo_name}"
            elif "caught" in w_type or "catch" in w_type:
                dismissal_text = f"c (Fielder) b {bo_name}" # Placeholder for fielder
            elif "stumped" in w_type:
                dismissal_text = f"st b {bo_name}"
                
            last_out_data = {
                "batter_name": b_name,
                "dismissal": dismissal_text,
                "runs": batsman_stats['runs'],
                "balls": batsman_stats['balls'],
                "fours": batsman_stats['fours'],
                "sixes": batsman_stats['sixes']
            }



    # Resolve Toss Winner Name
    toss_winner_name = None
    if match['toss_winner_id']:
        if match['toss_winner_id'] == match['team_a_id']:
            toss_winner_name = match['team_a_name']
        elif match['toss_winner_id'] == match['team_b_id']:
            toss_winner_name = match['team_b_name']

    # --- NEW: Calculate Current Partnership ---
    # 1. Find the ID of the last ball where a wicket fell
    last_wkt_id = await conn.fetchval("""
        SELECT MAX(id) FROM balls
        WHERE match_id = $1 AND inning_no = $2 AND is_wicket = TRUE
    """, match_id, current_inn)

    # If no wickets, start from ID 0 (beginning of inning)
    start_id = last_wkt_id if last_wkt_id else 0

    # 2. Sum runs and count balls AFTER the last wicket
    part_stats = await conn.fetchrow("""
        SELECT 
            COALESCE(SUM(runs_off_bat + extras), 0) as runs,
            COUNT(CASE WHEN extra_type IS NULL OR extra_type IN ('bye', 'leg-bye', 'wicket') THEN 1 END) as valid_balls
        FROM balls 
        WHERE match_id = $1 AND inning_no = $2 AND id > $3
    """, match_id, current_inn, start_id)

    current_partnership = {
        "runs": part_stats['runs'],
        "balls": part_stats['valid_balls']
    }

    # 5. Current Batsmen
    batsmen = []
    
    striker_id = match['current_striker_id']
    non_striker_id = match['non_striker_id']
    
    async def get_match_player_stats(p_id):
        if not p_id: return None
        # Fetch basic details
        p = await conn.fetchrow("SELECT id, name, photo_url FROM players WHERE id=$1", p_id)
        if not p: return None
        
        # Calculate Match Stats
        stats = await conn.fetchrow("""
            SELECT 
                COALESCE(SUM(runs_off_bat), 0) as runs,
                COUNT(*) FILTER (WHERE extra_type IS DISTINCT FROM 'wide') as balls,
                COUNT(*) FILTER (WHERE runs_off_bat = 4) as fours,
                COUNT(*) FILTER (WHERE runs_off_bat = 6) as sixes
            FROM balls
            WHERE match_id = $1 AND striker_id = $2
        """, match_id, p_id)
        
        return {
            "id": p['id'], "name": p['name'], "photo_url": p['photo_url'],
            "runs": stats['runs'], "balls_faced": stats['balls'], 
            "fours": stats['fours'], "sixes": stats['sixes']
        }

    if striker_id:
        s_stats = await get_match_player_stats(striker_id)
        if s_stats:
             s_stats["on_strike"] = True
             batsmen.append(s_stats)
    
    if non_striker_id:
        ns_stats = await get_match_player_stats(non_striker_id)
        if ns_stats:
             ns_stats["on_strike"] = False
             batsmen.append(ns_stats)

    # 6. Current Bowler
    bowler = None
    b_overs = 0.0
    
    current_bowler_id = match.get('current_bowler_id')
    if current_bowler_id:
        b = await conn.fetchrow("SELECT * FROM players WHERE id=$1", current_bowler_id)
        if b:
             stats = await conn.fetchrow("""
                SELECT 
                    SUM(runs_off_bat + extras) as runs_conceded, 
                    COUNT(*) FILTER (WHERE is_wicket = TRUE) as wickets,
                    COUNT(*) FILTER (WHERE extra_type IS NULL OR extra_type IN ('bye', 'leg-bye', 'wicket')) as legal_balls,
                    COUNT(*) FILTER (WHERE runs_off_bat = 0 AND (extras = 0 OR extra_type NOT IN ('wide', 'noball'))) as dots,
                    COUNT(*) FILTER (WHERE extra_type IN ('wide', 'no-ball', 'noball')) as bowler_extras
                FROM balls
                WHERE bowler_id = $1 AND match_id = $2
            """, b['id'], match_id)
            
             rc = stats['runs_conceded'] or 0
             wk = stats['wickets'] or 0
             lb = stats['legal_balls'] or 0
             dots = stats['dots'] or 0
             extras = stats['bowler_extras'] or 0
             
             b_overs = f"{lb // 6}.{lb % 6}"
             
             # Calculate Economy
             econ = 0.0
             if lb > 0:
                 overs_val = lb / 6.0
                 econ = round(rc / overs_val, 2)

             bowler = {
                 "id": b['id'], "name": b['name'], "photo_url": b['photo_url'],
                 "runs_conceded": rc,
                 "wickets": wk,
                 "dots": dots,
                 "econ": econ,
                 "extras": extras,
                 "overs": b_overs,
                 "maidens": 0 # TODO: Implement maiden calculation
             }

    return {
        "match_id": match_id,
        "match_number": match['match_number'],
        "match_type": match['match_type'],
        "total_overs": match['total_overs'],
        "status": match['status'],
        "result_message": match['result_message'],
        "batting_team": bat_name,
        "batting_team_logo": bat_logo,
        "batting_team_color": bat_color,
        "bowling_team": bowl_name,
        "bowling_team_logo": bowl_logo,
        "bowling_team_color": bowl_color,
        "batting_team_id": batting_team_id,
        "bowling_team_id": bowling_team_id,
        "this_over_runs": this_over_runs,
        "this_over_balls": this_over_balls,
        "crr": crr,
        "projected_score": projected,
        "toss_winner": match['toss_winner_id'],
        "toss_winner_name": toss_winner_name,
        "toss_decision": match['toss_decision'],
        "current_partnership": current_partnership,
        "innings": {
            "runs": runs,
            "wickets": wickets,
            "overs": f"{balls // 6}.{balls % 6}",
            "current_inning": current_inn,
            "target": calculated_target
        },
        "last_out": last_out_data,

        "previous_inning": prev_inning_data,
        "current_batsmen": [
            {
                "id": b['id'], "name": b['name'], "photo_url": b['photo_url'],
                "runs": b['runs'], 
                "balls": b['balls_faced'], "fours": b['fours'], 
                "sixes": b['sixes'], "on_strike": b['on_strike'],
                "sr": round((b['runs'] / b['balls_faced'] * 100), 2) if b['balls_faced'] > 0 else 0.0
            } for b in batsmen
        ],
        "current_bowler": {
            "id": bowler['id'], "name": bowler['name'], "photo_url": bowler['photo_url'],
            "overs": bowler['overs'], "runs_conceded": bowler['runs_conceded'],
            "wickets": bowler['wickets'], "dots": bowler['dots'],
            "econ": bowler['econ'], "extras": bowler['extras'], "maidens": bowler['maidens']
        } if bowler else None
    }

@router.get("/matches/{match_id}/scorecard")
async def get_match_scorecard(match_id: int):
    async with database.db_pool.acquire() as conn:
        # 1. Fetch Players Lookups
        players = await conn.fetch("SELECT id, name FROM players")
        p_map = {p['id']: p['name'] for p in players}

        # 2. Fetch All Balls with Wicket Details
        balls = await conn.fetch("""
            SELECT b.*, w.player_out_id, w.wicket_type, w.fielder_id as catcher_id
            FROM balls b
            LEFT JOIN wickets w ON b.id = w.ball_id
            WHERE b.match_id = $1 
            ORDER BY b.id ASC
        """, match_id)

        # 3. Helper to Process an Inning
        def process_inning(inning_num):
            inn_balls = [b for b in balls if b['inning_no'] == inning_num]
            if not inn_balls:
                return None

            # Data Structures
            batting = {} # {player_id: {runs, balls, 4s, 6s, out_desc}}
            bowling = {} # {player_id: {runs, balls, wkts, dots}}
            extras = {"total": 0, "b": 0, "lb": 0, "w": 0, "nb": 0, "p": 0}
            total_runs = 0
            wickets = 0
            
            # To track "Did Not Bat", we need the full squad for this inning's batting team.
            # (Skipping "Did Not Bat" logic for simplicity in this step, relies on frontend knowing squad)

            for b in inn_balls:
                # --- Batting Stats ---
                sid = b['striker_id']
                if sid not in batting: batting[sid] = {'runs': 0, 'balls': 0, '4s': 0, '6s': 0, 'out': 'not out'}
                
                # Only count ball if not wide
                if b['extra_type'] != 'wide':
                    batting[sid]['balls'] += 1
                
                batting[sid]['runs'] += b['runs_off_bat']
                if b['runs_off_bat'] == 4: batting[sid]['4s'] += 1
                if b['runs_off_bat'] == 6: batting[sid]['6s'] += 1

                # Wicket Logic
                if b['is_wicket']:
                    wickets += 1
                    out_p = b['player_out_id'] or sid
                    if out_p not in batting: batting[out_p] = {'runs': 0, 'balls': 0, '4s': 0, '6s': 0, 'out': 'out'}
                    
                    # Build Out Description
                    w_type = b['wicket_type']
                    bowler_name = p_map.get(b['bowler_id'], 'Unknown')
                    catcher_name = p_map.get(b['catcher_id'], 'Unknown')
                    
                    desc = w_type
                    if w_type == "bowled": desc = f"b {bowler_name}"
                    elif w_type == "caught": desc = f"c {catcher_name} b {bowler_name}"
                    elif w_type == "lbw": desc = f"lbw b {bowler_name}"
                    elif w_type == "runout": desc = f"runout ({catcher_name})"
                    elif w_type == "stumped": desc = f"st {catcher_name} b {bowler_name}"
                    
                    batting[out_p]['out'] = desc

                # --- Bowling Stats ---
                bid = b['bowler_id']
                if bid not in bowling: bowling[bid] = {'runs': 0, 'balls': 0, 'wkts': 0, 'dots': 0}
                
                # Valid ball count
                is_legal = b['extra_type'] in [None, 'bye', 'leg-bye', 'wicket']
                if is_legal:
                    bowling[bid]['balls'] += 1
                
                # Runs Conceded (Batsman runs + Wides + No Balls)
                run_cost = b['runs_off_bat']
                if b['extra_type'] in ['wide', 'noball']:
                    run_cost += b['extras']
                
                bowling[bid]['runs'] += run_cost

                if b['is_wicket'] and b['wicket_type'] not in ['runout', 'retired']:
                    bowling[bid]['wkts'] += 1
                
                if run_cost == 0:
                     bowling[bid]['dots'] += 1

                # --- Extras ---
                total_runs += (b['runs_off_bat'] + b['extras'])
                if b['extras'] > 0:
                    extras['total'] += b['extras']
                    et = b['extra_type']
                    if et == 'wide': extras['w'] += b['extras']
                    elif et == 'noball': extras['nb'] += b['extras']
                    elif et == 'leg-bye': extras['lb'] += b['extras']
                    elif et == 'bye': extras['b'] += b['extras']
                    elif et == 'penalty': extras['p'] += b['extras']

            # Convert Dicts to Lists
            batting_list = []
            for pid, stats in batting.items():
                sr = 0.0
                if stats['balls'] > 0: sr = round((stats['runs'] / stats['balls']) * 100, 2)
                batting_list.append({
                    "name": p_map.get(pid, "Unknown"),
                    **stats,
                    "sr": sr
                })
            
            bowling_list = []
            for pid, stats in bowling.items():
                overs = f"{stats['balls'] // 6}.{stats['balls'] % 6}"
                econ = 0.0
                # Calculate Econ (Runs / Overs)
                # Avoid div by zero. 1 ball = 0.166 overs
                actual_overs = stats['balls'] / 6
                if actual_overs > 0: econ = round(stats['runs'] / actual_overs, 2)
                
                bowling_list.append({
                    "name": p_map.get(pid, "Unknown"),
                    **stats,
                    "overs_display": overs,
                    "econ": econ
                })

            return {
                "batting": batting_list,
                "bowling": bowling_list,
                "extras": extras,
                "total": total_runs,
                "wickets": wickets,
                "overs": f"{len([b for b in inn_balls if b['extra_type'] in [None, 'bye', 'leg-bye', 'wicket']]) // 6}.{len([b for b in inn_balls if b['extra_type'] in [None, 'bye', 'leg-bye', 'wicket']]) % 6}"
            }

        return {
            "inning1": process_inning(1),
            "inning2": process_inning(2)
        }

@router.get("/match_data")
async def get_match_data(match_id: int):
    async with database.db_pool.acquire() as conn:
        state = await fetch_full_match_state(conn, match_id)
        if not state:
            raise HTTPException(status_code=404, detail="Match not found")
        return state

@router.post("/matches")
async def create_match(payload: CreateMatchRequest):
    try:
        async with database.db_pool.acquire() as conn:
            # Fetch Team Names for redundancy
            t1 = await conn.fetchrow("SELECT name FROM teams WHERE id = $1", payload.batting_team_id)
            t2 = await conn.fetchrow("SELECT name FROM teams WHERE id = $1", payload.bowling_team_id)
            
            if not t1 or not t2:
                return {"error": "Invalid Team IDs"}

            # Insert Match
            # We map batting_team_id -> team_a_id and bowling_team_id -> team_b_id for initial state
            match_id = await conn.fetchval("""
                INSERT INTO matches (
                    team_a_id, team_b_id, 
                    batting_team_id, bowling_team_id,
                    team_name_batting, team_name_bowling,
                    current_inning, status, total_overs, 
                    team_score, wickets, overs, balls
                )
                VALUES ($1, $2, $3, $4, $5, $6, 1, 'live', $7, 0, 0, 0, 0)
                RETURNING id
            """, payload.batting_team_id, payload.bowling_team_id, 
                 payload.batting_team_id, payload.bowling_team_id,
                 t1['name'], t2['name'], payload.total_overs)
            
            return {"status": "success", "match_id": match_id, "message": "Match created successfully"}

    except Exception as e:
        print(f"Error creating match: {e}")
        return {"error": str(e)}

@router.post("/matches/{match_id}/set_batsman")
async def set_batsman(match_id: int, payload: NewBatsmanRequest):
    try:
        async with database.db_pool.acquire() as conn:
            # 1. Determine which slot to fill (Striker or Non-Striker)
            column_name = "current_striker_id" if payload.role == "striker" else "non_striker_id"
            
            # 2. Update the Match Table
            # Note: payload uses new_player_id based on common.py definition
            await conn.execute(f"""
                UPDATE matches 
                SET {column_name} = $1 
                WHERE id = $2
            """, payload.new_player_id, match_id)
            
            # 3. Mark player as 'is_batted' (optional but good practice)
            await conn.execute("UPDATE players SET is_batted = TRUE WHERE id = $1", payload.new_player_id)
            
            return await fetch_full_match_state(conn, match_id)
            
    except Exception as e:
        print(f"Error setting batsman: {e}")
        return {"error": str(e)}

@router.get("/available_players")
async def get_available_players(match_id: int):
    try:
        async with database.db_pool.acquire() as conn:
            match = await fetch_match_state(conn, match_id)
            if not match: return {"error": "Match not found"}
            
            striker_id = match['current_striker_id']
            non_striker_id = match['non_striker_id']
            current_ids = []
            if striker_id: current_ids.append(striker_id)
            if non_striker_id: current_ids.append(non_striker_id)
            
            # Filter by Batting Team ID directly (More Robust)
            team_id = match.get('batting_team_id')
            
            # Fallback to name lookup if ID missing (Legacy support)
            if not team_id:
                team_name = match.get('team_name_batting')
                if team_name:
                    team_row = await conn.fetchrow("SELECT id FROM teams WHERE name = $1", team_name)
                    if team_row: team_id = team_row['id']
            
            if team_id:
                if not current_ids:
                    rows = await conn.fetch("""
                        SELECT id, name FROM players 
                        WHERE is_out = FALSE AND team_id = $1
                    """, team_id)
                else:
                    rows = await conn.fetch("""
                        SELECT id, name FROM players 
                        WHERE is_out = FALSE AND team_id = $1 AND id != ALL($2)
                    """, team_id, current_ids)
            else:
                # Fallback: All players explicitly not out (if no team context)
                if not current_ids:
                    rows = await conn.fetch("SELECT id, name FROM players WHERE is_out = FALSE")
                else:
                    rows = await conn.fetch("""
                        SELECT id, name FROM players 
                        WHERE is_out = FALSE AND id != ALL($1)
                    """, current_ids)
            
            players = [{"id": r['id'], "name": r['name']} for r in rows]
            return {"players": players}
            
    except Exception as e:
        import traceback
        traceback.print_exc()
        return {"error": str(e)}

@router.get("/bowling_squad")
async def get_bowling_squad(match_id: int):
    try:
        async with database.db_pool.acquire() as conn:
            match = await fetch_match_state(conn, match_id)
            if not match: return {"players": []}
            
            # Robust Logic: Use Bowling Team Name
            bowling_team_name = match.get('team_name_bowling')
            if not bowling_team_name: 
                 return {"players": []}
            
            team_row = await conn.fetchrow("SELECT id FROM teams WHERE name = $1", bowling_team_name)
            if not team_row: return {"players": []}
            
            team_id = team_row['id']
            rows = await conn.fetch("""
                SELECT id, name FROM players 
                WHERE team_id = $1
            """, team_id)
            
            players = [{"id": r['id'], "name": r['name']} for r in rows]
            return {"players": players}
    except Exception as e:
        print(f"Error getting bowling squad: {e}")
        return {"error": str(e)}

@router.post("/matches/{match_id}/select_squad")
async def select_squad(match_id: int, payload: SquadSelectionRequest):
    try:
        async with database.db_pool.acquire() as conn:
            async with conn.transaction():
                values = [(match_id, pid, True) for pid in payload.player_ids]
                await conn.executemany("""
                    INSERT INTO match_squads (match_id, player_id, is_playing_11)
                    VALUES ($1, $2, $3)
                """, values)
                return {"status": "success", "message": f"Squad of {len(values)} selected"}
    except Exception as e:
        print(f"Error selecting squad: {e}")
        return {"status": "error", "message": str(e)}



@router.post("/matches/{match_id}/rotate_strike")
async def rotate_strike(match_id: int):
    async with database.db_pool.acquire() as conn:
        # 1. Fetch current IDs
        row = await conn.fetchrow("SELECT current_striker_id, non_striker_id FROM matches WHERE id = $1", match_id)
        
        if not row:
            raise HTTPException(status_code=404, detail="Match not found")
            
        s_id = row['current_striker_id']
        ns_id = row['non_striker_id']
        
        # 2. DEBUG PRINT
        print(f"Swapping: Striker {s_id} <-> Non-Striker {ns_id}")
        
        # 3. Perform Swap (Even if one is None, we swap them)
        await conn.execute("""
            UPDATE matches 
            SET current_striker_id = $1, non_striker_id = $2
            WHERE id = $3
        """, ns_id, s_id, match_id)
        
        return await fetch_full_match_state(conn, match_id)

@router.post("/matches/{match_id}/set_bowler")
async def set_bowler(match_id: int, payload: SetBowlerRequest):
    async with database.db_pool.acquire() as conn:
        # 1. Verify match exists
        match = await conn.fetchrow("SELECT id FROM matches WHERE id = $1", match_id)
        if not match:
            raise HTTPException(status_code=404, detail="Match not found")

        # 2. Update the Current Bowler
        await conn.execute("""
            UPDATE matches 
            SET current_bowler_id = $1 
            WHERE id = $2
        """, payload.player_id, match_id)
        
        return await fetch_full_match_state(conn, match_id)

@router.post("/players/quick_add")
async def quick_add_player(payload: QuickAddPlayerRequest):
    async with database.db_pool.acquire() as conn:
        # 1. Insert the new player
        # We use 'RETURNING id' to get the new ID immediately
        row = await conn.fetchrow("""
            INSERT INTO players (name, team_id, role)
            VALUES ($1, $2, $3)
            RETURNING id
        """, payload.name, payload.team_id, payload.role)
        
        return {"id": row['id'], "name": payload.name, "role": payload.role, "team_id": payload.team_id}



@router.delete("/matches/{match_id}")
async def delete_match(match_id: int):
    async with database.db_pool.acquire() as conn:
        await conn.execute("DELETE FROM matches WHERE id = $1", match_id)
        return {"status": "success", "message": "Match deleted"}


@router.post("/matches/{match_id}/update_score")
async def correct_score(match_id: int, payload: ScoreCorrectionRequest):
    try:
        async with database.db_pool.acquire() as conn:
            # 1. Calculate the 'Real' DB Score (from balls table)
            real_stats = await conn.fetchrow("""
                SELECT 
                    COALESCE(SUM(runs_off_bat + extras), 0) as runs,
                    COUNT(CASE WHEN is_wicket = TRUE THEN 1 END) as wickets,
                    COUNT(CASE WHEN extra_type IS NULL OR extra_type IN ('bye', 'leg-bye', 'wicket') THEN 1 END) as valid_balls
                FROM balls 
                WHERE match_id = $1 AND inning_no = $2
            """, match_id, payload.inning)
            
            real_runs = real_stats['runs'] or 0
            real_wickets = real_stats['wickets'] or 0
            real_balls = real_stats['valid_balls'] or 0

            # 2. Parse User's Target Overs (e.g., "2.4" -> 16 balls)
            new_total_overs = None
            try:
                if '.' in str(payload.target_overs):
                    o, b = map(int, str(payload.target_overs).split('.'))
                    target_balls = (o * 6) + b
                    new_total_overs = o # Extract integer part (e.g. 9 from "9.0")
                else:
                    target_balls = int(float(payload.target_overs) * 6) # Validation fallback
                    new_total_overs = int(float(payload.target_overs))
            except:
                target_balls = real_balls # Fallback if invalid format

            # 3. Calculate the Adjustment Needed (Target - Real)
            adj_runs = payload.target_runs - real_runs
            adj_wickets = payload.target_wickets - real_wickets
            adj_balls = target_balls - real_balls

            # 4. Upsert into score_adjustments table
            await conn.execute("""
                INSERT INTO score_adjustments (match_id, inning_no, runs_adjustment, wickets_adjustment, balls_adjustment)
                VALUES ($1, $2, $3, $4, $5)
                ON CONFLICT (match_id, inning_no) 
                DO UPDATE SET 
                    runs_adjustment = EXCLUDED.runs_adjustment,
                    wickets_adjustment = EXCLUDED.wickets_adjustment,
                    balls_adjustment = EXCLUDED.balls_adjustment
            """, match_id, payload.inning, adj_runs, adj_wickets, adj_balls)

            # --- NEW FIX: SYNC TOTAL OVERS ---
            # If we are editing Inning 1, we assume the user wants to set the match length
            if payload.inning == 1 and new_total_overs is not None:
                 await conn.execute("""
                    UPDATE matches 
                    SET total_overs = $1 
                    WHERE id = $2
                 """, new_total_overs, match_id)

            return await fetch_full_match_state(conn, match_id)
            
    except Exception as e:
        print(f"Error correcting score: {e}")
        return {"error": str(e)}
