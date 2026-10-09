import React, { useState, useEffect } from 'react';
import { RepoIngestion } from './components/RepoIngestion';
import { GraphCanvas } from './components/GraphCanvas';
import { DepthSlider } from './components/DepthSlider';
import { XAiCard } from './components/XAiCard';
import { PythonCodeDrawer } from './components/PythonCodeDrawer';
import { RepoBrowserDrawer } from './components/RepoBrowserDrawer';
import { exportRepoPdfReport } from './utils/pdfExport';
import { RepoAnalysisData, GraphNode } from './types';
import { GitBranch, Download, Terminal, ArrowLeft, RefreshCw, Compass, ShieldCheck, ExternalLink, FolderGit2 } from 'lucide-react';

export default function App() {
  const [currentView, setCurrentView] = useState<'landing' | 'graph'>('landing');
  const [repoName, setRepoName] = useState<string>('equinox-core');
  const [depth, setDepth] = useState<number>(2);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [repoData, setRepoData] = useState<RepoAnalysisData | null>(null);
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [isPythonDrawerOpen, setIsPythonDrawerOpen] = useState<boolean>(false);
  const [isRepoBrowserOpen, setIsRepoBrowserOpen] = useState<boolean>(false);
  const [layoutMode, setLayoutMode] = useState<'constellation' | 'force'>('constellation');
  const [isExportingPdf, setIsExportingPdf] = useState<boolean>(false);

  // Analyze repository by calling backend API
  const handleAnalyze = async (repoInput: string, targetDepth: number = depth) => {
    setIsLoading(true);
    const targetRepo = repoInput.trim() || 'equinox-core';
    setRepoName(targetRepo);

    try {
      const response = await fetch('/api/analyze-repo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repoUrl: targetRepo, depth: targetDepth }),
      });

      const json = await response.json();
      if (json.success && json.data) {
        setRepoData(json.data);
        setCurrentView('graph');
        // Preserve or set selected contributor to showcase XAI
        if (selectedNode) {
          const matching = json.data.nodes.find((n: any) => n.id === selectedNode.id);
          if (matching) {
            setSelectedNode(matching);
          }
        } else if (json.data.nodes && json.data.nodes.length > 0) {
          const firstContrib = json.data.nodes.find((n: any) => n.type === 'contributor' || !n.type);
          if (firstContrib) {
            setSelectedNode(firstContrib);
          }
        }
      }
    } catch (error) {
      console.error('Failed to analyze repository:', error);
    } finally {
      setIsLoading(false);
    }
  };

  // Handle Depth Slider adjustment
  const handleDepthChange = (newDepth: number) => {
    setDepth(newDepth);
    handleAnalyze(repoName, newDepth);
  };

  // Export PDF Report handler
  const handleExportPdf = () => {
    if (!repoData) return;
    setIsExportingPdf(true);
    try {
      exportRepoPdfReport(repoData);
    } catch (e) {
      console.error('PDF export error:', e);
    } finally {
      setTimeout(() => setIsExportingPdf(false), 800);
    }
  };

  const currentRepoUrl = repoData?.repo_url || `https://github.com/${repoName}`;

  return (
    <div className="w-screen h-screen bg-[#060609] text-slate-100 flex flex-col overflow-hidden font-sans">
      {currentView === 'landing' ? (
        <RepoIngestion onAnalyze={(url) => handleAnalyze(url, 2)} isLoading={isLoading} />
      ) : (
        <div className="relative w-full h-full flex flex-col overflow-hidden">
          {/* Top Navigation & Controls Bar */}
          <header className="h-16 px-4 sm:px-6 border-b border-slate-800/80 bg-slate-950/80 backdrop-blur-xl flex items-center justify-between z-20 shrink-0">
            {/* Left: Back button & Repo details with Clickable External Link */}
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
                  NetworkX Collaboration Graph • Tree-sitter AST Attribution
                </div>
              </div>
            </div>

            {/* Center: Depth Slider (Low = Users only, High = Entire Codebase & AST) */}
            <div className="hidden lg:flex items-center">
              <DepthSlider depth={depth} onChangeDepth={handleDepthChange} disabled={isLoading} />
            </div>

            {/* Right: Actions */}
            <div className="flex items-center gap-2">
              {/* Live Repo Files Browser */}
              <button
                onClick={() => setIsRepoBrowserOpen(true)}
                className="px-2.5 py-1.5 rounded-lg border border-cyan-500/30 bg-cyan-950/30 hover:bg-cyan-950/60 text-xs text-cyan-300 hover:text-white flex items-center gap-1.5 transition-colors cursor-pointer"
                title="Browse files, commits, and PRs in this repo"
              >
                <FolderGit2 className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Repo Files</span>
              </button>

              {/* Layout Mode Toggle */}
              <button
                onClick={() => setLayoutMode(layoutMode === 'constellation' ? 'force' : 'constellation')}
                className="px-2.5 py-1.5 rounded-lg border border-slate-800 bg-slate-900/70 hover:bg-slate-800 text-xs text-slate-300 hover:text-white flex items-center gap-1.5 transition-colors cursor-pointer hidden md:flex"
                title="Toggle Radar Constellation vs Force Layout"
              >
                <Compass className="w-3.5 h-3.5 text-cyan-400" />
                <span className="capitalize">{layoutMode}</span>
              </button>

              {/* Python Code Drawer Button */}
              <button
                onClick={() => setIsPythonDrawerOpen(true)}
                className="px-2.5 py-1.5 rounded-lg border border-slate-800 bg-slate-900/70 hover:bg-slate-800 text-xs text-slate-300 hover:text-white flex items-center gap-1.5 transition-colors cursor-pointer"
                title="View Python Core Code (NetworkX, Tree-sitter, RAG)"
              >
                <Terminal className="w-3.5 h-3.5 text-amber-400" />
                <span className="hidden sm:inline">Python Core</span>
              </button>

              {/* PDF Export Button */}
              <button
                onClick={handleExportPdf}
                disabled={isExportingPdf || !repoData}
                className="px-3 py-1.5 rounded-lg bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white font-medium text-xs flex items-center gap-1.5 transition-all duration-200 shadow-md cursor-pointer disabled:opacity-50"
              >
                {isExportingPdf ? (
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Download className="w-3.5 h-3.5" />
                )}
                <span>Export PDF</span>
              </button>
            </div>
          </header>

          {/* Sub-bar for mobile/tablet to adjust depth */}
          <div className="lg:hidden px-4 py-2 border-b border-slate-800/80 bg-slate-950/60 backdrop-blur-md flex justify-center z-10">
            <DepthSlider depth={depth} onChangeDepth={handleDepthChange} disabled={isLoading} />
          </div>

          {/* Main Visualizer Area (D3.js Graph Canvas) */}
          <main className="relative flex-1 w-full h-full overflow-hidden bg-[#060609]">
            {repoData ? (
              <GraphCanvas
                nodes={repoData.nodes}
                edges={repoData.edges}
                selectedNode={selectedNode}
                onSelectNode={(node) => setSelectedNode(node)}
                networkStats={repoData.network_stats}
                layoutMode={layoutMode}
              />
            ) : (
              <div className="w-full h-full flex flex-col items-center justify-center space-y-3">
                <div className="w-8 h-8 border-2 border-cyan-400/30 border-t-cyan-400 rounded-full animate-spin" />
                <p className="text-sm text-slate-400">Loading NetworkX graph and Tree-sitter AST nodes...</p>
              </div>
            )}

            {/* XAI & Grounded RAG Popup Card (Opens near or alongside clicked user node) */}
            {selectedNode && repoData && (
              <XAiCard
                node={selectedNode}
                onClose={() => setSelectedNode(null)}
                astFunctions={repoData.ast_functions}
                repoName={repoName}
                repoData={repoData}
              />
            )}
          </main>
        </div>
      )}

      {/* Repo Browser Drawer (Explore files, commits, and PRs with GitHub links) */}
      {repoData && (
        <RepoBrowserDrawer
          isOpen={isRepoBrowserOpen}
          onClose={() => setIsRepoBrowserOpen(false)}
          repoData={repoData}
        />
      )}

      {/* Python Code Drawer (Inspect Python NetworkX, Tree-sitter, and RAG files) */}
      <PythonCodeDrawer isOpen={isPythonDrawerOpen} onClose={() => setIsPythonDrawerOpen(false)} />
    </div>
  );
}
