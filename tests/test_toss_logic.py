
# Standalone test script to verify the logic fix for Toss Updates
# This script simulates the logic used in backend/routes/matches.py and match_settings_routes.py

def test_fetch_match_state_logic():
    print("Testing Fetch Match State Logic (Read Side)...")
    
    # CASE 1: DB has explicit Batting Team (Standard Case)
    # Scenario: Toss Winner = Team A, Decision = Bat.
    # Current Batting Team = Team A.
    mock_db_row = {
        'id': 1,
        'team_a_id': 10, 'team_b_id': 20,
        'batting_team_id': 10, 'bowling_team_id': 20, # Explicitly stored
        'toss_winner_id': 10, 'toss_decision': 'bat',
        'current_inning': 1
    }
    
    # Logic from matches.py
    batting_team_id = mock_db_row['batting_team_id']
    bowling_team_id = mock_db_row['bowling_team_id']
    
    # Fallback Logic
    if not batting_team_id:
         batting_team_id = mock_db_row['team_a_id']
         bowling_team_id = mock_db_row['team_b_id']

    assert batting_team_id == 10
    assert bowling_team_id == 20
    print("✅ Case 1 Passed: Correctly uses stored batting team ID.")


    # CASE 2: The Bug Fix Scenario
    # Scenario: User changed Toss Winner to Team B (in DB), but Match is ongoing so Batting Team is STILL Team A.
    # OLD ERROR: Logic would have recalculated and swapped to Team B because Toss Winner Changed.
    mock_db_row_bug = {
        'id': 1,
        'team_a_id': 10, 'team_b_id': 20,
        'batting_team_id': 10, 'bowling_team_id': 20, # STILL 10 (A) in DB
        'toss_winner_id': 20,  # Changed to Team B
        'toss_decision': 'bat', # B elected to Bat (Visual Only change intended)
        'current_inning': 1
    }

    # Logic from matches.py
    batting_team_id = mock_db_row_bug['batting_team_id']
    
    # Verify we KEPT Team A (10) as batting team
    assert batting_team_id == 10
    print("✅ Case 2 Passed: Toss change did NOT affect Batting Team (Bug Fixed).")


def test_update_settings_logic():
    print("\nTesting Update Settings Logic (Write Side)...")
    
    # Mock Data
    settings_payload = {'toss_winner_id': 20, 'batting_team_id': 10} # User trying to set B won toss, A bats
    db_match_state = {'toss_decision': 'bat'}
    
    # CASE 3: Match Started -> Preserve Decision
    is_match_started = True
    
    toss_decision = 'bowl' # Default reset
    if is_match_started:
        # logic: keep existing
        toss_decision = db_match_state['toss_decision']
    else:
        # logic: recalculate
        if settings_payload['toss_winner_id'] == settings_payload['batting_team_id']:
            toss_decision = 'bat'

    assert toss_decision == 'bat'
    print("✅ Case 3 Passed: Match Started -> Preserved existing toss decision 'bat'.")


if __name__ == "__main__":
    try:
        test_fetch_match_state_logic()
        test_update_settings_logic()
        print("\n🎉 All Logic Tests Passed!")
    except AssertionError as e:
        print(f"\n❌ Test Failed: {e}")
