import React, { useState, useRef } from 'react';
import { RepoIngestion } from './components/RepoIngestion';
import { GraphCanvas } from './components/GraphCanvas';
import { DepthSlider } from './components/DepthSlider';
import { XAiCard } from './components/XAiCard';
import { PythonCodeDrawer } from './components/PythonCodeDrawer';
import { RepoBrowserDrawer } from './components/RepoBrowserDrawer';
import { exportRepoPdfReport } from './utils/pdfExport';
import { RepoAnalysisData, GraphNode } from './types';
import { Download, Terminal, ArrowLeft, RefreshCw, Compass, ExternalLink, FolderGit2, AlertTriangle, X } from 'lucide-react';

export default function App() {
  const [currentView, setCurrentView] = useState<'landing' | 'graph'>('landing');
  const [repoName, setRepoName] = useState<string>('');
  const [depth, setDepth] = useState<number>(2);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [repoData, setRepoData] = useState<RepoAnalysisData | null>(null);
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [isPythonDrawerOpen, setIsPythonDrawerOpen] = useState<boolean>(false);
  const [isRepoBrowserOpen, setIsRepoBrowserOpen] = useState<boolean>(false);
  const [layoutMode, setLayoutMode] = useState<'constellation' | 'force'>('constellation');
  const [isExportingPdf, setIsExportingPdf] = useState<boolean>(false);

  // Ignore responses from superseded requests (e.g. dragging the depth slider quickly).
  const requestId = useRef(0);

  const handleAnalyze = async (repoInput: string, targetDepth: number = depth) => {
    const target = repoInput.trim();
    if (!target) {
      setError('Enter a GitHub repository (owner/repo or URL).');
      return;
    }
    const myId = ++requestId.current;
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/analyze-repo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repoUrl: target, depth: targetDepth }),
      });
      const json = await response.json().catch(() => ({}));
      if (myId !== requestId.current) return;

      if (!response.ok || !json.success || !json.data) {
        setError(json.error || `Analysis failed (HTTP ${response.status}).`);
        return;
      }

      const data: RepoAnalysisData = json.data;
      setRepoData(data);
      setRepoName(data.repo_name); // canonical "owner/repo" as resolved by GitHub
      setCurrentView('graph');

      const contributors = data.nodes.filter((n) => n.type === 'contributor' || !n.type);
      setSelectedNode((prev) => {
        const keep = prev && contributors.find((n) => n.id === prev.id);
        return keep || contributors[0] || null;
      });
    } catch (e: any) {
      if (myId === requestId.current) setError(e?.message || 'Network error while contacting the server.');
    } finally {
      if (myId === requestId.current) setIsLoading(false);
    }
  };

  const handleDepthChange = (newDepth: number) => {
    setDepth(newDepth);
    handleAnalyze(repoName, newDepth);
  };

  const handleSelectNode = (node: GraphNode | null) => {
    if (!node) return setSelectedNode(null);
    if (node.type === 'file' && node.file_url) return void window.open(node.file_url, '_blank', 'noopener,noreferrer');
    if (node.type === 'ast_function' && node.github_url)
      return void window.open(node.github_url, '_blank', 'noopener,noreferrer');
    if (node.type === 'contributor' || !node.type) setSelectedNode(node);
  };

  const handleExportPdf = () => {
    if (!repoData) return;
    setIsExportingPdf(true);
    try {
      exportRepoPdfReport(repoData);
    } catch (e) {
      console.error('PDF export error:', e);
      setError('PDF export failed.');
    } finally {
      setTimeout(() => setIsExportingPdf(false), 800);
    }
  };

  const currentRepoUrl = repoData?.repo_url || `https://github.com/${repoName}`;
  const warnings = repoData?.data_source?.warnings || [];

  return (
    <div className="w-screen h-screen bg-[#060609] text-slate-100 flex flex-col overflow-hidden font-sans">
      {currentView === 'landing' ? (
        <>
          <RepoIngestion onAnalyze={(url) => handleAnalyze(url, 2)} isLoading={isLoading} />
          {error && (
            <div className="fixed bottom-6 left-1/2 -translate-x-1/2 max-w-xl px-4 py-3 rounded-xl bg-rose-950/90 border border-rose-500/40 text-sm text-rose-100 flex items-start gap-2 z-50">
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
              <span>{error}</span>
              <button onClick={() => setError(null)} className="ml-2 text-rose-300 hover:text-white cursor-pointer">
                <X className="w-4 h-4" />
              </button>
            </div>
          )}
        </>
      ) : (
        <div className="relative w-full h-full flex flex-col overflow-hidden">
          <header className="h-16 px-4 sm:px-6 border-b border-slate-800/80 bg-slate-950/80 backdrop-blur-xl flex items-center justify-between z-20 shrink-0">
            <div className="flex items-center gap-3">
              <button
                onClick={() => setCurrentView('landing')}
                className="p-2 rounded-lg border border-slate-800 bg-slate-900/60 hover:bg-slate-800 text-slate-400 hover:text-white transition-colors cursor-pointer"
                title="Back to Repository Search"
              >
                <ArrowLeft className="w-4 h-4" />
              </button>
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="font-bold text-sm sm:text-base text-white tracking-tight">{repoName}</h2>
                  <a
                    href={currentRepoUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono bg-cyan-950/70 hover:bg-cyan-900/90 border border-cyan-500/30 text-cyan-300 hover:text-white transition-colors cursor-pointer"
                    title="Visit full repository on GitHub"
                  >
                    <span>Visit on GitHub</span>
                    <ExternalLink className="w-2.5 h-2.5" />
                  </a>
                </div>
                <div className="text-[11px] text-slate-400 hidden sm:block">
                  Live GitHub data • {repoData?.data_source?.parser || 'tree-sitter'} AST •{' '}
                  {repoData?.data_source?.blame_used ? 'git blame ownership' : 'file-history ownership (set GITHUB_TOKEN for blame)'}
                </div>
              </div>
            </div>

            <div className="hidden lg:flex items-center">
              <DepthSlider depth={depth} onChangeDepth={handleDepthChange} disabled={isLoading} />
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => setIsRepoBrowserOpen(true)}
                className="px-2.5 py-1.5 rounded-lg border border-cyan-500/30 bg-cyan-950/30 hover:bg-cyan-950/60 text-xs text-cyan-300 hover:text-white flex items-center gap-1.5 transition-colors cursor-pointer"
                title="Browse files, commits, and PRs in this repo"
              >
                <FolderGit2 className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Repo Files</span>
              </button>
              <button
                onClick={() => setLayoutMode(layoutMode === 'constellation' ? 'force' : 'constellation')}
                className="px-2.5 py-1.5 rounded-lg border border-slate-800 bg-slate-900/70 hover:bg-slate-800 text-xs text-slate-300 hover:text-white items-center gap-1.5 transition-colors cursor-pointer hidden md:flex"
                title="Toggle Radar Constellation vs Force Layout"
              >
                <Compass className="w-3.5 h-3.5 text-cyan-400" />
                <span className="capitalize">{layoutMode}</span>
              </button>
              <button
                onClick={() => setIsPythonDrawerOpen(true)}
                className="px-2.5 py-1.5 rounded-lg border border-slate-800 bg-slate-900/70 hover:bg-slate-800 text-xs text-slate-300 hover:text-white flex items-center gap-1.5 transition-colors cursor-pointer"
                title="View Python Core Code"
              >
                <Terminal className="w-3.5 h-3.5 text-amber-400" />
                <span className="hidden sm:inline">Python Core</span>
              </button>
              <button
                onClick={handleExportPdf}
                disabled={isExportingPdf || !repoData}
                className="px-3 py-1.5 rounded-lg bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white font-medium text-xs flex items-center gap-1.5 transition-all duration-200 shadow-md cursor-pointer disabled:opacity-50"
              >
                {isExportingPdf ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                <span>Export PDF</span>
              </button>
            </div>
          </header>

          <div className="lg:hidden px-4 py-2 border-b border-slate-800/80 bg-slate-950/60 backdrop-blur-md flex justify-center z-10">
            <DepthSlider depth={depth} onChangeDepth={handleDepthChange} disabled={isLoading} />
          </div>

          {(error || warnings.length > 0) && (
            <div className="px-4 py-2 border-b border-amber-500/20 bg-amber-950/30 text-[11px] text-amber-200 flex items-start gap-2 z-10">
              <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              <div className="flex-1 space-y-0.5">
                {error && <div className="text-rose-300">{error}</div>}
                {warnings.slice(0, 3).map((w, i) => (
                  <div key={i}>{w}</div>
                ))}
              </div>
              {error && (
                <button onClick={() => setError(null)} className="text-amber-300 hover:text-white cursor-pointer">
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          )}

          <main className="relative flex-1 w-full h-full overflow-hidden bg-[#060609]">
            {repoData ? (
              <GraphCanvas
                nodes={repoData.nodes}
                edges={repoData.edges}
                selectedNode={selectedNode}
                onSelectNode={handleSelectNode}
                networkStats={repoData.network_stats}
                layoutMode={layoutMode}
              />
            ) : (
              <div className="w-full h-full flex flex-col items-center justify-center space-y-3">
                <div className="w-8 h-8 border-2 border-cyan-400/30 border-t-cyan-400 rounded-full animate-spin" />
                <p className="text-sm text-slate-400">Fetching repository data...</p>
              </div>
            )}

            {isLoading && repoData && (
              <div className="absolute top-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full bg-slate-900/90 border border-slate-700 text-xs text-slate-300 flex items-center gap-2 z-20">
                <div className="w-3 h-3 border-2 border-cyan-400/30 border-t-cyan-400 rounded-full animate-spin" />
                Updating graph...
              </div>
            )}

            {selectedNode && repoData && (
              <XAiCard
                node={selectedNode}
                onClose={() => setSelectedNode(null)}
                astFunctions={repoData.ast_functions}
                repoName={repoData.repo_name}
                repoData={repoData}
              />
            )}
          </main>
        </div>
      )}

      {repoData && (
        <RepoBrowserDrawer isOpen={isRepoBrowserOpen} onClose={() => setIsRepoBrowserOpen(false)} repoData={repoData} />
      )}
      <PythonCodeDrawer isOpen={isPythonDrawerOpen} onClose={() => setIsPythonDrawerOpen(false)} />
    </div>
  );
}
