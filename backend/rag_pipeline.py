"""Equinox - citation-grounded RAG over the analysed repository.

Primary retriever: TF-IDF cosine (deterministic, no model download).
Optional: ChromaDB (persistent, one collection per repo snapshot). If Chroma is
missing, disabled, or fails (e.g. embedding model cannot be downloaded) retrieval
silently falls back to TF-IDF. Irrelevant documents are never returned.
"""

import hashlib
import math
import re
from collections import Counter
from typing import Any, Dict, List, Optional

from backend import config
from backend.xai import contributor_profile, build_summary

_STOP = {"the", "a", "an", "in", "on", "of", "to", "for", "and", "or", "is", "was", "it", "with", "by", "this",
         "that", "what", "who", "how", "do", "i", "me", "my", "does", "are", "be", "about", "should"}


def tokenize(text: str) -> List[str]:
    out: List[str] = []
    for w in re.findall(r"[A-Za-z0-9_./#-]+", text):
        spaced = re.sub(r"([a-z0-9])([A-Z])", r"\1 \2", w)
        parts = [p.lower() for p in re.findall(r"[A-Za-z]+|\d+", spaced)]
        full = w.lower().strip("._-/#")
        out += parts
        if full and full not in parts:
            out.append(full)
    return [t for t in out if len(t) > 1 and t not in _STOP]


