"""Equinox - FastAPI service (`uvicorn backend.main:app`). Same routes/shapes as server.ts."""

import os
import sys
from datetime import datetime, timezone
from typing import Optional

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from fastapi import FastAPI, HTTPException  # noqa: E402
from pydantic import BaseModel  # noqa: E402

from backend import service  # noqa: E402
from backend.github_client import GitHubError  # noqa: E402

app = FastAPI(title="Equinox Contributor Graph Service")
_STATUS = {"not_found": 404, "rate_limit": 429, "auth": 401}


def _guard(fn, *a, **k):
    try:
        return fn(*a, **k)
    except ValueError as e:
        raise HTTPException(400, str(e))
    except GitHubError as e:
        raise HTTPException(_STATUS.get(e.kind, 502), str(e))


class AnalyzeReq(BaseModel):
    repoUrl: str
    depth: int = 2
    refresh: bool = False


class XaiReq(BaseModel):
    repoName: str
    contributorId: Optional[str] = None
    contributorName: Optional[str] = None


class RagReq(BaseModel):
    repoName: str
    query: str
    contributorFocus: Optional[str] = None


class PdfReq(BaseModel):
    repoName: str


@app.get("/api/health")
def health():
    return {"ok": True}


@app.post("/api/analyze-repo")
def analyze(req: AnalyzeReq):
    data = _guard(service.analyze_payload, req.repoUrl, req.depth, req.refresh)
    return {"success": True, "repo": data["repo_name"], "data": data}


@app.post("/api/xai-summary")
def xai(req: XaiReq):
    r = _guard(service.xai_payload, req.repoName, req.contributorId or req.contributorName or "")
    return {"summary": r["xai_summary"], "source": "evidence-engine", "repo": r["repo_name"], "evidence": r["evidence"]}


@app.post("/api/rag-query")
def rag(req: RagReq):
    r = _guard(service.rag_payload, req.repoName, req.query, req.contributorFocus)
    return {"answer": r["extractive_answer"], "citations": r["citations"], "evidence": r["evidence_documents"],
            "query": req.query, "retriever": r["retriever"]}


@app.post("/api/export-pdf-data")
def pdf(req: PdfReq):
    return {"success": True, "reportData": _guard(service.pdf_payload, req.repoName),
            "generatedAt": datetime.now(timezone.utc).isoformat()}
