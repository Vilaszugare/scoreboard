import asyncio
import os
from database import init_db, close_db, get_db_pool

async def migrate_players():
    print("Migrating players table...")
    pool = await init_db()
    if not pool:
        print("❌ Failed to initialize DB pool.")
        return

    try:
        async with pool.acquire() as conn:
            await conn.execute("ALTER TABLE players ADD COLUMN IF NOT EXISTS photo_url TEXT DEFAULT NULL;")
            print("✅ 'photo_url' column added (or already existed).")
    except Exception as e:
        print(f"❌ Migration failed: {e}")
    finally:
        await close_db()

if __name__ == "__main__":
    asyncio.run(migrate_players())
