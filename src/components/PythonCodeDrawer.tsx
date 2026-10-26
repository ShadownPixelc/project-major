import React, { useState } from 'react';
import { Terminal, Code, Cpu, Network, Database, X, Check, Copy } from 'lucide-react';

interface PythonCodeDrawerProps {
  isOpen: boolean;
  onClose: () => void;
}

export const PythonCodeDrawer: React.FC<PythonCodeDrawerProps> = ({ isOpen, onClose }) => {
  const [selectedTab, setSelectedTab] = useState<'networkx' | 'treesitter' | 'rag' | 'fastapi'>('networkx');
  const [copied, setCopied] = useState(false);

  if (!isOpen) return null;

  const codeSnippets: Record<string, { title: string; filename: string; code: string; desc: string }> = {
    networkx: {
      title: 'NetworkX Bipartite Projection & Centrality',
      filename: 'backend/graph_engine.py',
      desc: 'Constructs contributor-file bipartite graphs, computes betweenness centrality, PageRank, and Louvain modularity clusters.',
      code: `import networkx as nx
from typing import Dict, List, Any

class ContributorGraphEngine:
    def project_contributor_network(self, contributors, ownership_matrix, pr_reviews):
        # 1. Initialize NetworkX Graph
        G = nx.Graph()
        for c in contributors:
            G.add_node(c["id"], **c)
            
        # 2. Compute co-editing edge weights & PR interactions
        for (c1, c2), data in pair_weights.items():
            G.add_edge(c1, c2, weight=data["weight"], **data)

        # 3. Calculate NetworkX Centrality Metrics
        deg_centrality = nx.degree_centrality(G)
        between_centrality = nx.betweenness_centrality(G, weight="weight")
        pagerank = nx.pagerank(G, weight="weight")
        
        # 4. Louvain / Modularity Community Detection
        communities = list(nx.community.greedy_modularity_communities(G))
        return {"nodes": enriched, "edges": edges, "communities": communities}`,
    },
    treesitter: {
      title: 'Tree-sitter AST Function Attribution',
      filename: 'backend/tree_sitter_analyzer.py',
      desc: 'Parses source code into Abstract Syntax Trees, calculates cyclomatic complexity, and maps commit line diffs to function entities.',
      code: `import ast
import tree_sitter
from typing import List, Dict, Any

class TreeSitterAnalyzer:
    def parse_python_ast(self, source_code: str, file_path: str):
        tree = ast.parse(source_code)
        functions = []
        for node in ast.walk(tree):
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                start_line = node.lineno
                end_line = getattr(node, "end_lineno", start_line + len(node.body))
                # Cyclomatic Complexity
                complexity = 1 + sum(1 for c in ast.walk(node) if isinstance(c, (ast.If, ast.For, ast.While)))
                functions.append({
                    "name": node.name, "start_line": start_line, "end_line": end_line,
                    "complexity": complexity, "parameters": [a.arg for a in node.args.args]
                })
        return functions

    def attribute_function_ownership(self, functions, blame_diffs):
        # Map commit diff line ranges [d_start, d_end] onto AST function ranges [f_start, f_end]
        for fn in functions:
            for diff in blame_diffs:
                overlap = min(fn["end_line"], diff["end_line"]) - max(fn["start_line"], diff["start_line"])
                if overlap > 0:
                    fn["author_lines"][diff["author"]] += overlap
        return functions`,
    },
    rag: {
      title: 'ChromaDB Vector Retrieval & Citations',
      filename: 'backend/rag_pipeline.py',
      desc: 'Indexes commits, PRs, and AST functions into ChromaDB vector collections with strict citation verification guardrails.',
      code: `import chromadb
from chromadb.config import Settings

class RAGPipeline:
    def __init__(self, collection_name="equinox_repo_knowledge"):
        self.client = chromadb.Client(Settings(anonymized_telemetry=False))
        self.collection = self.client.get_or_create_collection(name=collection_name)

    def ingest_knowledge_base(self, commits, prs, ast_functions, files):
        # Chunks and embeds repository evidence
        for fn in ast_functions:
            self.collection.add(
                ids=[f"ast_{fn['name']}"],
                documents=[f"Function {fn['name']} in {fn['file_path']} owned by {fn['primary_owner']}"],
                metadatas=[{"citation": f"[AST: {fn['name']}() in {fn['file_path']}:L{fn['start_line']}]"}]
            )

    def retrieve(self, query: str, top_k=4, filter_author=None):
        results = self.collection.query(query_texts=[query], n_results=top_k)
        return results`,
    },
    fastapi: {
      title: 'FastAPI Backend Endpoints',
      filename: 'backend/main.py',
      desc: 'Async REST endpoints orchestrating NetworkX graph filtering, Tree-sitter AST parsing, and ChromaDB grounded RAG responses.',
      code: `from fastapi import FastAPI, HTTPException
from backend.graph_engine import ContributorGraphEngine
from backend.rag_pipeline import RAGPipeline

app = FastAPI(title="Equinox Contributor Graph Service")
engine = ContributorGraphEngine()
rag = RAGPipeline()

@app.post("/api/analyze-repo")
async def analyze_repo(req: IngestRepoRequest):
    graph = engine.project_contributor_network(...)
    filtered = engine.filter_by_depth(graph, req.depth)
    return {"status": "success", "graph": filtered}

@app.post("/api/rag/query")
async def rag_query(req: RAGQueryRequest):
    docs = rag.retrieve(req.query, top_k=4, filter_author=req.contributor_focus)
    return {"answer": answer, "citations": [d["citation"] for d in docs]}`,
    },
  };

  const current = codeSnippets[selectedTab];

  const handleCopy = () => {
    navigator.clipboard.writeText(current.code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex justify-end transition-opacity">
      <div className="w-full max-w-2xl h-full bg-[#0a0a10] border-l border-slate-800 flex flex-col text-slate-100 shadow-2xl">
        {/* Drawer Header */}
        <div className="p-4 border-b border-slate-800 flex items-center justify-between bg-slate-900/60">
          <div className="flex items-center gap-2">
            <Terminal className="w-5 h-5 text-cyan-400" />
            <div>
              <h2 className="font-bold text-sm text-white">Equinox Python Core Engine</h2>
              <p className="text-xs text-slate-400 font-mono">NetworkX • Tree-sitter • ChromaDB • FastAPI</p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Selector */}
        <div className="flex border-b border-slate-800 bg-[#07070b] overflow-x-auto text-xs">
          {(['networkx', 'treesitter', 'rag', 'fastapi'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setSelectedTab(tab)}
              className={`px-4 py-3 font-semibold transition-colors flex items-center gap-1.5 whitespace-nowrap cursor-pointer ${
                selectedTab === tab
                  ? 'text-cyan-400 border-b-2 border-cyan-400 bg-cyan-950/20'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {tab === 'networkx' && <Network className="w-3.5 h-3.5" />}
              {tab === 'treesitter' && <Cpu className="w-3.5 h-3.5" />}
              {tab === 'rag' && <Database className="w-3.5 h-3.5" />}
              {tab === 'fastapi' && <Code className="w-3.5 h-3.5" />}
              <span className="capitalize">{tab}</span>
            </button>
          ))}
        </div>

        {/* Code Content */}
        <div className="p-4 flex-1 overflow-y-auto space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-bold text-sm text-slate-100">{current.title}</h3>
              <p className="text-xs text-slate-400 mt-0.5">{current.desc}</p>
            </div>

            <button
              onClick={handleCopy}
              className="px-2.5 py-1.5 rounded bg-slate-800 hover:bg-slate-700 text-xs text-slate-300 hover:text-white flex items-center gap-1.5 transition-colors cursor-pointer shrink-0"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copied ? 'Copied' : 'Copy'}</span>
            </button>
          </div>

          <div className="relative rounded-xl bg-[#050508] border border-slate-800/80 p-4 font-mono text-xs text-slate-300 overflow-x-auto shadow-inner leading-relaxed">
            <div className="text-[10px] text-slate-500 mb-2 border-b border-slate-800 pb-1">
              // File: {current.filename}
            </div>
            <pre>
              <code>{current.code}</code>
            </pre>
          </div>

          {/* CLI Run Example */}
          <div className="p-3 rounded-xl bg-slate-900/60 border border-slate-800 text-xs">
            <div className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold mb-1">
              Direct Python Execution:
            </div>
            <code className="text-cyan-300 font-mono block overflow-x-auto">
              python3 backend/cli.py analyze --repo equinox-core --depth 2
            </code>
          </div>
        </div>
      </div>
    </div>
  );
};
