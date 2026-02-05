import os
import asyncpg
from dotenv import load_dotenv

# 1. Load Environment Variables
# Load from parent directory .env (root of potential deployment or project)
# Adjust path if .env is inside backend/
load_dotenv() 

# 2. Get Database URL
DATABASE_URL = os.getenv("DATABASE_URL")
if not DATABASE_URL:
    # Fallback to direct string if env not set (for development continuity only - not best practice)
    DATABASE_URL = "postgresql://postgres:postgres@127.0.0.1:5432/postgres"
    print("Warning: DATABASE_URL not found in .env, using fallback.")

db_pool = None

async def init_db():
    global db_pool
    try:
        # Memory Optimization: Limit pool size for 2GB RAM VPS
        db_pool = await asyncpg.create_pool(
            DATABASE_URL, 
            min_size=1, 
            max_size=10, 
            statement_cache_size=0
        )
        print("✅ Database connection pool initialized.")
        return db_pool
    except Exception as e:
        print(f"❌ Error initializing database pool: {e}")
        db_pool = None
        return None

async def close_db():
    global db_pool
    if db_pool:
        await db_pool.close()
        print("✅ Database connection pool closed.")
    db_pool = None

async def get_db_pool():
    return db_pool
