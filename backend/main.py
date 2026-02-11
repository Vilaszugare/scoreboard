from fastapi import FastAPI
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import RedirectResponse
from contextlib import asynccontextmanager
import os
from fastapi.responses import StreamingResponse
from sse_manager import manager
import asyncio
from database import init_db, close_db
from routes import matches, scoring, teams
from routes.buttons import undo
import psutil



@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    await init_db()
    yield
    # Shutdown
    await close_db()

app = FastAPI(lifespan=lifespan)

# --- CORS Setup ---
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- Performance: Compress large JSON responses ---
# minimum_size=1000 means only compress responses larger than 1KB
app.add_middleware(GZipMiddleware, minimum_size=1000)

# --- Include Routers ---
app.include_router(matches.router, prefix="/api", tags=["Matches"])
app.include_router(scoring.router, prefix="/api", tags=["Scoring"])
app.include_router(teams.router, prefix="/api", tags=["Teams"])
app.include_router(undo.router, prefix="/api", tags=["Buttons"])
from routes import match_settings_routes
app.include_router(match_settings_routes.router, prefix="/api", tags=["Settings"])

# Import players router inside to avoid circular imports layout if any, or just at top
from routes import players, commentary
app.include_router(players.router, prefix="/api", tags=["Players"])
app.include_router(commentary.router, prefix="/api", tags=["Commentary"])

# --- SSE STREAM ENDPOINT ---
@app.get("/api/stream/{match_id}")
async def stream_match_data(match_id: int):
    """
    SSE Endpoint: Viewers connect here to get live updates.
    This holds the connection open but consumes negligible CPU (Zero-Load).
    """
    async def event_generator():
        # 1. Subscribe this client
        q = await manager.subscribe(match_id)
        try:
            while True:
                # 2. Wait for data (yields control, zero loop overhead)
                data = await q.get()
                yield data
        except asyncio.CancelledError:
            # 3. Handle disconnect (Tab closed)
            await manager.unsubscribe(match_id, q)

    return StreamingResponse(event_generator(), media_type="text/event-stream")

# --- Serve Static Files ---
# 1. Mount /static for assets (CSS, JS, Images)
# Determine the base directory (backend/) and the project root
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
FRONTEND_DIR = os.path.abspath(os.path.join(BASE_DIR, "..", "frontend"))

# 1. Mount /static for assets (CSS, JS, Images)
static_path = os.path.join(FRONTEND_DIR, "static")
if os.path.exists(static_path):
    app.mount("/static", StaticFiles(directory=static_path), name="static")
else:
    print(f"Warning: Static directory not found at {static_path}")

# 2. Mount / (root) to frontend/pages for HTML files
@app.get("/memory")
def memory_usage():
    process = psutil.Process(os.getpid())
    ram_mb = process.memory_info().rss / 1024 / 1024
    return {
        "ram_used_mb": round(ram_mb, 2)
    }



def get_ram_usage_mb():
    process = psutil.Process(os.getpid())
    return process.memory_info().rss / 1024 / 1024


# This must be the last mount as it catches all root requests
pages_path = os.path.join(FRONTEND_DIR, "pages")
if os.path.exists(pages_path):
    app.mount("/", StaticFiles(directory=pages_path, html=True), name="pages")
else:
    print(f"Warning: Pages directory not found at {pages_path}")



if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
