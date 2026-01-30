import asyncio
import asyncpg
import os
from dotenv import load_dotenv

# Load environment variables (mimicking backend/database.py behavior if needed, 
# but usually we can just connect assuming standard env vars or hardcoded for this script if env is missing)

# Adjust these to match your project's actual DB credentials if not in env
DB_USER = "postgres"
DB_PASSWORD = "password" # Replace with actual if known, or rely on env
DB_NAME = "cricket_db"
DB_HOST = "localhost"

async def add_columns():
    # Construct DSN or connection params. 
    # Try to load from env first, similar to project
    dsn = os.getenv("DATABASE_URL")
    if not dsn:
        # Fallback to defaults
        dsn = f"postgresql://{DB_USER}:{DB_PASSWORD}@{DB_HOST}/{DB_NAME}"

    print(f"Connecting to: {dsn}")
    
    try:
        conn = await asyncpg.connect(dsn)
        
        queries = [
            "ALTER TABLE matches ADD COLUMN IF NOT EXISTS score_adjustment INTEGER DEFAULT 0;",
            "ALTER TABLE matches ADD COLUMN IF NOT EXISTS wicket_adjustment INTEGER DEFAULT 0;",
            "ALTER TABLE matches ADD COLUMN IF NOT EXISTS ball_adjustment INTEGER DEFAULT 0;",
            "ALTER TABLE matches ADD COLUMN IF NOT EXISTS score_adjustment_inn1 INTEGER DEFAULT 0;",
            "ALTER TABLE matches ADD COLUMN IF NOT EXISTS wicket_adjustment_inn1 INTEGER DEFAULT 0;",
            "ALTER TABLE matches ADD COLUMN IF NOT EXISTS ball_adjustment_inn1 INTEGER DEFAULT 0;"
        ]
        
        for q in queries:
            print(f"Executing: {q}")
            await conn.execute(q)
            
        print("Columns added successfully.")
        await conn.close()
        
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    load_dotenv() # Load from .env if present
    asyncio.run(add_columns())
