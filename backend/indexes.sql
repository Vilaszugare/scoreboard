-- optimize read speed for match state fetching
CREATE INDEX IF NOT EXISTS idx_balls_match_inning ON balls(match_id, inning_no);
CREATE INDEX IF NOT EXISTS idx_balls_match_striker ON balls(match_id, striker_id);
CREATE INDEX IF NOT EXISTS idx_balls_match_bowler ON balls(match_id, bowler_id);
CREATE INDEX IF NOT EXISTS idx_matches_current_ids ON matches(current_striker_id, current_bowler_id);
