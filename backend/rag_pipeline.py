
from typing import Dict, List, Any, Optional, Tuple
import math
import re
import json

try:
    import chromadb
    from chromadb.config import Settings
    HAS_CHROMADB = True
except ImportError:
    HAS_CHROMADB = False


class RAGPipeline:
    
    def __init__(self, collection_name: str = "equinox_repo_knowledge"):
        self.collection_name = collection_name
        self.documents: List[Dict[str, Any]] = []
        self.vocabulary: Dict[str, int] = {}
        self.idf: Dict[str, float] = {}

        if HAS_CHROMADB:
            try:
                self.client = chromadb.Client(Settings(anonymized_telemetry=False))
                self.collection = self.client.get_or_create_collection(name=collection_name)
            except Exception:
                self.collection = None
        else:
            self.collection = None

    def ingest_knowledge_base(
        self,
        commits: List[Dict[str, Any]],
        prs: List[Dict[str, Any]],
        ast_functions: List[Dict[str, Any]],
        files: List[Dict[str, Any]]
    ):
        """
        Chunks and indexes repository evidence into the vector store.
        """
        docs_to_add = []

        # Index Commits
        for c in commits:
            text = f"Commit {c['sha'][:7]} by {c['author']}: {c['message']}. Files modified: {', '.join(c.get('files', []))}"
            docs_to_add.append({
                "id": f"commit_{c['sha']}",
                "text": text,
                "type": "commit",
                "citation": f"[Commit #{c['sha'][:7]}]",
                "metadata": {
                    "author": c["author"],
                    "sha": c["sha"],
                    "date": c.get("date", ""),
                    "files": c.get("files", [])
                }
            })

        # Index Pull Requests
        for pr in prs:
            reviewers = ", ".join(pr.get("reviewers", []))
            text = f"PR #{pr['id']} ({pr.get('state', 'merged')}): {pr['title']}. Author: {pr['author']}, Reviewers: {reviewers}. Summary: {pr.get('body', '')}"
            docs_to_add.append({
                "id": f"pr_{pr['id']}",
                "text": text,
                "type": "pull_request",
                "citation": f"[PR #{pr['id']}]",
                "metadata": {
                    "author": pr["author"],
                    "reviewers": pr.get("reviewers", []),
                    "pr_id": pr["id"]
                }
            })

        # Index AST Function definitions
        for fn in ast_functions:
            text = (
                f"Function {fn['name']} in file {fn['file_path']} (lines {fn['start_line']}-{fn['end_line']}). "
                f"Primary Owner: {fn.get('primary_owner', 'Unassigned')} ({fn.get('primary_ownership_pct', 100)}%). "
                f"Parameters: {', '.join(fn.get('parameters', []))}. "
                f"Docstring: {fn.get('docstring_preview', '')}. Complexity: {fn.get('cyclomatic_complexity', 1)}"
            )
            docs_to_add.append({
                "id": f"ast_{fn['file_path']}_{fn['name']}",
                "text": text,
                "type": "ast_function",
                "citation": f"[AST: {fn['name']}() in {fn['file_path']}:L{fn['start_line']}]",
                "metadata": {
                    "function_name": fn["name"],
                    "file_path": fn["file_path"],
                    "owner": fn.get("primary_owner", "Unassigned"),
                    "lines": f"{fn['start_line']}-{fn['end_line']}"
                }
            })

        # Index Module Files
        for f in files:
            text = f"File {f['path']} ({f.get('language', 'Code')}). Primary contributors: {', '.join(f.get('contributors', []))}. Description: {f.get('summary', 'Source code file')}"
            docs_to_add.append({
                "id": f"file_{f['path']}",
                "text": text,
                "type": "file",
                "citation": f"[File: {f['path']}]",
                "metadata": {
                    "file_path": f["path"],
                    "language": f.get("language", "")
                }
            })

        self.documents = docs_to_add

        # If ChromaDB collection exists, add documents
        if self.collection:
            try:
                ids = [d["id"] for d in docs_to_add]
                texts = [d["text"] for d in docs_to_add]
                metas = [{"type": d["type"], "citation": d["citation"], "author": d["metadata"].get("author", "")} for d in docs_to_add]
                self.collection.add(ids=ids, documents=texts, metadatas=metas)
            except Exception:
                pass

        # Compute internal TF-IDF vector index
        self._build_tfidf_index()

    def _tokenize(self, text: str) -> List[str]:
        tokens = re.findall(r'[a-zA-Z0-9_\-\.#]+', text.lower())
        stopwords = {"the", "a", "an", "in", "on", "of", "to", "for", "and", "or", "is", "was", "it", "with", "by", "this", "that"}
        return [t for t in tokens if t not in stopwords and len(t) > 1]

    def _build_tfidf_index(self):
        doc_count = len(self.documents)
        if doc_count == 0:
            return

        df: Dict[str, int] = {}
        for doc in self.documents:
            tokens = set(self._tokenize(doc["text"]))
            for t in tokens:
                df[t] = df.get(t, 0) + 1

        self.idf = {t: math.log((doc_count + 1) / (freq + 1)) + 1.0 for t, freq in df.items()}

    def retrieve(self, query: str, top_k: int = 5, filter_author: Optional[str] = None) -> List[Dict[str, Any]]:
        if not self.documents:
            return []

        if self.collection:
            try:
                where_filter = {"author": filter_author} if filter_author else None
                res = self.collection.query(query_texts=[query], n_results=top_k, where=where_filter)
                if res and res["ids"] and len(res["ids"][0]) > 0:
                    matched_ids = set(res["ids"][0])
                    return [d for d in self.documents if d["id"] in matched_ids][:top_k]
            except Exception:
                pass

        # Fallback TF-IDF cosine similarity search
        query_tokens = self._tokenize(query)
        q_weights: Dict[str, float] = {}
        for t in query_tokens:
            if t in self.idf:
                q_weights[t] = q_weights.get(t, 0) + self.idf[t]

        scores = []
        for doc in self.documents:
            if filter_author and doc["metadata"].get("author") and doc["metadata"].get("author") != filter_author:
                continue

            doc_tokens = self._tokenize(doc["text"])
            dot_product = 0.0
            doc_norm = math.sqrt(len(doc_tokens)) or 1.0

            for t in doc_tokens:
                if t in q_weights:
                    dot_product += q_weights[t] * self.idf.get(t, 1.0)

            # Bonus for exact token matches in metadata
            if filter_author and filter_author.lower() in doc["text"].lower():
                dot_product += 2.0

            sim = dot_product / doc_norm
            scores.append((sim, doc))

        scores.sort(key=lambda x: x[0], reverse=True)
        return [doc for score, doc in scores[:top_k] if score > 0] or [d for _, d in scores[:top_k]]

    def generate_xai_summary(
        self,
        contributor: Dict[str, Any],
        top_functions: List[Dict[str, Any]],
        repo_name: str = "equinox-core",
        authored_files: Optional[List[str]] = None,
        recent_commits: Optional[List[Dict[str, Any]]] = None
    ) -> str:
        """
        XAI Feature: Generates a 2-line summary strictly matching the given repo and the contributor's actual work.
        """
        cid = contributor.get("name") or contributor.get("id", "Contributor")
        role = contributor.get("role") or contributor.get("domain", "Core Contributor")
        desc = contributor.get("key_contribution")
        
        owned_fns = [f["name"] for f in top_functions if f.get("primary_owner") == cid or f.get("primary_owner") == contributor.get("id")][:3]
        files = authored_files or contributor.get("authored_files", [])
        commits = recent_commits or contributor.get("recent_commits", [])

        # Line 1: Explicitly describe their role and specific key contribution in the repository
        if desc:
            clean_desc = desc.strip().rstrip(".")
            line1 = f"{cid} served as the {role} in {repo_name}, specifically: {clean_desc}."
        else:
            line1 = f"{cid} is an active core contributor to {repo_name}, leading {role}."

        # Line 2: Architectural and code-level impact
        if owned_fns and files:
            file_names = [f.split('/')[-1] for f in files[:2]]
            line2 = f"Their architectural impact centers on {', '.join([f'{f}()' for f in owned_fns])} across {', '.join(file_names)}, establishing the core functionality of {repo_name}."
        elif owned_fns:
            line2 = f"Their code establishes key functions ({', '.join([f'{f}()' for f in owned_fns])}), providing critical operational logic for {repo_name}."
        elif files:
            file_names = [f.split('/')[-1] for f in files[:3]]
            line2 = f"They maintain foundational modules ({', '.join(file_names)}), ensuring system reliability and smooth code review lifecycles."
        else:
            commits_cnt = contributor.get("commits_count", 1)
            prs_cnt = contributor.get("prs_reviewed", 0)
            line2 = f"Across {commits_cnt} commits and {prs_cnt} peer reviews, their contributions maintain the primary stability and release readiness of {repo_name}."

        return f"{line1}\n{line2}"

    def build_rag_prompt(self, query: str, context_docs: List[Dict[str, Any]], contributor_focus: Optional[str] = None) -> str:
        """
        Formats retrieved repository evidence into a strict citation-grounded RAG prompt.
        """
        context_str = "\n".join([f"- {d['citation']} {d['text']}" for d in context_docs])
        focus_note = f"Focus strictly on contributor '{contributor_focus}' and their connected modules." if contributor_focus else ""

        prompt = f"""You are the Equinox RAG Onboarding Assistant for this software repository.
Answer the user's question using ONLY the retrieved repository evidence below.
You MUST cite your evidence using the provided citations such as [Commit #...], [AST: func() in file:line], or [PR #...].
Suggest concrete developer onboarding next steps (e.g. what functions to modify, who to request reviews from).
Do not hallucinate or reference packages outside the repository context.

RETRIEVED REPOSITORY EVIDENCE:
{context_str}

USER QUERY:
{query}
{focus_note}

GROUNDED EXPLANATION & SUGGESTED ACTION:
"""
        return prompt
