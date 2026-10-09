import React from 'react';
import { Sliders, Layers, FileCode, Users, GitFork } from 'lucide-react';

interface DepthSliderProps {
  depth: number;
  onChangeDepth: (depth: number) => void;
  disabled?: boolean;
}

export const DepthSlider: React.FC<DepthSliderProps> = ({ depth, onChangeDepth, disabled }) => {
  const depthLabels: Record<number, { title: string; desc: string }> = {
    1: { title: 'Core Backbone', desc: 'Core contributors & primary co-editing backbone' },
    2: { title: 'Contributor Network', desc: 'All active contributors & review interactions' },
    3: { title: 'Repository Files', desc: 'Contributors + connected code modules & file tablets' },
    4: { title: 'AST Functions', desc: 'Tree-sitter parsed function entities & direct ownership' },
    5: { title: 'Full Granular Codebase', desc: 'Complete AST nodes, files, and commit histories' },
  };

  return (
    <div className="flex items-center gap-3 px-3.5 py-2 rounded-xl bg-slate-900/80 border border-slate-800 backdrop-blur-md shadow-lg text-xs">
      <div className="flex items-center gap-1.5 text-cyan-400 font-medium shrink-0">
        <Sliders className="w-3.5 h-3.5" />
        <span className="hidden sm:inline">Graph Depth:</span>
      </div>

      <div className="flex items-center gap-2">
        <input
          type="range"
          min="1"
          max="5"
          step="1"
          value={depth}
          disabled={disabled}
          onChange={(e) => onChangeDepth(Number(e.target.value))}
          className="w-24 sm:w-32 h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-cyan-400"
        />
        <div className="px-2 py-0.5 rounded bg-cyan-950/60 border border-cyan-500/30 text-cyan-300 font-mono font-bold text-xs shrink-0">
          L{depth}
        </div>
      </div>

      <div className="hidden md:flex flex-col text-[11px] leading-tight text-slate-300 pl-1 border-l border-slate-800">
        <span className="font-semibold text-white">{depthLabels[depth]?.title}</span>
        <span className="text-[10px] text-slate-400">{depthLabels[depth]?.desc}</span>
      </div>
    </div>
  );
};