class RAGPipeline:
    def __init__(self, repo_key: str, persist_dir=None):
        self.repo_key = repo_key
        self.documents: List[Dict[str, Any]] = []
        self.retriever = "tfidf"
        self.chroma_error: Optional[str] = None
        self._idf: Dict[str, float] = {}
        self._vecs: List[Dict[str, float]] = []
        self._collection = None
        self._persist_dir = persist_dir or (config.cache_dir() / "chroma")

    # ---------------------------------------------------------------- ingestion
    def ingest(self, state: Dict[str, Any]) -> "RAGPipeline":
        url = state["repo_url"]
        head = state.get("head_sha") or state.get("default_branch")
        docs: List[Dict[str, Any]] = []

        for c in state["commits"]:
            files = ", ".join(c.get("files", [])[:6])
            docs.append({"id": f"commit_{c['sha']}", "type": "commit", "citation": f"[Commit #{c['short']}]",
                         "text": f"Commit {c['short']} by {c.get('author') or c.get('author_name')} on {c['date']}: "
                                 f"{c['message']}." + (f" Files: {files}." if files else ""),
                         "people": [c["author"]] if c.get("author") else [], "url": c["url"]})
        for p in state["prs"]:
            people = [x for x in [p.get("author")] + p.get("reviewers", []) if x]
            docs.append({"id": f"pr_{p['id']}", "type": "pull_request", "citation": f"[PR #{p['id']}]",
                         "text": f"PR #{p['id']} ({p['state']}) by {p.get('author')}: {p['title']}. "
                                 f"Reviewers: {', '.join(p.get('reviewers', [])) or 'none recorded'}. {p.get('body', '')}",
                         "people": people, "url": p["pr_url"]})
        for fn in state["ast_functions"]:
            owners = ", ".join(f"{o['contributor']} {o['pct']:.0f}%" for o in fn.get("ownership_breakdown", [])) or "unknown"
            basis = {"blame": "git blame", "file-commits": "file commit history"}.get(fn.get("ownership_basis"), "no ownership data")
            docs.append({"id": f"ast_{fn['file_path']}_{fn['name']}_{fn['start_line']}", "type": "ast_function",
                         "citation": f"[AST: {fn['name']}() in {fn['file_path']}:L{fn['start_line']}]",
                         "text": f"Function {fn['name']} in {fn['file_path']} lines {fn['start_line']}-{fn['end_line']} "
                                 f"({fn.get('language')}). Signature: {fn.get('signature', '')}. "
                                 f"Owners ({basis}): {owners}. Cyclomatic complexity {fn.get('cyclomatic_complexity', 1)}.",
                         "people": [o["contributor"] for o in fn.get("ownership_breakdown", [])],
                         "url": fn.get("github_url")})
        for f in state["files"]:
            by = ", ".join(f"{k} ({v})" for k, v in sorted(f.get("contributor_commits", {}).items(), key=lambda kv: -kv[1])[:4])
            docs.append({"id": f"file_{f['path']}", "type": "file", "citation": f"[File: {f['path']}]",
                         "text": f"File {f['path']} ({f.get('language')}). "
                                 + (f"Recent commits by: {by}." if by else "No commits in the sampled history."),
                         "people": list(f.get("contributor_commits", {}).keys()), "url": f.get("file_url")})
        for c in state["contributors"]:
            try:
                prof = contributor_profile(state, c["id"])
            except ValueError:
                continue
            docs.append({"id": f"contributor_{c['id']}", "type": "contributor", "citation": f"[Contributor: {c['id']}]",
                         "text": f"Contributor {c['id']}. " + build_summary(prof).replace("\n", " "),
                         "people": [c["id"]], "url": c.get("profile_url")})
        self.documents = docs
        self._build_tfidf()
        return self

    def _build_tfidf(self) -> None:
        toks = [tokenize(d["text"] + " " + " ".join(d["people"])) for d in self.documents]
        n = len(toks)
        df = Counter(t for ts in toks for t in set(ts))
        self._idf = {t: math.log((n + 1) / (c + 1)) + 1.0 for t, c in df.items()}
        self._vecs = []
        for ts in toks:
            tf = Counter(ts)
            v = {t: (1 + math.log(c)) * self._idf[t] for t, c in tf.items()}
            norm = math.sqrt(sum(x * x for x in v.values())) or 1.0
            self._vecs.append({t: x / norm for t, x in v.items()})

    # ------------------------------------------------------------------ chroma
    def _init_chroma(self, fingerprint: str) -> None:
        mode = config.use_chroma()
        if mode == "0" or not self.documents:
            return
        try:
            import chromadb  # lazy: slow import, only needed for RAG queries

            client = chromadb.PersistentClient(path=str(self._persist_dir))
            name = "eq_" + hashlib.sha1(f"{self.repo_key}:{fingerprint}".encode()).hexdigest()[:24]
            col = client.get_or_create_collection(name)
            if col.count() != len(self.documents):
                client.delete_collection(name)
                col = client.create_collection(name)
                col.add(ids=[d["id"] for d in self.documents], documents=[d["text"] for d in self.documents],
                        metadatas=[{"type": d["type"], "citation": d["citation"]} for d in self.documents])
            self._collection = col
            self.retriever = "chroma"
        except Exception as e:  # missing package, offline model download, etc.
            self._collection, self.retriever, self.chroma_error = None, "tfidf", str(e)[:200]

    def enable_chroma(self, fingerprint: str) -> None:
        self._init_chroma(fingerprint)

    # --------------------------------------------------------------- retrieval
    def retrieve(self, query: str, top_k: int = 5, focus: Optional[str] = None) -> List[Dict[str, Any]]:
        if not self.documents:
            return []
        focus_l = focus.lower() if focus else None

        def allowed(d):
            return not focus_l or any(p.lower() == focus_l for p in d["people"])

        if self._collection is not None:
            try:
                res = self._collection.query(query_texts=[query], n_results=min(len(self.documents), top_k * 6))
                by_id = {d["id"]: d for d in self.documents}
                hits = [by_id[i] for i in (res.get("ids") or [[]])[0] if i in by_id and allowed(by_id[i])]
                if hits:
                    return hits[:top_k]
            except Exception as e:
                self._collection, self.retriever, self.chroma_error = None, "tfidf", str(e)[:200]

        q = Counter(tokenize(query))
        qv = {t: (1 + math.log(c)) * self._idf[t] for t, c in q.items() if t in self._idf}
        qn = math.sqrt(sum(x * x for x in qv.values()))
        if not qv or qn == 0:
            return []
        scored = []
        for d, v in zip(self.documents, self._vecs):
            if not allowed(d):
                continue
            s = sum(w * v.get(t, 0.0) for t, w in qv.items()) / qn
            if s > 0:
                scored.append((s, d))
        scored.sort(key=lambda x: -x[0])
        return [d for _, d in scored[:top_k]]

    # ----------------------------------------------------------------- prompts
    def build_prompt(self, query: str, docs: List[Dict[str, Any]], focus: Optional[str] = None) -> str:
        ctx = "\n".join(f"- {d['citation']} {d['text']}" for d in docs) or "(no evidence retrieved)"
        focus_note = f"Focus on contributor '{focus}'.\n" if focus else ""
        return (
            "You are the Equinox onboarding assistant for a GitHub repository.\n"
            "Answer ONLY from the evidence below. Cite every claim with its bracketed citation exactly as written.\n"
            "If the evidence does not answer the question, say so plainly. Do not invent files, functions or people.\n"
            "End with 1-3 concrete next steps (who to ask, which function/file to read).\n\n"
            f"EVIDENCE:\n{ctx}\n\n{focus_note}QUESTION: {query}\n\nANSWER:\n")

    @staticmethod
    def extractive_answer(query: str, docs: List[Dict[str, Any]], focus: Optional[str] = None) -> str:
        if not docs:
            return "No evidence in the analysed history matches this question."
        lines = [f"{d['citation']} {d['text']}" for d in docs]
        people = Counter(p for d in docs for p in d["people"] if p and p != focus)
        nxt = (f"Suggested next step: read the cited files/functions, then ask {people.most_common(1)[0][0]} "
               f"(appears most across the evidence).") if people else "Suggested next step: read the cited sources."
        return "\n".join(lines) + "\n\n" + nxt
