from fastapi import APIRouter, UploadFile, File, HTTPException
import shutil
import os
import uuid
import database

from pydantic import BaseModel

class UpdateColorRequest(BaseModel):
    color: str

router = APIRouter()

LOGO_DIR = "../frontend/static/logos"
# Ensure the directory applies to the correct location relative to backend execution
# If running from backend/, ../frontend/static/logos is correct.
# We will ensure absolute path to be safe.
BASE_DIR = os.path.dirname(os.path.abspath(__file__)) # backend/routes
BACKEND_DIR = os.path.dirname(BASE_DIR) # backend
PROJECT_DIR = os.path.dirname(BACKEND_DIR) # root
LOGO_DIR_ABS = os.path.join(PROJECT_DIR, "frontend", "static", "logos")

os.makedirs(LOGO_DIR_ABS, exist_ok=True)

@router.post("/teams/{team_id}/upload_logo")
async def upload_team_logo(team_id: int, file: UploadFile = File(...)):
    try:
        if not file.content_type.startswith("image/"):
            raise HTTPException(status_code=400, detail="File must be an image")

        extension = file.filename.split(".")[-1]
        if not extension: extension = "png"
        
        unique_name = f"team_{team_id}_{uuid.uuid4().hex[:8]}.{extension}"
        file_path = os.path.join(LOGO_DIR_ABS, unique_name)

        with open(file_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)

        # Public URL should be /static/logos/filename
        public_url = f"/static/logos/{unique_name}"

        async with database.db_pool.acquire() as conn:
            # Update BOTH logo and logo_url for compatibility
            await conn.execute("""
                UPDATE teams 
                SET logo = $1, logo_url = $1 
                WHERE id = $2
            """, public_url, team_id)

        return {"status": "success", "logo_url": public_url}

    except Exception as e:
        print(f"Upload Error: {e}")
        return {"status": "error", "message": str(e)}

@router.get("/teams")
async def get_teams():
    try:
        async with database.db_pool.acquire() as conn:
            rows = await conn.fetch("SELECT * FROM teams ORDER BY name")
            return {"teams": [dict(r) for r in rows]}
    except Exception as e:
        print(f"Error getting teams: {e}")
        return {"error": str(e)}

@router.get("/teams/{team_id}/players")
async def get_team_players(team_id: int):
    try:
        async with database.db_pool.acquire() as conn:
            rows = await conn.fetch("SELECT * FROM players WHERE team_id = $1 ORDER BY id", team_id)
            return {"players": [dict(r) for r in rows]}
    except Exception as e:
        print(f"Error getting players for team {team_id}: {e}")
        return {"error": str(e)}

@router.post("/teams/{team_id}/set_color")
async def update_team_color(team_id: int, payload: UpdateColorRequest):
    try:
        async with database.db_pool.acquire() as conn:
            await conn.execute("""
                UPDATE teams 
                SET team_color = $1 
                WHERE id = $2
            """, payload.color, team_id)
            return {"status": "success", "message": f"Color updated to {payload.color}"}
    except Exception as e:
        print(f"Error updating color: {e}")
        return {"error": str(e)}