"""Tiny on-disk cache so every CLI invocation (a fresh process) does not re-hit GitHub."""

import json
import os
import re
import tempfile
import time
from typing import Any, Dict, Optional

from backend import config

SCHEMA_VERSION = 4


def _path(key: str):
    safe = re.sub(r"[^A-Za-z0-9_.-]", "__", key.lower())
    return config.cache_dir() / f"{safe}.json"


def load(key: str, ttl: int) -> Optional[Dict[str, Any]]:
    try:
        blob = json.loads(_path(key).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    if blob.get("schema") != SCHEMA_VERSION:
        return None
    if time.time() - blob.get("cached_at", 0) > ttl:
        return None
    return blob.get("state")


def save(key: str, state: Dict[str, Any]) -> None:
    p = _path(key)
    try:
        p.parent.mkdir(parents=True, exist_ok=True)
        fd, tmp = tempfile.mkstemp(dir=str(p.parent), suffix=".tmp")
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            json.dump({"schema": SCHEMA_VERSION, "cached_at": time.time(), "state": state}, fh)
        os.replace(tmp, p)  # atomic
    except OSError:
        pass  # caching is best-effort
