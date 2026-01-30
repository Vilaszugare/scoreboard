import asyncio
import os
from database import init_db, close_db, get_db_pool

async def migrate():
    print("Starting migration...")
    pool = await init_db()
    if not pool:
        print("❌ Failed to initialize DB pool. Check connection details.")
        return

    try:
        async with pool.acquire() as conn:
            print("Acquired connection.")
            # Verify connectivity
            await conn.fetchval("SELECT 1")
            print("DB Connection verified.")

            print("Checking teams table...")
            await conn.execute("ALTER TABLE teams ADD COLUMN IF NOT EXISTS logo TEXT;")
            print("✅ 'logo' column added (or already existed).")
    except Exception as e:
        print(f"❌ Migration failed: {e}")
    finally:
        await close_db()

if __name__ == "__main__":
    # Ensure we are in the right directory for .env loading if needed
    # But database.py loads .env itself.
    asyncio.run(migrate())
