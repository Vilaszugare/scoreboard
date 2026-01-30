import asyncio
import os
from database import init_db, close_db, get_db_pool

async def apply_indexes():
    print("Applying Indexes...")
    pool = await init_db()
    if not pool:
        print("❌ Failed to initialize DB pool.")
        return

    try:
        with open("indexes.sql", "r") as f:
            sql = f.read()
            
        async with pool.acquire() as conn:
            await conn.execute(sql)
            print("✅ Indexes applied successfully.")
    except Exception as e:
        print(f"❌ Index creation failed: {e}")
    finally:
        await close_db()

if __name__ == "__main__":
    asyncio.run(apply_indexes())
