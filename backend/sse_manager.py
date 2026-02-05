import asyncio
import json
import logging
from typing import List, Dict

# Setup simple logging
logger = logging.getLogger("uvicorn.error")

class SSEManager:
    """
    Manages active connections for Server-Sent Events (SSE).
    Acts as a 'Radio Station' broadcasting updates to listeners.
    """
    def __init__(self):
        # Maps match_id -> List of client queues
        self.active_listeners: Dict[int, List[asyncio.Queue]] = {}

    async def subscribe(self, match_id: int) -> asyncio.Queue:
        """Client connects: Give them a queue to listen to."""
        q = asyncio.Queue()
        if match_id not in self.active_listeners:
            self.active_listeners[match_id] = []
        
        self.active_listeners[match_id].append(q)
        logger.info(f"🔌 SSE: Client joined Match {match_id}. Total: {len(self.active_listeners[match_id])}")
        return q

    async def unsubscribe(self, match_id: int, q: asyncio.Queue):
        """Client disconnects: Remove their queue."""
        if match_id in self.active_listeners:
            if q in self.active_listeners[match_id]:
                self.active_listeners[match_id].remove(q)
            
            if not self.active_listeners[match_id]:
                del self.active_listeners[match_id]
        
        logger.info(f"🔌 SSE: Client left Match {match_id}.")

    async def broadcast(self, match_id: int, data: dict):
        """Send data to everyone watching this match."""
        if match_id not in self.active_listeners:
            return
        
        # We serialize ONCE to save CPU, then push strings to queues
        # SSE format requires "data: <json>\n\n"
        message = f"data: {json.dumps(data)}\n\n"
        
        for q in self.active_listeners[match_id]:
            await q.put(message)

# Global Instance to be imported elsewhere
manager = SSEManager()