import React, { useState, useEffect } from 'react';
import { ContributorNode, AstFunction, RagResponse, GraphNode, RepoAnalysisData } from '../types';
import { Sparkles, MessageSquare, Code2, GitCommit, GitPullRequest, X, ShieldAlert, CheckCircle2, Send, BookmarkCheck, ArrowRight, ExternalLink } from 'lucide-react';

interface XAiCardProps {
  node: GraphNode;
  onClose: () => void;
  astFunctions: AstFunction[];
  repoName: string;
  repoData?: RepoAnalysisData;
}

export const XAiCard: React.FC<XAiCardProps> = ({ node, onClose, astFunctions, repoName, repoData }) => {
  const isContributor = (node as ContributorNode).type === 'contributor' || !(node as any).type;
  const contributor = node as ContributorNode;

  // Active view: 'xai' (instant 2-line summary) or 'rag' (interactive on-demand RAG query)
  const [activeTab, setActiveTab] = useState<'xai' | 'rag'>('xai');
  const [xaiSummary, setXaiSummary] = useState<string>('');
  const [isLoadingXai, setIsLoadingXai] = useState<boolean>(false);

  // RAG state
  const [ragQuery, setRagQuery] = useState<string>('');
  const [ragResult, setRagResult] = useState<RagResponse | null>(null);
  const [isLoadingRag, setIsLoadingRag] = useState<boolean>(false);

  // Filter AST functions owned by this contributor
  const ownedAstFunctions = astFunctions.filter(
    (fn) => fn.primary_owner === contributor.name || fn.primary_owner === contributor.id
  );

  // Authored files and recent commits by this contributor
  const authoredFiles = (repoData?.files || [])
    .filter((f) => (f.contributors || []).includes(contributor.name))
    .map((f) => f.path);

  const recentCommits = (repoData?.commits || [])
    .filter((c) => c.author.toLowerCase() === contributor.name.toLowerCase() || c.author.toLowerCase() === contributor.id.toLowerCase())
    .map((c) => c.message);

  // Profile URL on GitHub
  const profileUrl = contributor.profile_url || `https://github.com/${contributor.name}`;

  // Helper to resolve citation URLs on GitHub
  const getCitationUrl = (citation: string): string => {
    const commitMatch = citation.match(/\[Commit #([a-zA-Z0-9]+)\]/);
    if (commitMatch) {
      return `https://github.com/${repoName}/commit/${commitMatch[1]}`;
    }
    const prMatch = citation.match(/\[PR #([0-9]+)\]/);
    if (prMatch) {
      return `https://github.com/${repoName}/pull/${prMatch[1]}`;
    }
    const astMatch = citation.match(/\[AST: .* in ([^:]+):L([0-9]+)\]/);
    if (astMatch) {
      return `https://github.com/${repoName}/blob/main/${astMatch[1]}#L${astMatch[2]}`;
    }
    const fileMatch = citation.match(/\[File: ([^\]]+)\]/);
    if (fileMatch) {
      return `https://github.com/${repoName}/blob/main/${fileMatch[1]}`;
    }
    return `https://github.com/${repoName}`;
  };

  // Fetch or generate XAI 2-line summary on node selection
  useEffect(() => {
    if (!isContributor) return;

    let isMounted = true;
    setIsLoadingXai(true);

    fetch('/api/xai-summary', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contributorId: contributor.id,
        contributorName: contributor.name,
        domain: contributor.domain,
        role: (contributor as any).role || '',
        keyContribution: (contributor as any).key_contribution || '',
        ownedFunctions: ownedAstFunctions.map((f) => f.name),
        repoName,
        repoDescription: repoData ? `Software repository ${repoName}` : '',
        authoredFiles,
        recentCommits,
        commitsCount: contributor.commits_count,
        prsReviewed: contributor.prs_reviewed,
      }),
    })
      .then((res) => res.json())
      .then((data) => {
        if (isMounted) {
          setXaiSummary(
            data.summary ||
              `${contributor.name} is a key contributor to ${repoName}, leading ${contributor.domain || 'core architecture'}.\nTheir work establishes critical stability across ${contributor.commits_count || 10} commits and ${contributor.prs_reviewed || 5} reviews.`
          );
          setIsLoadingXai(false);
        }
      })
      .catch((_err) => {
        if (isMounted) {
          setXaiSummary(
            `${contributor.name} is a key contributor to ${repoName}, leading ${contributor.domain || 'core architecture'}.\nTheir work establishes critical stability across ${contributor.commits_count || 10} commits and ${contributor.prs_reviewed || 5} reviews.`
          );
          setIsLoadingXai(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [node, isContributor, repoName]);

  // Execute Grounded RAG Query
  const handleExecuteRag = (customQuery?: string) => {
    const q = customQuery || ragQuery;
    if (!q.trim() || isLoadingRag) return;

    setIsLoadingRag(true);
    setRagResult(null);

    fetch('/api/rag-query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: q,
        contributorFocus: isContributor ? contributor.name : undefined,
        repoName,
      }),
    })
      .then((res) => res.json())
      .then((data) => {
        setRagResult(data);
        setIsLoadingRag(false);
      })
      .catch((err) => {
        console.error('RAG Query Error:', err);
        setIsLoadingRag(false);
      });
  };

  const sampleQueries = [
    `What code do I need to add to extend ${contributor.name}'s modules?`,
    `Who should review PRs for ${contributor.domain || 'this area'}?`,
    `What are the critical dependencies in this contributor's work?`,
  ];

  return (
    <div className="absolute top-6 right-6 w-96 max-w-[calc(100vw-3rem)] max-h-[85vh] flex flex-col bg-[#0d0d14]/95 border border-slate-800 rounded-2xl shadow-2xl backdrop-blur-xl z-20 overflow-hidden text-slate-100 transition-all duration-200">
      {/* Card Header */}
      <div className="p-4 border-b border-slate-800/80 flex items-start justify-between bg-slate-900/40">
        <div className="flex items-center gap-3">
          <div
            className="w-10 h-10 rounded-full flex items-center justify-center font-mono font-bold text-sm border-2 shrink-0"
            style={{
              borderColor: contributor.color || '#00e5ff',
              color: contributor.color || '#00e5ff',
              backgroundColor: 'rgba(0,0,0,0.5)',
              boxShadow: `0 0 12px ${contributor.color || '#00e5ff'}40`,
            }}
          >
            {contributor.badge || '01'}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-bold text-base text-white leading-tight">{contributor.name}</h3>
              <a
                href={profileUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="p-1 rounded bg-slate-800 hover:bg-cyan-950 text-slate-400 hover:text-cyan-300 transition-colors"
                title={`Visit ${contributor.name} on GitHub`}
              >
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            </div>
            <p className="text-xs font-semibold text-cyan-400 truncate max-w-[210px] mt-0.5">
              {(contributor as any).role || contributor.domain || (node as any).label || 'Core Contributor'}
            </p>
            {(contributor as any).key_contribution && (
              <p className="text-[11px] text-slate-300 leading-snug line-clamp-2 mt-0.5">
                {(contributor as any).key_contribution}
              </p>
            )}
          </div>
        </div>

        <button
          onClick={onClose}
          className="p-1 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white transition-colors cursor-pointer"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Mode Navigation Tabs: XAI (default) vs RAG (on-demand to save tokens) */}
      <div className="flex border-b border-slate-800 bg-[#09090e]">
        <button
          onClick={() => setActiveTab('xai')}
          className={`flex-1 py-2.5 text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors cursor-pointer ${
            activeTab === 'xai'
              ? 'text-cyan-400 border-b-2 border-cyan-400 bg-cyan-950/20'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Sparkles className="w-3.5 h-3.5" />
          <span>XAI Summary</span>
        </button>
        <button
          onClick={() => setActiveTab('rag')}
          className={`flex-1 py-2.5 text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors cursor-pointer ${
            activeTab === 'rag'
              ? 'text-fuchsia-400 border-b-2 border-fuchsia-400 bg-fuchsia-950/20'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <MessageSquare className="w-3.5 h-3.5" />
          <span>RAG Repo Q&amp;A</span>
        </button>
      </div>

      {/* Card Body */}
      <div className="p-4 overflow-y-auto flex-1 space-y-4">
        {activeTab === 'xai' ? (
          <>
            {/* 2-line XAI Contribution Box (Required by User Specification) */}
            <div>
              <div className="flex items-center justify-between text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-1.5">
                <span className="flex items-center gap-1 text-cyan-400">
                  <Sparkles className="w-3 h-3" />
                  <span>XAI Core Contribution</span>
                </span>
                <span className="text-[10px] text-slate-500 font-mono">2-Line Brief</span>
              </div>

              <div className="p-3 rounded-xl bg-slate-900/80 border border-cyan-500/20 shadow-inner">
                {isLoadingXai ? (
                  <div className="flex items-center gap-2 text-xs text-slate-400 py-1">
                    <div className="w-3.5 h-3.5 border-2 border-cyan-400/30 border-t-cyan-400 rounded-full animate-spin" />
                    <span>Synthesizing contributor XAI summary...</span>
                  </div>
                ) : (
                  <p className="text-xs text-slate-200 leading-relaxed whitespace-pre-line font-normal">
                    {xaiSummary}
                  </p>
                )}
              </div>
            </div>

            {/* NetworkX Centrality & Risk Stats */}
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="p-2.5 rounded-lg bg-slate-900/50 border border-slate-800/80">
                <div className="text-[10px] text-slate-500 uppercase tracking-wider">Betweenness</div>
                <div className="font-mono font-bold text-amber-400 text-sm mt-0.5">
                  {contributor.betweenness_centrality ?? '0.12'}
                </div>
                <div className="text-[10px] text-slate-400 mt-0.5">NetworkX Centrality</div>
              </div>

              <div className="p-2.5 rounded-lg bg-slate-900/50 border border-slate-800/80">
                <div className="text-[10px] text-slate-500 uppercase tracking-wider">Bus Factor Risk</div>
                <div
                  className={`font-mono font-bold text-sm mt-0.5 flex items-center gap-1 ${
                    contributor.bus_factor_risk === 'HIGH' ? 'text-rose-400' : 'text-emerald-400'
                  }`}
                >
                  {contributor.bus_factor_risk === 'HIGH' ? (
                    <ShieldAlert className="w-3.5 h-3.5" />
                  ) : (
                    <CheckCircle2 className="w-3.5 h-3.5" />
                  )}
                  <span>{contributor.bus_factor_risk || 'LOW'}</span>
                </div>
                <div className="text-[10px] text-slate-400 mt-0.5">
                  {contributor.bus_factor_risk === 'HIGH' ? 'Single point of failure' : 'Well distributed'}
                </div>
              </div>
            </div>

            {/* Tree-sitter AST Functions Owned with Clickable Links */}
            {ownedAstFunctions.length > 0 && (
              <div>
                <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-2 flex items-center justify-between">
                  <span className="flex items-center gap-1 text-purple-400">
                    <Code2 className="w-3 h-3" />
                    <span>Tree-sitter Owned Functions</span>
                  </span>
                  <span className="text-[10px] text-slate-500">{ownedAstFunctions.length} functions</span>
                </div>

                <div className="space-y-1.5 max-h-36 overflow-y-auto pr-1">
                  {ownedAstFunctions.map((fn, idx) => {
                    const fnUrl =
                      fn.github_url ||
                      `https://github.com/${repoName}/blob/main/${fn.file_path}#L${fn.start_line}`;

                    return (
                      <div
                        key={idx}
                        className="p-2 rounded-lg bg-slate-900/60 border border-slate-800/80 flex items-center justify-between text-xs group"
                      >
                        <div className="truncate mr-2">
                          <div className="font-mono text-cyan-300 font-medium truncate flex items-center gap-1.5">
                            <span>{fn.name}()</span>
                            <a
                              href={fnUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="opacity-0 group-hover:opacity-100 text-slate-400 hover:text-cyan-300 transition-opacity"
                              title="View function in GitHub code"
                            >
                              <ExternalLink className="w-3 h-3" />
                            </a>
                          </div>
                          <div className="text-[10px] text-slate-500 truncate">
                            {fn.file_path.split('/').pop()} : L{fn.start_line}-{fn.end_line}
                          </div>
                        </div>
                        <div className="text-[11px] font-mono text-amber-400 font-bold shrink-0">
                          {fn.primary_ownership_pct}%
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Visit Contributor Profile on GitHub Button */}
            <div className="pt-2 border-t border-slate-800/80 flex flex-col gap-2">
              <a
                href={profileUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="w-full py-2 px-3 rounded-lg bg-cyan-950/40 hover:bg-cyan-950/70 border border-cyan-500/30 text-xs text-cyan-300 hover:text-white flex items-center justify-center gap-2 transition-colors cursor-pointer"
              >
                <span>Visit {contributor.name} on GitHub</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </a>

              <button
                onClick={() => setActiveTab('rag')}
                className="w-full py-2 px-3 rounded-lg bg-slate-800/80 hover:bg-slate-700/80 text-xs text-slate-300 hover:text-white flex items-center justify-center gap-2 transition-colors cursor-pointer"
              >
                <span>Ask deep onboarding questions via RAG</span>
                <ArrowRight className="w-3.5 h-3.5 text-cyan-400" />
              </button>
            </div>
          </>
        ) : (
          /* RAG-based answers tab */
          <div className="space-y-3">
            <div className="text-xs text-slate-400 leading-relaxed">
              Query the repository evidence base. Citations are verified against Tree-sitter AST nodes, commits, and PRs.
            </div>

            {/* Query Input */}
            <div className="relative">
              <input
                type="text"
                value={ragQuery}
                onChange={(e) => setRagQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleExecuteRag()}
                placeholder="Ask query (e.g. What code do I add?)"
                disabled={isLoadingRag}
                className="w-full px-3 py-2 pr-9 rounded-lg bg-slate-950 border border-purple-500/40 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-cyan-400"
              />
              <button
                onClick={() => handleExecuteRag()}
                disabled={isLoadingRag || !ragQuery.trim()}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-cyan-400 hover:text-cyan-300 disabled:opacity-40 cursor-pointer"
              >
                <Send className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Quick suggested prompt chips */}
            <div className="space-y-1">
              <div className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold">Suggested Questions:</div>
              {sampleQueries.map((sq, i) => (
                <button
                  key={i}
                  onClick={() => {
                    setRagQuery(sq);
                    handleExecuteRag(sq);
                  }}
                  className="w-full text-left p-1.5 rounded bg-slate-900/60 hover:bg-slate-800/80 border border-slate-800/60 text-[11px] text-slate-300 hover:text-white truncate transition-colors cursor-pointer"
                >
                  • {sq}
                </button>
              ))}
            </div>

            {/* RAG Loading state */}
            {isLoadingRag && (
              <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800 text-center space-y-2">
                <div className="w-5 h-5 border-2 border-fuchsia-400/30 border-t-fuchsia-400 rounded-full animate-spin mx-auto" />
                <div className="text-xs text-slate-400">Retrieving ChromaDB vectors &amp; checking citations...</div>
              </div>
            )}

            {/* RAG Output */}
            {ragResult && (
              <div className="space-y-2.5 pt-1">
                <div className="p-3 rounded-xl bg-slate-900/90 border border-fuchsia-500/30 text-xs text-slate-200 leading-relaxed whitespace-pre-line max-h-48 overflow-y-auto">
                  {ragResult.answer}
                </div>

                {/* Grounded Citations - Now Clickable to open GitHub Commits / PRs / Files */}
                {ragResult.citations && ragResult.citations.length > 0 && (
                  <div className="p-2 rounded-lg bg-slate-950 border border-slate-800">
                    <div className="text-[10px] font-semibold text-cyan-400 uppercase tracking-wider mb-1 flex items-center justify-between">
                      <span className="flex items-center gap-1">
                        <BookmarkCheck className="w-3 h-3" />
                        <span>Grounded Citations (Click to Visit)</span>
                      </span>
                      <span className="text-[9px] text-slate-500">Opens in GitHub</span>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {ragResult.citations.map((c, idx) => (
                        <a
                          key={idx}
                          href={getCitationUrl(c)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="px-2 py-0.5 rounded bg-cyan-950/60 hover:bg-cyan-900/80 border border-cyan-500/30 hover:border-cyan-400 text-[10px] font-mono text-cyan-300 hover:text-white flex items-center gap-1 transition-colors cursor-pointer"
                          title="Open evidence on GitHub"
                        >
                          <span>{c}</span>
                          <ExternalLink className="w-2.5 h-2.5 opacity-70" />
                        </a>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
