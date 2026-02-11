from fastapi import APIRouter, HTTPException
import database
from common import (
    fetch_match_state, build_match_response, fetch_player, 
    SimpleMatchRequest, NewBatsmanRequest, SquadSelectionRequest, EndMatchRequest, CreateMatchRequest
)
from utils.match_helpers import calculate_match_score, get_player_stats, format_timeline
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
                    m.batting_team_id, m.bowling_team_id,
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

    # 2. Convert to Dict for modification
    match_dict = dict(match)

    # 3. Determine Teams (Use DB Source of Truth)
    batting_team_id = match['batting_team_id']
    bowling_team_id = match['bowling_team_id']
    
    # Fallback if null (shouldn't happen in valid active matches)
    if not batting_team_id:
         batting_team_id = match['team_a_id']
         bowling_team_id = match['team_b_id']
    
    # Map Names & Logos & Colors
    # We check against team_a_id to see which team struct to use
    if batting_team_id == match['team_a_id']:
        bat_name, bat_logo, bat_color = match['team_a_name'], match['team_a_logo'], match['team_a_color']
        bowl_name, bowl_logo, bowl_color = match['team_b_name'], match['team_b_logo'], match['team_b_color']
    else:
        bat_name, bat_logo, bat_color = match['team_b_name'], match['team_b_logo'], match['team_b_color']
        bowl_name, bowl_logo, bowl_color = match['team_a_name'], match['team_a_logo'], match['team_a_color']

    # --- LOGO FALLBACK LOGIC ---
    if not bat_logo:
        bat_logo = find_logo_for_team(batting_team_id)
    if not bowl_logo:
        bowl_logo = find_logo_for_team(bowling_team_id)

    # ======================================================
    # NEW: FETCH ALL DATA IN BULK (Optimization)
    # ======================================================
    
    # A. Fetch All Balls
    balls_rows = await conn.fetch("SELECT * FROM balls WHERE match_id = $1 ORDER BY id", match_id)
    all_balls = [dict(b) for b in balls_rows]
    
    # B. Fetch Adjustments
    current_inn = match.get('current_inning', 1)
    adj_row = await conn.fetchrow("SELECT * FROM score_adjustments WHERE match_id = $1 AND inning_no = $2", match_id, current_inn)
    adjustments = dict(adj_row) if adj_row else None

    # ======================================================
    # CALL HELPER FUNCTIONS (Pure Python Logic)
    # ======================================================
    
    score_data = calculate_match_score(all_balls, match_dict, adjustments)
    player_data = get_player_stats(all_balls, match_dict)
    timeline = format_timeline(all_balls, current_inn)

    # ======================================================
    # RECONSTRUCT RESPONSE
    # ======================================================
    
    # 1. Batsmen Stats (From Helper)
    batsmen = []
    
    striker_id = match['current_striker_id']
    non_striker_id = match['non_striker_id']
    
    # Helper to fetch player details (could be optimized with bulk fetch, but keeping simple for now)
    async def get_details(pid, on_strike):
        if not pid: return None
        p_row = await conn.fetchrow("SELECT id, name, photo_url FROM players WHERE id=$1", pid)
        if not p_row: return None
        
        # Get stats from our computed dict
        p_stats = player_data['batting'].get(pid, {'runs': 0, 'balls': 0, 'fours': 0, 'sixes': 0})
        
        # Calculate SR
        sr = 0.0
        if p_stats['balls'] > 0:
            sr = round((p_stats['runs'] / p_stats['balls']) * 100, 2)
            
        return {
            "id": p_row['id'], "name": p_row['name'], "photo_url": p_row['photo_url'],
            "runs": p_stats['runs'], "balls": p_stats['balls'], 
            "fours": p_stats['fours'], "sixes": p_stats['sixes'], 
            "on_strike": on_strike,
            "sr": sr
        }

    if striker_id:
        b = await get_details(striker_id, True)
        if b: batsmen.append(b)
    if non_striker_id:
        b = await get_details(non_striker_id, False)
        if b: batsmen.append(b)

    # 2. Bowler Stats (From Helper)
    current_bowler_id = match['current_bowler_id']
    bowler_obj = None
    
    if current_bowler_id:
        b_row = await conn.fetchrow("SELECT id, name, photo_url FROM players WHERE id=$1", current_bowler_id)
        if b_row:
             stats = player_data['bowling'].get(current_bowler_id, 
                        {'runs_conceded':0, 'wickets':0, 'dots':0, 'extras':0, 'legal_balls':0})
             
             lb = stats.get('legal_balls', 0)
             b_overs = f"{lb // 6}.{lb % 6}"
             
             econ = 0.0
             if lb > 0:
                 econ = round(stats['runs_conceded'] / (lb/6.0), 2)
                 
             bowler_obj = {
                 "id": b_row['id'], "name": b_row['name'], "photo_url": b_row['photo_url'],
                 "runs_conceded": stats['runs_conceded'],
                 "wickets": stats['wickets'],
                 "dots": stats['dots'],
                 "econ": econ,
                 "extras": stats['extras'],
                 "overs": b_overs,
                 "maidens": 0 # Still TODO
             }

    # 3. Last Out / Partnership (Keep existing SQL for now as it involves complex joins)
    # Note: We could move this to helper too, but it requires Player Name Joins.
    # For safety, I'll keep the specific SQL for "Last Out" as it's just one query.
    
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
    
    last_out_data = None
    if last_wicket_row:
        # We can get the runs/balls from our player_data dict! No need for extra SQL!
        pid = last_wicket_row['player_out_id']
        p_stats = player_data['batting'].get(pid, {'runs':0, 'balls':0, 'fours':0, 'sixes':0})
        
        w_type = (last_wicket_row['wicket_type'] or "out").lower()
        bo_name = last_wicket_row['bowler_name']
        
        dismissal_text = f"b {bo_name}"
        if "run out" in w_type or "runout" in w_type: dismissal_text = "Run Out"
        elif "lbw" in w_type: dismissal_text = f"lbw b {bo_name}"
        elif "caught" in w_type: dismissal_text = f"c (Fielder) b {bo_name}"
        elif "stumped" in w_type: dismissal_text = f"st b {bo_name}"
        
        last_out_data = {
            "batter_name": last_wicket_row['batter_name'],
            "dismissal": dismissal_text,
            "runs": p_stats['runs'],
            "balls": p_stats['balls'],
            "fours": p_stats['fours'],
            "sixes": p_stats['sixes']
        }

    # 4. Previous Inning Data (Calculated via Wrapper?)
    # If inning 2, we need inning 1 score.
    prev_inning_data = None
    calculated_target = match['target_score']
    
    if current_inn == 2:
        # We can re-use calculate_match_score but need adjustments for inning 1
        adj_inn1_row = await conn.fetchrow("SELECT * FROM score_adjustments WHERE match_id = $1 AND inning_no = 1", match_id)
        adj_inn1 = dict(adj_inn1_row) if adj_inn1_row else None
        
        # Hack: Mutate match object temporarily or pass inning explicitly to helper?
        # Helper takes all balls and checks match_info['current_inning'].
        # Let's create a temp match dict.
        temp_match = match_dict.copy()
        temp_match['current_inning'] = 1
        
        inn1_score = calculate_match_score(all_balls, temp_match, adj_inn1)
        prev_inning_data = {
            "runs": inn1_score['runs'],
            "wickets": inn1_score['wickets'],
            "overs": inn1_score['overs']
        }
        calculated_target = inn1_score['runs'] + 1

    # 5. Current Partnership (Python Logic)
    # Filter balls for current partnership
    # Last wicket ID?
    last_wkt_ball = None
    # Reverse search for wicket
    for b in reversed(all_balls):
        if b['match_id'] == match_id and b['inning_no'] == current_inn and b['is_wicket']:
            last_wkt_ball = b
            break
            
    start_id = last_wkt_ball['id'] if last_wkt_ball else 0
    
    part_runs = 0
    part_balls = 0
    
    for b in all_balls:
        if b['match_id'] == match_id and b['inning_no'] == current_inn and b['id'] > start_id:
            part_runs += (b['runs_off_bat'] or 0) + (b['extras'] or 0)
            et = b.get('extra_type')
            if et not in ('wide', 'no-ball', 'noball'):
                part_balls += 1
                
    current_partnership = { "runs": part_runs, "balls": part_balls }

    # --- TOSS WINNER NAME ---
    toss_winner_name = None
    if match['toss_winner_id'] == match['team_a_id']:
        toss_winner_name = match['team_a_name']
    elif match['toss_winner_id'] == match['team_b_id']:
        toss_winner_name = match['team_b_name']

    # RETURN FINAL JSON
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

        "team_a_id": match['team_a_id'],
        "team_b_id": match['team_b_id'],
        "team_a": match['team_a_name'],
        "team_b": match['team_b_name'],
        "team_a_logo": match['team_a_logo'],
        "team_b_logo": match['team_b_logo'],
        "team_a_color": match['team_a_color'],
        "team_b_color": match['team_b_color'],
        
        # Timeline
        "this_over_balls": timeline,
        "this_over_runs": sum(t['runs'] + t['extras'] for t in timeline if True),
        
        "crr": score_data['crr'],
        "projected_score": score_data['projected_score'],
        "toss_winner": match['toss_winner_id'],
        "toss_winner_name": toss_winner_name,
        "toss_decision": match['toss_decision'],
        "current_partnership": current_partnership,
        "innings": {
            "runs": score_data['runs'],
            "wickets": score_data['wickets'],
            "overs": score_data['overs'],
            "current_inning": current_inn,
            "target": calculated_target
        },
        "last_out": last_out_data,
        "previous_inning": prev_inning_data,
        "current_batsmen": batsmen,
        "current_bowler": bowler_obj
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


@router.get("/matches")
async def get_matches(tournament_id: int):
    async with database.db_pool.acquire() as conn:
        matches = await conn.fetch("""
            SELECT 
                m.*, 
                ROW_NUMBER() OVER (PARTITION BY m.tournament_id ORDER BY m.id ASC) as visual_number
            FROM matches m
            WHERE m.tournament_id = $1
            ORDER BY m.id DESC
        """, tournament_id)
        
        # Convert to dictionary (Record objects needed serialization)
        return [dict(m) for m in matches]

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
            
            # --- NEW: LOG EVENT FOR UNDO ---
            await conn.execute("INSERT INTO match_events (match_id, event_type, event_id) VALUES ($1, 'NEW_BATTER', $2)", match_id, payload.new_player_id)
            # -------------------------------
            
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
        
        # --- NEW: LOG EVENT FOR UNDO ---
        await conn.execute("INSERT INTO match_events (match_id, event_type, event_id) VALUES ($1, 'NEW_BOWLER', $2)", match_id, payload.new_player_id)
        # -------------------------------
        
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
