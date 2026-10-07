"""
Equinox - Python CLI Interface
Provides command-line execution and JSON output for the NetworkX graph engine,
Tree-sitter AST function attribution, and ChromaDB grounded RAG pipeline.
"""

import sys
import os
import json
import argparse

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from backend.graph_engine import ContributorGraphEngine
from backend.tree_sitter_analyzer import TreeSitterAnalyzer
from backend.rag_pipeline import RAGPipeline
from backend.github_client import GitHubClient
from backend.main import create_repository_state


def main():
    parser = argparse.ArgumentParser(description="Equinox Python Graph & RAG Engine CLI")
    subparsers = parser.add_subparsers(dest="command")

    # Command: analyze
    analyze_parser = subparsers.add_parser("analyze", help="Analyze repository and generate graph")
    analyze_parser.add_argument("--repo", default="equinox-core", help="GitHub repo name or URL")
    analyze_parser.add_argument("--depth", type=int, default=2, help="Depth level (1-5)")

    # Command: rag
    rag_parser = subparsers.add_parser("rag", help="Execute grounded RAG query")
    rag_parser.add_argument("--repo", default="equinox-core", help="GitHub repo name or URL")
    rag_parser.add_argument("--query", required=True, help="Developer query")
    rag_parser.add_argument("--author", default=None, help="Contributor focus")

    # Command: xai
    xai_parser = subparsers.add_parser("xai", help="Generate 2-line XAI explanation for contributor")
    xai_parser.add_argument("--repo", default="equinox-core", help="GitHub repo name or URL")
    xai_parser.add_argument("--contributor", required=True, help="Contributor ID or name")

    # Command: pdf-data
    pdf_parser = subparsers.add_parser("pdf-data", help="Generate technical export data for PDF report")
    pdf_parser.add_argument("--repo", default="equinox-core", help="GitHub repo name or URL")

    args = parser.parse_args()

    repo_state = create_repository_state(getattr(args, "repo", "equinox-core"))

    if args.command == "analyze":
        depth = args.depth
        engine = ContributorGraphEngine()
        filtered = engine.filter_by_depth({
            "nodes": repo_state["contributors"],
            "edges": repo_state["edges"]
        }, depth)

        # At higher depths (3, 4, 5), integrate files and AST nodes
        if depth >= 3:
            file_nodes = []
            file_edges = []
            for f in repo_state["files"]:
                file_nodes.append({
                    "id": f["path"],
                    "type": "file",
                    "label": f["path"].split("/")[-1],
                    "full_path": f["path"],
                    "language": f.get("language", "Python"),
                    "lines": f.get("lines", 100),
                    "file_url": f.get("file_url", f"{repo_state.get('repo_url')}/blob/main/{f['path']}"),
                    "color": "#64748b"
                })
                # Link files to their primary contributors
                for c_name in f.get("contributors", []):
                    c_match = next((c for c in repo_state["contributors"] if c["name"] == c_name), None)
                    if c_match:
                        file_edges.append({
                            "source": c_match["id"],
                            "target": f["path"],
                            "weight": 2.0,
                            "type": "authored_file",
                            "color": "#ffd600"
                        })
            filtered["nodes"] = filtered["nodes"] + file_nodes
            filtered["edges"] = filtered["edges"] + file_edges

        if depth >= 4:
            ast_nodes = []
            ast_edges = []
            for fn in repo_state["ast_functions"]:
                ast_id = f"fn_{fn['name']}"
                ast_nodes.append({
                    "id": ast_id,
                    "type": "ast_function",
                    "label": f"{fn['name']}()",
                    "file_path": fn["file_path"],
                    "complexity": fn.get("cyclomatic_complexity", 1),
                    "github_url": fn.get("github_url", f"{repo_state.get('repo_url')}/blob/main/{fn['file_path']}#L{fn['start_line']}"),
                    "color": "#a855f7"
                })
                # Link to owner
                owner_match = next((c for c in filtered["nodes"] if c.get("name") == fn.get("primary_owner") or c.get("id") == fn.get("primary_owner")), None)
                if owner_match:
                    ast_edges.append({
                        "source": owner_match["id"],
                        "target": ast_id,
                        "weight": 3.0,
                        "type": "owns_ast_function",
                        "color": "#00e5ff"
                    })
            filtered["nodes"] = filtered["nodes"] + ast_nodes
            filtered["edges"] = filtered["edges"] + ast_edges

        # Strict validation: ensure all edges have endpoints present in nodes
        final_node_ids = {n["id"] for n in filtered["nodes"]}
        filtered["edges"] = [
            e for e in filtered["edges"]
            if e["source"] in final_node_ids and e["target"] in final_node_ids
        ]

        result = {
            "status": "success",
            "repo_name": repo_state["repo_name"],
            "repo_url": repo_state["repo_url"],
            "depth": depth,
            "nodes": filtered["nodes"],
            "edges": filtered["edges"],
            "network_stats": repo_state["network_stats"],
            "ast_functions": repo_state["ast_functions"],
            "files": repo_state["files"],
            "commits": repo_state.get("commits", [])[:8],
            "prs": repo_state.get("prs", [])[:6]
        }
        print(json.dumps(result))

    elif args.command == "rag":
        rag: RAGPipeline = repo_state["rag_pipeline"]
        docs = rag.retrieve(args.query, top_k=4, filter_author=args.author)
        prompt = rag.build_rag_prompt(args.query, docs, args.author)
        result = {
            "status": "success",
            "query": args.query,
            "author_focus": args.author,
            "citations": [d["citation"] for d in docs],
            "evidence_documents": docs,
            "prompt_for_llm": prompt
        }
        print(json.dumps(result))

    elif args.command == "xai":
        rag: RAGPipeline = repo_state["rag_pipeline"]
        target = args.contributor
        c_match = next((c for c in repo_state["contributors"] if c["id"] == target or c["name"].lower() == target.lower()), None)
        if not c_match:
            c_match = repo_state["contributors"][0]
        
        c_files = [f["path"] for f in repo_state["files"] if c_match["name"] in f.get("contributors", [])]
        c_commits = [c for c in repo_state.get("commits", []) if c.get("author") == c_match["name"]]
        
        xai_summary = rag.generate_xai_summary(
            c_match,
            repo_state["ast_functions"],
            repo_name=repo_state["repo_name"],
            authored_files=c_files,
            recent_commits=c_commits
        )
        result = {
            "status": "success",
            "repo_name": repo_state["repo_name"],
            "contributor": c_match,
            "xai_summary": xai_summary
        }
        print(json.dumps(result))

    elif args.command == "pdf-data":
        result = {
            "status": "success",
            "repo_name": repo_state["repo_name"],
            "network_stats": repo_state["network_stats"],
            "contributors": repo_state["contributors"],
            "ast_functions": repo_state["ast_functions"],
            "files": repo_state["files"],
            "commits": repo_state["commits"][:5],
            "prs": repo_state["prs"][:4]
        }
        print(json.dumps(result))

    else:
        parser.print_help()


if __name__ == "__main__":
    main()
