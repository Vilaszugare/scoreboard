import math

def calculate_match_score(balls, match_info, adjustments=None):
    """
    Calculates the score, wickets, and overs for the specific inning 
    defined in match_info['current_inning'].
    """
    current_inn = match_info.get('current_inning', 1)
    
    # Filter balls for the current inning
    # Note: 'balls' input should ideally be all balls for the match, 
    # or pre-filtered. We'll assume input is ALL balls and filter here 
    # to be safe, or if pre-filtered, this is harmless.
    inn_balls = [b for b in balls if b['inning_no'] == current_inn]
    
    # 1. Sum Runs and Extras
    # Logic: runs = runs_off_bat + extras
    total_runs = sum((b['runs_off_bat'] or 0) + (b['extras'] or 0) for b in inn_balls)
    
    # 2. Count Wickets
    total_wickets = sum(1 for b in inn_balls if b['is_wicket'])
    
    # 3. Valid Balls (Legal Deliveries)
    # Logic: extra_type IS NULL OR extra_type IN ('bye', 'leg-bye', 'wicket')
    # In Python: not wide and not noball
    # 'wicket' extra_type usually means "wicket fell on legal ball" or just generic.
    # We check the inverse: if it is 'wide' or 'no-ball' (or 'noball'), it's NOT a legal ball for over count.
    
    valid_balls_count = 0
    for b in inn_balls:
        et = b.get('extra_type')
        # Normalize check
        if et in ('wide', 'no-ball', 'noball'):
            continue
        valid_balls_count += 1
        
    # 4. Apply Adjustments
    adj_runs = 0
    adj_wickets = 0
    adj_balls = 0
    
    if adjustments:
        adj_runs = adjustments.get('runs_adjustment', 0) or 0
        adj_wickets = adjustments.get('wickets_adjustment', 0) or 0
        adj_balls = adjustments.get('balls_adjustment', 0) or 0
        
    final_runs = total_runs + adj_runs
    final_wickets = total_wickets + adj_wickets
    final_balls = valid_balls_count + adj_balls
    
    # Safety Check
    final_runs = max(0, final_runs)
    final_wickets = max(0, final_wickets)
    final_balls = max(0, final_balls)
    
    # 5. Overs Display
    overs_display = f"{final_balls // 6}.{final_balls % 6}"
    
    # 6. CRR & Projected
    crr = 0.0
    if final_balls > 0:
        overs_float = final_balls / 6.0
        crr = round(final_runs / overs_float, 2)
        
    total_overs_match = match_info.get('total_overs', 20)
    projected = int(crr * total_overs_match) if crr > 0 else 0
    
    return {
        "runs": final_runs,
        "wickets": final_wickets,
        "overs": overs_display,
        "balls": final_balls, # Raw valid balls count
        "crr": crr,
        "projected_score": projected
    }

def get_player_stats(balls, match_info):
    """
    Aggregates stats for:
    - Batting: Runs, Balls, 4s, 6s, SR
    - Bowling: Overs, Runs, Wickets, Econ, Dots, Extras
    """
    match_id = match_info['id']
    current_inn = match_info.get('current_inning', 1)
    
    # Initialize containers
    batting_stats = {} # { player_id: { runs, balls, 4s, 6s } }
    bowling_stats = {} # { player_id: { runs, wickets, legal_balls, dots, extras } }
    
    # Iterate ALL balls (to get stats across entire match? Or just current inning?)
    # Usually player stats (like 30 runs off 20 balls) are match-wide or inning-wide.
    # For "Current Batsmen" we want their current inning score.
    # For "Current Bowler" we want their current inning/match figures? 
    # Standard cricket scorecard usually shows stats per inning.
    # BUT, the `fetch_full_match_state` returns "current_batsmen" who are active NOW.
    # So we should filter by the current inning for them.
    
    relevant_balls = [b for b in balls if b['inning_no'] == current_inn]
    
    for b in relevant_balls:
        # --- Batting ---
        striker = b['striker_id']
        if striker not in batting_stats:
            batting_stats[striker] = { 'runs': 0, 'balls': 0, 'fours': 0, 'sixes': 0 }
            
        runs_bat = b['runs_off_bat'] or 0
        extra_type = b.get('extra_type')
        
        # Power Hitting
        batting_stats[striker]['runs'] += runs_bat
        if runs_bat == 4: batting_stats[striker]['fours'] += 1
        if runs_bat == 6: batting_stats[striker]['sixes'] += 1
        
        # Balls Faced: Wides do NOT count as balls faced
        if extra_type != 'wide':
            batting_stats[striker]['balls'] += 1
            
        # --- Bowling ---
        bowler = b['bowler_id']
        if bowler not in bowling_stats:
            bowling_stats[bowler] = { 'runs_conceded': 0, 'wickets': 0, 'legal_balls': 0, 'dots': 0, 'extras': 0 }
            
        # Runs Conceded: Runs off bat + Wides + No Balls
        # Byes/Legbyes do not count against bowler
        rc = runs_bat
        extras_val = b['extras'] or 0
        
        if extra_type in ('wide', 'no-ball', 'noball'):
            rc += extras_val
            bowling_stats[bowler]['extras'] += extras_val
            
        bowling_stats[bowler]['runs_conceded'] += rc
        
        # Wickets: Count valid wickets (exclude runouts/retired usually, but simplistic here)
        if b['is_wicket']:
             # In simple logic, all wickets credit bowler unless runout.
             # Ideally check wicket_type, but let's stick to existing logic 
             # Existing Logic: COUNT(*) FILTER (WHERE is_wicket = TRUE)
             bowling_stats[bowler]['wickets'] += 1
             
        # Legal Balls
        is_legal = True
        if extra_type in ('wide', 'no-ball', 'noball'):
            is_legal = False
            
        if is_legal:
            bowling_stats[bowler]['legal_balls'] += 1
            
        # Dots
        # runs_off_bat = 0 AND (extras=0 OR not wide/noball)
        if runs_bat == 0 and (extras_val == 0 or extra_type not in ('wide', 'no-ball', 'noball')):
            bowling_stats[bowler]['dots'] += 1

    return {
        "batting": batting_stats,
        "bowling": bowling_stats
    }

def format_timeline(balls, current_inning):
    """
    Returns the last 18 balls for the timeline display.
    """
    # Filter and Sort Descending (Newest first)
    inn_balls = [b for b in balls if b['inning_no'] == current_inning]
    # Assuming input 'balls' might be sorted by ID ascending, so we take last ones
    # But UI expects Newest First.
    
    # sort by id desc
    inn_balls.sort(key=lambda x: x['id'], reverse=True)
    
    recent = inn_balls[:18]
    timeline = []
    
    # Calculate balls_in_this_over to determine break? 
    # The UI typically just shows a list.
    # The existing logic did logic to break loop. We'll just return the list 
    # and let the UI/Route handle the "Valid Cnt" logic if strictly needed, 
    # but based on prompt, we just want a clean list.
    
    for b in recent:
        timeline.append({
            "runs": b['runs_off_bat'],
            "extras": b['extras'],
            "extra_type": b['extra_type'],
            "is_wicket": b['is_wicket']
        })
        
    return timeline
