
from fastapi import APIRouter, HTTPException, UploadFile, File
from pydantic import BaseModel
from typing import Optional, List
import asyncpg
import database

router = APIRouter()

class PlayerStats(BaseModel):
    id: int
    name: str
    team_name: Optional[str] = None
    role: Optional[str] = "Player"
    photo_url: Optional[str] = None
    
    # Career/Tournament Stats
    matches: int = 0
    innings: int = 0
    runs: int = 0
    balls: int = 0
    fours: int = 0
    sixes: int = 0
    sr: float = 0.0
    avg: float = 0.0
    best_score: int = 0
    is_not_out: bool = False # For Best Score formatting e.g. 50*

@router.get("/players/{player_id}", response_model=PlayerStats)
async def get_player_stats(player_id: int):
    async with database.db_pool.acquire() as db:
        # 1. Fetch Basic Player Info & Team Name
        player_query = """
            SELECT p.id, p.name, p.role, p.photo_url, t.name as team_name
            FROM players p
            LEFT JOIN teams t ON p.team_id = t.id
            WHERE p.id = $1
        """
        player = await db.fetchrow(player_query, player_id)
        
        if not player:
            raise HTTPException(status_code=404, detail="Player not found")

        # 2. Calculate Aggregated Stats from 'balls' table (Tournament Career)
        # Note: This aggregates ALL matches in the database.
        stats_query = """
            SELECT 
                COUNT(DISTINCT match_id) as matches,
                SUM(runs_off_bat) as total_runs,
                COUNT(*) FILTER (WHERE extra_type IS NULL) as total_balls,
                COUNT(*) FILTER (WHERE runs_off_bat = 4) as total_4s,
                COUNT(*) FILTER (WHERE runs_off_bat = 6) as total_6s
            FROM balls 
            WHERE striker_id = $1
        """
        stats = await db.fetchrow(stats_query, player_id)

        # 3. Calculate Innings & Outs (for Average)
        # Innings = Count of matches where he batted (faced at least 1 ball)
        innings_query = """
            SELECT COUNT(DISTINCT match_id)
            FROM balls
            WHERE striker_id = $1
        """
        innings_count = await db.fetchval(innings_query, player_id) or 0

        outs_query = """
            SELECT COUNT(*)
            FROM wickets
            WHERE player_out_id = $1
        """
        outs_count = await db.fetchval(outs_query, player_id) or 0

        # 4. Calculate Best Score
        # Group by match, sum runs
        best_query = """
            SELECT SUM(runs_off_bat) as score
            FROM balls
            WHERE striker_id = $1
            GROUP BY match_id
            ORDER BY score DESC
            LIMIT 1
        """
        best_score = await db.fetchval(best_query, player_id) or 0

        # Process Stats
        total_runs = stats['total_runs'] or 0
        total_balls = stats['total_balls'] or 0
        fours = stats['total_4s'] or 0
        sixes = stats['total_6s'] or 0
        
        sr = 0.0
        if total_balls > 0:
            sr = (total_runs / total_balls) * 100
        
        avg = 0.0
        if outs_count > 0:
            avg = total_runs / outs_count
        else:
            avg = total_runs # If never out, Average = Total Runs

        return {
            "id": player['id'],
            "name": player['name'],
            "team_name": player['team_name'],
            "role": player['role'] or "Player",
            "photo_url": player['photo_url'],
            "matches": stats['matches'] or 0,
            "innings": innings_count,
            "career_runs": total_runs,
            "career_balls": total_balls,
            "career_fours": fours,
            "career_sixes": sixes,
            "career_sr": round(sr, 2),
            "career_avg": round(avg, 2),
            "best_score": best_score,
            "is_not_out": False
        }

class UpdatePlayerRequest(BaseModel):
    name: Optional[str] = None
    role: Optional[str] = None
    team_name: Optional[str] = None 
    photo_url: Optional[str] = None

class CreatePlayerRequest(BaseModel):
    team_id: int
    name: str
    role: Optional[str] = "Player"

@router.post("/players")
async def create_player(payload: CreatePlayerRequest):
    async with database.db_pool.acquire() as db:
        # Check if team exists
        team = await db.fetchrow("SELECT id FROM teams WHERE id = $1", payload.team_id)
        if not team:
            raise HTTPException(status_code=404, detail="Team not found")

        query = """
            INSERT INTO players (team_id, name, role)
            VALUES ($1, $2, $3)
            RETURNING id, name, role, team_id
        """
        row = await db.fetchrow(query, payload.team_id, payload.name, payload.role)
        return dict(row)

@router.put("/players/{player_id}")
async def update_player(player_id: int, payload: UpdatePlayerRequest):
    async with database.db_pool.acquire() as db:
        # Check if player exists
        player = await db.fetchrow("SELECT * FROM players WHERE id = $1", player_id)
        if not player:
            raise HTTPException(status_code=404, detail="Player not found")

        # Prepare update query dynamically
        update_fields = []
        values = []
        idx = 1

        if payload.name is not None:
            update_fields.append(f"name = ${idx}")
            values.append(payload.name)
            idx += 1
        
        if payload.role is not None:
            update_fields.append(f"role = ${idx}")
            values.append(payload.role)
            idx += 1

        if payload.photo_url is not None:
            update_fields.append(f"photo_url = ${idx}")
            values.append(payload.photo_url)
            idx += 1
            
        # Note: updating team might require finding team_id from name if provided, or assuming frontend sends what we need.
        # For now, let's assume we are mostly updating name/role/photo.
        # If team update is needed, we'd need team_id.
        # Let's keep it simple: Name, Role, Photo URL.
        
        if not update_fields:
             return {"message": "No changes provided"}

        values.append(player_id)
        query = f"UPDATE players SET {', '.join(update_fields)} WHERE id = ${idx}"
        
        await db.execute(query, *values)
        
        return {"status": "success", "message": "Player updated successfully"}

# Add imports if missing at the top, but we will assume they are there or add them.
# We need: UploadFile, File, shutil, os, uuid
# Checking file content... existing imports: APIRouter, HTTPException, BaseModel, Optional, List, asyncpg, database.
# Missing: UploadFile, File, shutil, os, uuid. 
# I will fix imports in a multi_replace if needed, but for now let's add the function and I'll check imports.

@router.post("/players/{player_id}/upload_photo")
async def upload_player_photo(player_id: int, file: UploadFile = File(...)):
    import shutil
    import os
    import uuid
    
    # Define absolute paths (similar to teams.py)
    BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__))) # backend/
    PROJECT_DIR = os.path.dirname(BASE_DIR) # root
    PLAYER_IMG_DIR = os.path.join(PROJECT_DIR, "frontend", "static", "player_images")
    
    os.makedirs(PLAYER_IMG_DIR, exist_ok=True)
    
    try:
        if not file.content_type.startswith("image/"):
            raise HTTPException(status_code=400, detail="File must be an image")

        extension = file.filename.split(".")[-1]
        if not extension: extension = "png"
        
        unique_name = f"player_{player_id}_{uuid.uuid4().hex[:8]}.{extension}"
        file_path = os.path.join(PLAYER_IMG_DIR, unique_name)

        with open(file_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)

        public_url = f"/static/player_images/{unique_name}"

        async with database.db_pool.acquire() as db:
            await db.execute("UPDATE players SET photo_url = $1 WHERE id = $2", public_url, player_id)

        return {"status": "success", "photo_url": public_url}

    except Exception as e:
        print(f"Upload Error: {e}")
        return {"status": "error", "message": str(e)}
