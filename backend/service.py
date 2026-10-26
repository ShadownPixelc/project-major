"""Equinox - service layer shared by the CLI and the FastAPI app."""

from datetime import datetime, timezone
from typing import Any, Dict, Optional

from backend.analyzer import analyze_repository
from backend.graph_engine import build_view
from backend.rag_pipeline import RAGPipeline
from backend.xai import build_summary, citations_for, contributor_profile


def _check_depth(depth: int) -> int:
    if not isinstance(depth, int) or not 1 <= depth <= 5:
        raise ValueError("depth must be an integer between 1 and 5")
    return depth


def analyze_payload(repo: str, depth: int = 2, refresh: bool = False) -> Dict[str, Any]:
    depth = _check_depth(depth)
    s = analyze_repository(repo, refresh=refresh)
    view = build_view(s, depth)
    return {
        "status": "success", "repo_name": s["repo_name"], "repo_url": s["repo_url"], "description": s["description"],
        "stars": s["stars"], "forks": s["forks"], "language": s["language"], "default_branch": s["default_branch"],
        "head_sha": s["head_sha"], "depth": depth, "nodes": view["nodes"], "edges": view["edges"],
        "network_stats": s["network_stats"], "ast_functions": s["ast_functions"], "files": s["files"],
        "commits": s["commits"][:30], "prs": s["prs"][:20], "data_source": s["data_source"],
    }


def xai_payload(repo: str, contributor: str) -> Dict[str, Any]:
    s = analyze_repository(repo)
    prof = contributor_profile(s, contributor)
    return {"status": "success", "repo_name": s["repo_name"], "xai_summary": build_summary(prof),
            "evidence": prof, "citations": citations_for(s, prof), "data_source": s["data_source"]}


def rag_payload(repo: str, query: str, author: Optional[str] = None, top_k: int = 5) -> Dict[str, Any]:
    if not (query or "").strip():
        raise ValueError("query is required")
    s = analyze_repository(repo)
    rag = RAGPipeline(s["repo_name"]).ingest(s)
    rag.enable_chroma(s["head_sha"])
    focus = None
    if author:
        from backend.xai import find_contributor
        c = find_contributor(s, author)
        focus = c["id"] if c else author
    docs = rag.retrieve(query, top_k=top_k, focus=focus)
    return {"status": "success", "repo_name": s["repo_name"], "query": query, "author_focus": focus,
            "retriever": rag.retriever, "citations": [d["citation"] for d in docs], "evidence_documents": docs,
            "extractive_answer": rag.extractive_answer(query, docs, focus),
            "prompt_for_llm": rag.build_prompt(query, docs, focus)}


def pdf_payload(repo: str) -> Dict[str, Any]:
    s = analyze_repository(repo)
    return {"status": "success", "repo_name": s["repo_name"], "repo_url": s["repo_url"],
            "network_stats": s["network_stats"], "contributors": s["contributors"],
            "ast_functions": s["ast_functions"], "files": s["files"][:40], "commits": s["commits"][:8],
            "prs": s["prs"][:6], "data_source": s["data_source"],
            "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds")}
