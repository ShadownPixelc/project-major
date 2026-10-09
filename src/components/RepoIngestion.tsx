import React, { useState } from 'react';
import { GitBranch, Terminal, Cpu, Database, Network, Search, ArrowRight, ShieldCheck, Sparkles, ExternalLink } from 'lucide-react';

interface RepoIngestionProps {
  onAnalyze: (repoUrl: string) => void;
  isLoading: boolean;
}

export const RepoIngestion: React.FC<RepoIngestionProps> = ({ onAnalyze, isLoading }) => {
  const [inputVal, setInputVal] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputVal.trim() && !isLoading) {
      onAnalyze('equinox-core');
      return;
    }
    if (!isLoading) {
      onAnalyze(inputVal.trim());
    }
  };

  const sampleRepos = [
    { label: 'equinox-core', desc: 'Default Benchmark (12 Contributors)' },
    { label: 'fastapi/tiangolo', desc: 'FastAPI Python Service' },
    { label: 'pallets/flask', desc: 'Python Web Microframework' },
    { label: 'networkx/networkx', desc: 'Python Graph Library' },
  ];

  return (
    <div className="relative min-h-screen bg-[#07070b] text-slate-100 flex flex-col justify-center items-center px-4 overflow-hidden">
      {/* Background ambient lighting */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[700px] h-[450px] bg-gradient-to-tr from-purple-900/15 via-cyan-900/10 to-transparent blur-[120px] pointer-events-none rounded-full" />
      <div className="absolute bottom-10 left-10 w-96 h-96 bg-cyan-950/10 blur-[140px] pointer-events-none" />

      {/* Top Brand Tag */}
      <div className="mb-8 inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full border border-slate-800 bg-slate-900/60 backdrop-blur-md text-xs tracking-wider uppercase text-cyan-400 font-medium">
        <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
        <span>Equinox Contributor Graph &amp; RAG Visualizer</span>
      </div>

      {/* Center Hero Heading - Matched to Image 1 */}
      <div className="max-w-3xl text-center mb-8 px-4">
        <h1 className="text-2xl sm:text-3xl md:text-4xl font-normal tracking-tight text-slate-100 leading-snug">
          Understand repositories faster with context-aware AI. Go from URL to architecture, code review, and security triage.
        </h1>
      </div>

      {/* Center Input Form - Matched to Image 1 glow and styling */}
      <form onSubmit={handleSubmit} className="w-full max-w-2xl px-4 relative z-10">
        <div className="relative group">
          {/* Gradient glow border container */}
          <div className="absolute -inset-0.5 rounded-xl bg-gradient-to-r from-purple-500/50 via-fuchsia-500/40 to-cyan-500/50 opacity-75 group-hover:opacity-100 group-focus-within:opacity-100 blur-sm transition duration-300" />
          
          <div className="relative flex items-center bg-[#0d0d14] rounded-xl border border-purple-500/40 focus-within:border-cyan-400/80 transition-all duration-200 shadow-2xl">
            <input
              type="text"
              value={inputVal}
              onChange={(e) => setInputVal(e.target.value)}
              placeholder="GitHub URL, username, or repo"
              disabled={isLoading}
              className="w-full px-5 py-4 bg-transparent text-slate-100 placeholder-slate-500 text-base md:text-lg focus:outline-none font-normal"
            />

            {inputVal.trim() && (
              <a
                href={
                  inputVal.startsWith('http')
                    ? inputVal
                    : `https://github.com/${inputVal.replace(/^\/+/, '')}`
                }
                target="_blank"
                rel="noopener noreferrer"
                className="mr-2 p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors cursor-pointer"
                title="Visit this repo directly on GitHub"
              >
                <ExternalLink className="w-4 h-4 text-cyan-400" />
              </a>
            )}

            <button
              type="submit"
              disabled={isLoading}
              className="mr-3 px-5 py-2.5 rounded-lg bg-gradient-to-r from-purple-600 via-fuchsia-600 to-cyan-600 hover:from-purple-500 hover:to-cyan-500 text-white font-medium text-sm transition-all duration-200 flex items-center gap-2 cursor-pointer shadow-lg disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
            >
              {isLoading ? (
                <>
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  <span>Analyzing AST &amp; Graph...</span>
                </>
              ) : (
                <>
                  <span>Ingest &amp; Graph</span>
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </div>
        </div>

        {/* Quick Sample Repo Buttons with direct Visit links */}
        <div className="mt-5 flex flex-wrap items-center justify-center gap-2.5 text-xs text-slate-400">
          <span className="text-slate-500">Quick launch:</span>
          {sampleRepos.map((r) => {
            const externalUrl =
              r.label === 'equinox-core'
                ? 'https://github.com/torvalds/linux'
                : `https://github.com/${r.label}`;

            return (
              <div
                key={r.label}
                className="inline-flex items-center rounded-md border border-slate-800 bg-slate-900/60 overflow-hidden"
              >
                <button
                  type="button"
                  onClick={() => {
                    setInputVal(r.label);
                    onAnalyze(r.label);
                  }}
                  disabled={isLoading}
                  className="px-2.5 py-1 hover:bg-slate-800/80 hover:text-slate-200 transition-colors text-slate-300 cursor-pointer"
                  title={`Analyze ${r.label}`}
                >
                  {r.label}
                </button>
                <a
                  href={externalUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-1.5 py-1 bg-slate-800/40 hover:bg-cyan-950/80 hover:text-cyan-300 text-slate-500 border-l border-slate-800/80 transition-colors"
                  title={`Visit ${r.label} directly on GitHub`}
                >
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            );
          })}
        </div>
      </form>

      {/* Feature Capabilities Grid */}
      <div className="mt-14 max-w-4xl w-full grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 px-4 text-left">
        <div className="p-4 rounded-xl border border-slate-800/80 bg-slate-900/30 backdrop-blur-sm">
          <div className="w-8 h-8 rounded-lg bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center text-cyan-400 mb-2.5">
            <Network className="w-4 h-4" />
          </div>
          <h2 className="text-sm font-semibold text-slate-200">NetworkX Engine</h2>
          <p className="text-xs text-slate-400 mt-1">
            Bipartite projection, degree centrality, and Louvain modularity clustering.
          </p>
        </div>

        <div className="p-4 rounded-xl border border-slate-800/80 bg-slate-900/30 backdrop-blur-sm">
          <div className="w-8 h-8 rounded-lg bg-purple-500/10 border border-purple-500/20 flex items-center justify-center text-purple-400 mb-2.5">
            <Cpu className="w-4 h-4" />
          </div>
          <h2 className="text-sm font-semibold text-slate-200">Tree-sitter AST</h2>
          <p className="text-xs text-slate-400 mt-1">
            Function-level attribution, AST line spans, and cyclomatic complexity scoring.
          </p>
        </div>

        <div className="p-4 rounded-xl border border-slate-800/80 bg-slate-900/30 backdrop-blur-sm">
          <div className="w-8 h-8 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400 mb-2.5">
            <Database className="w-4 h-4" />
          </div>
          <h2 className="text-sm font-semibold text-slate-200">ChromaDB RAG</h2>
          <p className="text-xs text-slate-400 mt-1">
            Vector semantic retrieval over commits, PRs, and functions with verified citations.
          </p>
        </div>

        <div className="p-4 rounded-xl border border-slate-800/80 bg-slate-900/30 backdrop-blur-sm">
          <div className="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400 mb-2.5">
            <ShieldCheck className="w-4 h-4" />
          </div>
          <h2 className="text-sm font-semibold text-slate-200">XAI Explanations</h2>
          <p className="text-xs text-slate-400 mt-1">
            2-line instant summaries of contributor ownership and onboarding action outcomes.
          </p>
        </div>
      </div>

      {/* Team Distribution & Architecture Spec Note */}
      <div className="mt-8 text-center text-[11px] text-slate-500 flex items-center gap-4">
        <span>Team of 3: Frontend &amp; D3 • FastAPI &amp; NetworkX • ChromaDB &amp; DevOps</span>
        <span>•</span>
        <span className="text-cyan-400/80 font-mono">FastAPI / Python 3.11</span>
      </div>
    </div>
  );
};
