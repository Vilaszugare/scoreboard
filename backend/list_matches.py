import asyncio
import database
import sys

# Windows Loop Policy Fix
if sys.platform == 'win32':
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

async def main():
    try:
        await database.init_db()
        async with database.db_pool.acquire() as conn:
            rows = await conn.fetch("SELECT id, team_a_id, team_b_id FROM matches ORDER BY id")
            print("MATCHES FOUND:")
            for r in rows:
                print(f"ID: {r['id']} (Team {r['team_a_id']} vs Team {r['team_b_id']})")
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    asyncio.run(main())
