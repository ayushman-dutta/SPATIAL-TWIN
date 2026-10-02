import asyncpg
from backend.config import settings

# Global pool variable
pool: asyncpg.Pool | None = None

async def connect_to_db():
    global pool
    try:
        pool = await asyncpg.create_pool(dsn=settings.database_url, min_size=2, max_size=10)
        print("Successfully connected to PostGIS database.")
    except Exception as e:
        print(f"Error connecting to database: {e}")
        raise e

async def close_db_connection():
    global pool
    if pool:
        await pool.close()
        print("Database connection closed.")

def get_pool() -> asyncpg.Pool:
    if pool is None:
        raise Exception("Database pool is not initialized.")
    return pool
