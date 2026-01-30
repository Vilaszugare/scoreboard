from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
import database

router = APIRouter()

class MatchSettingsUpdate(BaseModel):
    match_number: int
    total_overs: int
    balls_per_over: int
    match_status: str
    toss_winner_id: int
    batting_team_id: int

@router.put("/matches/{match_id}/settings")
async def update_match_settings(match_id: int, settings: MatchSettingsUpdate):
    try:
        async with database.db_pool.acquire() as conn:
            # 1. Fetch Current Match State & Ball Count
            match = await conn.fetchrow("""
                SELECT m.id, m.batting_team_id, m.current_inning, 
                       COUNT(b.id) FILTER (WHERE b.extra_type IS NULL OR b.extra_type IN ('bye', 'leg-bye', 'wicket')) as valid_balls
                FROM matches m
                LEFT JOIN balls b ON m.id = b.match_id AND b.inning_no = m.current_inning
                WHERE m.id = $1
                GROUP BY m.id
            """, match_id)

            if not match:
                raise HTTPException(status_code=404, detail="Match not found")

            # 2. Validation Logic: Check if Match Started
            # Match Started if: valid_balls > 0 OR current_inning > 1
            is_match_started = (match['valid_balls'] > 0) or (match['current_inning'] > 1)
            
            final_batting_team_id = settings.batting_team_id

            if is_match_started:
                # IGNORE user input for batting team, enforce existing
                final_batting_team_id = match['batting_team_id']
            
            # 3. Smart Toss Calculation (Always Run)
            # If toss_winner == batting_team -> chose 'bat'
            # Else -> chose 'bowl'
            toss_decision = 'bowl'
            if settings.toss_winner_id == final_batting_team_id:
                toss_decision = 'bat'

            # 4. Execute Update
            await conn.execute("""
                UPDATE matches 
                SET match_number = $1::INTEGER, 
                    total_overs = $2::INTEGER, 
                    balls_per_over = $3::INTEGER,
                    match_type = $4::TEXT,
                    toss_winner_id = $5::BIGINT,
                    toss_decision = $7::TEXT,
                    batting_team_id = $6::BIGINT
                WHERE id = $8::BIGINT
            """, 
            settings.match_number, 
            settings.total_overs, 
            settings.balls_per_over, 
            settings.match_status, 
            settings.toss_winner_id,
            final_batting_team_id,
            toss_decision,
            match_id)

            return {"status": "success", "message": "Match settings updated successfully"}

    except Exception as e:
        print(f"Error updating settings: {e}")
        raise HTTPException(status_code=500, detail=str(e))
