import asyncio
import asyncpg
from backend.database import db_pool

# Hardcoded DB Config for standalone script usage if needed, 
# but we will try to rely on the existing pool configuration if possible.
# However, importing db_pool from backend.database might need the loop to be running.
# Let's try a direct connection approach to be safe and standalone.

DB_CONFIG = {
    "user": "postgres",
    "password": "password",
    "database": "postgres",
    "host": "localhost",
    "port": "5432"
}

async def migrate_db():
    print("Connecting to database...")
    try:
        conn = await asyncpg.connect(**DB_CONFIG)
        print("Connected.")
        
        # Check if column exists
        row = await conn.fetchrow("""
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_name='teams' AND column_name='team_color';
        """)
        
        if not row:
            print("Column 'team_color' not found. Adding it...")
            await conn.execute("""
                ALTER TABLE teams 
                ADD COLUMN team_color TEXT DEFAULT '#00bfff';
            """)
            print("Column added successfully.")
        else:
            print("Column 'team_color' already exists.")

        # Optional: Set defaults for NULLs
        print("Ensuring no NULL values...")
        await conn.execute("UPDATE teams SET team_color = '#00bfff' WHERE team_color IS NULL")
        print("Done.")

        await conn.close()
        
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    asyncio.run(migrate_db())
