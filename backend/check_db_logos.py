
import asyncio
import asyncpg
import os

DATABASE_URL = "postgresql://postgres:postgres@127.0.0.1:5432/postgres"

async def check_schema():
    try:
        conn = await asyncpg.connect(DATABASE_URL)
        print("Connected to DB.")
        
        # Check columns
        rows = await conn.fetch("""
            SELECT column_name, data_type 
            FROM information_schema.columns 
            WHERE table_name = 'teams'
            ORDER BY ordinal_position
        """)
        
        print("\nColumns in 'teams' table:")
        for r in rows:
            print(f"- {r['column_name']} ({r['data_type']})")
            
        print("\nChecking if 'logo' column exists via direct query...")
        try:
            # Try selecting just ID first
            await conn.fetch("SELECT id FROM teams LIMIT 1")
            print("SELECT id works.")
            
            # Try selecting logo
            await conn.fetch("SELECT logo FROM teams LIMIT 1")
            print("SELECT logo works.")
            
            # Try selecting logo_url
            await conn.fetch("SELECT logo_url FROM teams LIMIT 1")
            print("SELECT logo_url works.")
            
        except Exception as qe:
            print(f"Query check failed: {qe}")

        await conn.close()
    except Exception as e:
        print(f"Connection Error: {e}")

if __name__ == "__main__":
    asyncio.run(check_schema())
