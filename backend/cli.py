"""Equinox - Python CLI (JSON on stdout). Exit code 2 + {"status":"error"} on failure."""

import argparse
import json
import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from backend import service  # noqa: E402
from backend.github_client import GitHubError  # noqa: E402


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="Equinox graph & RAG engine")
    sub = p.add_subparsers(dest="command", required=True)
    a = sub.add_parser("analyze")
    a.add_argument("--repo", required=True, help="owner/repo or GitHub URL")
    a.add_argument("--depth", type=int, default=2, help="1-5")
    a.add_argument("--refresh", action="store_true", help="ignore cached data")
    r = sub.add_parser("rag")
    r.add_argument("--repo", required=True)
    r.add_argument("--query", required=True)
    r.add_argument("--author", default=None)
    x = sub.add_parser("xai")
    x.add_argument("--repo", required=True)
    x.add_argument("--contributor", required=True)
    d = sub.add_parser("pdf-data")
    d.add_argument("--repo", required=True)
    return p


def run(args) -> dict:
    if args.command == "analyze":
        return service.analyze_payload(args.repo, args.depth, args.refresh)
    if args.command == "rag":
        return service.rag_payload(args.repo, args.query, args.author)
    if args.command == "xai":
        return service.xai_payload(args.repo, args.contributor)
    return service.pdf_payload(args.repo)


def main(argv=None) -> int:
    args = build_parser().parse_args(argv)
    try:
        out = run(args)
        sys.stdout.write(json.dumps(out))
        return 0
    except GitHubError as e:
        sys.stdout.write(json.dumps({"status": "error", "kind": e.kind, "error": str(e)}))
    except ValueError as e:
        sys.stdout.write(json.dumps({"status": "error", "kind": "invalid", "error": str(e)}))
    except Exception as e:  # unexpected: still emit machine-readable JSON
        sys.stdout.write(json.dumps({"status": "error", "kind": "internal", "error": f"{type(e).__name__}: {e}"}))
    return 2


if __name__ == "__main__":
    sys.exit(main())
