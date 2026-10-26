"""Runtime configuration. Everything is environment driven; nothing about any
specific repository is hardcoded anywhere in the backend."""

import os
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

ROOT = Path(__file__).resolve().parent.parent

try:  # python-dotenv is optional
    from dotenv import load_dotenv

    load_dotenv(ROOT / ".env")
except ImportError:
    pass


def _int(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, default))
    except (TypeError, ValueError):
        return default


def github_token() -> Optional[str]:
    return os.getenv("GITHUB_TOKEN") or os.getenv("GH_TOKEN") or None


def cache_dir() -> Path:
    return Path(os.getenv("EQUINOX_CACHE_DIR") or ROOT / ".cache" / "equinox")


def cache_ttl() -> int:
    return _int("EQUINOX_CACHE_TTL", 3600)


def include_bots() -> bool:
    return os.getenv("EQUINOX_INCLUDE_BOTS", "0") == "1"


def use_chroma() -> str:
    """'0' disables Chroma, '1' forces it, 'auto' uses it when importable."""
    return os.getenv("EQUINOX_USE_CHROMA", "auto").lower()


@dataclass(frozen=True)
class Limits:
    commit_window: int      # commits listed (1 API call, max 100)
    commit_details: int     # commits fetched individually for file lists (1 call each)
    pull_requests: int      # PRs listed (1 API call)
    pr_reviews: int         # PRs whose reviews are fetched (1 call each)
    files_parsed: int       # source files parsed with Tree-sitter (raw fetch, free)
    max_file_bytes: int = 250_000
    bulk_commit_files: int = 60  # commits touching more files are ignored for co-edit edges


def limits(has_token: bool) -> Limits:
    # Unauthenticated GitHub quota is 60 requests/hour, so budgets are small without a token.
    d = (100, 40, 30, 20, 15) if has_token else (60, 12, 15, 6, 8)
    return Limits(
        commit_window=min(100, _int("EQUINOX_COMMIT_WINDOW", d[0])),
        commit_details=_int("EQUINOX_COMMIT_DETAILS", d[1]),
        pull_requests=min(100, _int("EQUINOX_PULL_REQUESTS", d[2])),
        pr_reviews=_int("EQUINOX_PR_REVIEWS", d[3]),
        files_parsed=_int("EQUINOX_FILES_PARSED", d[4]),
    )
