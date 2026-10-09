import React, { useState } from 'react';
import { RepoAnalysisData } from '../types';
import { FolderGit2, ExternalLink, GitCommit, GitPullRequest, FileCode, X, Search, ShieldCheck } from 'lucide-react';

interface RepoBrowserDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  repoData: RepoAnalysisData;
}

export const RepoBrowserDrawer: React.FC<RepoBrowserDrawerProps> = ({ isOpen, onClose, repoData }) => {
  const [activeTab, setActiveTab] = useState<'files' | 'commits' | 'prs'>('files');
  const [filterQuery, setFilterQuery] = useState('');

  if (!isOpen) return null;

  const repoUrl = repoData.repo_url || `https://github.com/${repoData.repo_name}`;

  const filteredFiles = (repoData.files || []).filter((f) =>
    f.path.toLowerCase().includes(filterQuery.toLowerCase())
  );

  const filteredCommits = (repoData.commits || []).filter(
    (c) =>
      c.message.toLowerCase().includes(filterQuery.toLowerCase()) ||
      c.author.toLowerCase().includes(filterQuery.toLowerCase()) ||
      c.sha.toLowerCase().includes(filterQuery.toLowerCase())
  );

  const filteredPrs = (repoData.prs || []).filter(
    (pr) =>
      pr.title.toLowerCase().includes(filterQuery.toLowerCase()) ||
      pr.author.toLowerCase().includes(filterQuery.toLowerCase())
  );

  return (
    <div className="fixed inset-0 bg-black/75 backdrop-blur-sm z-50 flex justify-end">
      <div className="w-full max-w-xl h-full bg-[#0d0d14] border-l border-slate-800 flex flex-col text-slate-100 shadow-2xl">
        {/* Header */}
        <div className="p-4 border-b border-slate-800 flex items-center justify-between bg-slate-900/60">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center text-cyan-400">
              <FolderGit2 className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-bold text-sm text-white">{repoData.repo_name}</h3>
                <a
                  href={repoUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-2 py-0.5 rounded bg-cyan-950/70 border border-cyan-500/30 text-[10px] font-mono text-cyan-300 hover:text-white flex items-center gap-1 transition-colors"
                  title="Visit full repository on GitHub"
                >
                  <span>Visit GitHub Repo</span>
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>
              <p className="text-[11px] text-slate-400 truncate max-w-xs">{repoUrl}</p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* View Tabs */}
        <div className="flex border-b border-slate-800 bg-[#07070b] text-xs">
          <button
            onClick={() => setActiveTab('files')}
            className={`flex-1 py-2.5 font-semibold flex items-center justify-center gap-1.5 transition-colors cursor-pointer ${
              activeTab === 'files'
                ? 'text-cyan-400 border-b-2 border-cyan-400 bg-cyan-950/20'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <FileCode className="w-3.5 h-3.5" />
            <span>Files ({repoData.files?.length || 0})</span>
          </button>

          <button
            onClick={() => setActiveTab('commits')}
            className={`flex-1 py-2.5 font-semibold flex items-center justify-center gap-1.5 transition-colors cursor-pointer ${
              activeTab === 'commits'
                ? 'text-cyan-400 border-b-2 border-cyan-400 bg-cyan-950/20'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <GitCommit className="w-3.5 h-3.5" />
            <span>Commits ({repoData.commits?.length || 0})</span>
          </button>

          <button
            onClick={() => setActiveTab('prs')}
            className={`flex-1 py-2.5 font-semibold flex items-center justify-center gap-1.5 transition-colors cursor-pointer ${
              activeTab === 'prs'
                ? 'text-cyan-400 border-b-2 border-cyan-400 bg-cyan-950/20'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <GitPullRequest className="w-3.5 h-3.5" />
            <span>Pull Requests ({repoData.prs?.length || 0})</span>
          </button>
        </div>

        {/* Search Filter */}
        <div className="p-3 border-b border-slate-800/80 bg-slate-900/30">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={filterQuery}
              onChange={(e) => setFilterQuery(e.target.value)}
              placeholder={`Filter ${activeTab}...`}
              className="w-full pl-8 pr-3 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-cyan-500"
            />
          </div>
        </div>

        {/* Content List */}
        <div className="p-4 flex-1 overflow-y-auto space-y-2">
          {activeTab === 'files' && (
            <div className="space-y-2">
              {filteredFiles.map((file, idx) => {
                const fileUrl = file.file_url || `${repoUrl}/blob/main/${file.path}`;
                return (
                  <div
                    key={idx}
                    className="p-3 rounded-xl bg-slate-900/60 border border-slate-800/80 hover:border-slate-700 flex items-center justify-between transition-colors group"
                  >
                    <div className="truncate mr-3">
                      <div className="font-mono text-xs text-slate-200 font-medium truncate flex items-center gap-2">
                        <FileCode className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                        <span>{file.path}</span>
                      </div>
                      <div className="text-[10px] text-slate-500 mt-0.5">
                        {file.language} • {file.lines} lines
                        {file.contributors && file.contributors.length > 0 && ` • By ${file.contributors.join(', ')}`}
                      </div>
                    </div>

                    <a
                      href={fileUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-cyan-950 hover:border-cyan-500/50 border border-slate-700 text-xs text-slate-300 hover:text-cyan-300 flex items-center gap-1.5 transition-all shrink-0 cursor-pointer"
                      title="View file source on GitHub"
                    >
                      <span className="text-[11px]">Visit</span>
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                );
              })}
            </div>
          )}

          {activeTab === 'commits' && (
            <div className="space-y-2">
              {filteredCommits.map((c, idx) => {
                const commitUrl = c.commit_url || `${repoUrl}/commit/${c.sha}`;
                return (
                  <div
                    key={idx}
                    className="p-3 rounded-xl bg-slate-900/60 border border-slate-800/80 hover:border-slate-700 flex items-center justify-between transition-colors"
                  >
                    <div className="truncate mr-3">
                      <div className="text-xs text-slate-200 font-medium truncate">{c.message}</div>
                      <div className="text-[10px] text-slate-500 mt-0.5 flex items-center gap-2">
                        <span className="font-mono text-cyan-400">{c.sha}</span>
                        <span>by {c.author}</span>
                        {c.date && <span>• {c.date}</span>}
                      </div>
                    </div>

                    <a
                      href={commitUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-cyan-950 hover:border-cyan-500/50 border border-slate-700 text-xs text-slate-300 hover:text-cyan-300 flex items-center gap-1.5 transition-all shrink-0 cursor-pointer"
                      title="View commit diff on GitHub"
                    >
                      <span className="text-[11px]">Diff</span>
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                );
              })}
            </div>
          )}

          {activeTab === 'prs' && (
            <div className="space-y-2">
              {filteredPrs.map((pr, idx) => {
                const prUrl = pr.pr_url || `${repoUrl}/pull/${pr.id}`;
                return (
                  <div
                    key={idx}
                    className="p-3 rounded-xl bg-slate-900/60 border border-slate-800/80 hover:border-slate-700 flex items-center justify-between transition-colors"
                  >
                    <div className="truncate mr-3">
                      <div className="text-xs text-slate-200 font-medium truncate flex items-center gap-1.5">
                        <span className="font-mono text-cyan-400">#{pr.id}</span>
                        <span>{pr.title}</span>
                      </div>
                      <div className="text-[10px] text-slate-500 mt-0.5 flex items-center gap-2">
                        <span>by {pr.author}</span>
                        <span className="px-1.5 py-0.2 rounded bg-purple-950/60 text-purple-300 border border-purple-500/30 uppercase text-[9px]">
                          {pr.state}
                        </span>
                      </div>
                    </div>

                    <a
                      href={prUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-cyan-950 hover:border-cyan-500/50 border border-slate-700 text-xs text-slate-300 hover:text-cyan-300 flex items-center gap-1.5 transition-all shrink-0 cursor-pointer"
                      title="Open PR on GitHub"
                    >
                      <span className="text-[11px]">View PR</span>
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-3 border-t border-slate-800/80 bg-slate-950 flex items-center justify-between text-xs text-slate-400">
          <span>Live repository reference via GitHub REST API</span>
          <a
            href={repoUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-cyan-400 hover:underline flex items-center gap-1"
          >
            <span>github.com/{repoData.repo_name}</span>
            <ExternalLink className="w-3 h-3" />
          </a>
        </div>
      </div>
    </div>
  );
};
