from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import RedirectResponse
from contextlib import asynccontextmanager
import os
from database import init_db, close_db
from routes import matches, scoring, teams
from routes.buttons import undo

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

# --- Include Routers ---
app.include_router(matches.router, prefix="/api", tags=["Matches"])
app.include_router(scoring.router, prefix="/api", tags=["Scoring"])
app.include_router(teams.router, prefix="/api", tags=["Teams"])
app.include_router(undo.router, prefix="/api", tags=["Buttons"])

# Import players router inside to avoid circular imports layout if any, or just at top
from routes import players, commentary
app.include_router(players.router, prefix="/api", tags=["Players"])
app.include_router(commentary.router, prefix="/api", tags=["Commentary"])

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
# This must be the last mount as it catches all root requests
pages_path = os.path.join(FRONTEND_DIR, "pages")
if os.path.exists(pages_path):
    app.mount("/", StaticFiles(directory=pages_path, html=True), name="pages")
else:
    print(f"Warning: Pages directory not found at {pages_path}")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
