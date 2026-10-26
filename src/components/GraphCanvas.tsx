import React, { useEffect, useRef, useState } from 'react';
import * as d3 from 'd3';
import { GraphNode, GraphEdge, NetworkStats } from '../types';
import { ZoomIn, ZoomOut, RotateCcw, Compass } from 'lucide-react';

interface GraphCanvasProps {
  nodes: GraphNode[];
  edges: GraphEdge[];
  selectedNode: GraphNode | null;
  onSelectNode: (node: GraphNode | null) => void;
  networkStats?: NetworkStats;
  layoutMode?: 'constellation' | 'force';
}

const LASER_COLORS = new Set(['#ff1744', '#ffd600', '#00e5ff']);

export const GraphCanvas: React.FC<GraphCanvasProps> = ({
  nodes,
  edges,
  selectedNode,
  onSelectNode,
  networkStats,
  layoutMode = 'constellation',
}) => {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [hoveredEdge, setHoveredEdge] = useState<GraphEdge | null>(null);
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number } | null>(null);
  const zoomBehaviorRef = useRef<d3.ZoomBehavior<SVGSVGElement, unknown> | null>(null);

  // Always call the latest callback without rebuilding the simulation
  const onSelectRef = useRef(onSelectNode);
  onSelectRef.current = onSelectNode;

  // ---------------------------------------------------------------------------
  // Main effect: builds the graph. Selection is NOT a dependency, so clicking a
  // node no longer re-randomises the layout.
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!svgRef.current || !containerRef.current) return;

    const width = containerRef.current.clientWidth || 900;
    const height = containerRef.current.clientHeight || 650;
    const centerX = width / 2;
    const centerY = height / 2;

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    // Glow filters
    const defs = svg.append('defs');
    const addGlow = (id: string, deviation: string) => {
      const f = defs.append('filter').attr('id', id).attr('x', '-50%').attr('y', '-50%').attr('width', '200%').attr('height', '200%');
      f.append('feGaussianBlur').attr('stdDeviation', deviation).attr('result', 'coloredBlur');
      const m = f.append('feMerge');
      m.append('feMergeNode').attr('in', 'coloredBlur');
      m.append('feMergeNode').attr('in', 'SourceGraphic');
    };
    addGlow('laser-crimson-glow', '4');
    addGlow('laser-gold-glow', '3.5');
    addGlow('laser-cyan-glow', '3');

    const g = svg.append('g').attr('class', 'graph-viewport');

    // Radar rings
    const radarGroup = g.append('g').attr('class', 'radar-grid');
    const maxRadius = Math.min(width, height) * 0.44;
    const ringRadii = [maxRadius * 0.28, maxRadius * 0.52, maxRadius * 0.76, maxRadius, maxRadius * 1.15];
    ringRadii.forEach((r, idx) => {
      radarGroup
        .append('circle')
        .attr('cx', centerX)
        .attr('cy', centerY)
        .attr('r', r)
        .attr('fill', 'none')
        .attr('stroke', idx === ringRadii.length - 1 ? 'rgba(255, 255, 255, 0.04)' : 'rgba(255, 255, 255, 0.08)')
        .attr('stroke-width', 1)
        .attr('stroke-dasharray', idx % 2 === 1 ? '3 5' : 'none');
    });
    for (let angle = 0; angle < 360; angle += 45) {
      const rad = (angle * Math.PI) / 180;
      radarGroup
        .append('line')
        .attr('x1', centerX)
        .attr('y1', centerY)
        .attr('x2', centerX + Math.cos(rad) * maxRadius * 1.15)
        .attr('y2', centerY + Math.sin(rad) * maxRadius * 1.15)
        .attr('stroke', 'rgba(255, 255, 255, 0.04)')
        .attr('stroke-dasharray', '2 4');
    }

    // Copy node data for the simulation (d3 mutates x/y/fx/fy)
    const nodesData: any[] = nodes.map((d, index) => {
      const type = (d as any).type;
      if (layoutMode === 'constellation') {
        const angle = (index / Math.max(1, nodes.length)) * 2 * Math.PI;
        const radius = type === 'file' ? maxRadius * 0.95 : type === 'ast_function' ? maxRadius * 0.75 : maxRadius * 0.42;
        return {
          ...d,
          x: centerX + Math.cos(angle) * radius + (Math.random() - 0.5) * 40,
          y: centerY + Math.sin(angle) * radius + (Math.random() - 0.5) * 40,
        };
      }
      return { ...d, x: centerX + (Math.random() - 0.5) * 200, y: centerY + (Math.random() - 0.5) * 200 };
    });

    // Resolve edges strictly by node id; drop anything that does not resolve
    const ids = new Set(nodesData.map((n) => String(n.id)));
    const edgesData: any[] = edges
      .map((e) => {
        const s = typeof e.source === 'object' ? (e.source as any).id : e.source;
        const t = typeof e.target === 'object' ? (e.target as any).id : e.target;
        return ids.has(String(s)) && ids.has(String(t)) ? { ...e, source: String(s), target: String(t) } : null;
      })
      .filter((e): e is NonNullable<typeof e> => e !== null);

    const isCollab = (d: any) => !d.type || d.type === 'collaboration';
    const edgeColor = (d: any) =>
      LASER_COLORS.has(d.color) ? d.color : d.type === 'contains' ? '#6b21a8' : 'rgba(255, 255, 255, 0.16)';
    const edgeFilter = (d: any) =>
      d.color === '#ff1744' ? 'url(#laser-crimson-glow)'
      : d.color === '#ffd600' ? 'url(#laser-gold-glow)'
      : d.color === '#00e5ff' ? 'url(#laser-cyan-glow)'
      : null;

    const edgesGroup = g.append('g').attr('class', 'edges');
    const nodesGroup = g.append('g').attr('class', 'nodes');

    const simulation = d3
      .forceSimulation(nodesData)
      .force(
        'link',
        d3
          .forceLink(edgesData)
          .id((d: any) => d.id)
          .distance((d: any) => (!isCollab(d) ? 90 : d.weight >= 6 ? 110 : 160))
          .strength(0.35)
      )
      .force('charge', d3.forceManyBody().strength((d: any) => (d.type === 'file' ? -350 : -250)))
      .force('collide', d3.forceCollide().radius((d: any) => (d.type === 'file' ? 50 : 36)).iterations(2))
      .force('center', d3.forceCenter(centerX, centerY).strength(0.08));

    if (layoutMode === 'constellation') {
      simulation.force(
        'radial',
        d3
          .forceRadial(
            (d: any) => (d.type === 'file' ? maxRadius * 0.92 : d.type === 'ast_function' ? maxRadius * 0.7 : maxRadius * 0.38),
            centerX,
            centerY
          )
          .strength(0.55)
      );
    }

    // Edges
    const linkElements = edgesGroup
      .selectAll('line')
      .data(edgesData)
      .enter()
      .append('line')
      .attr('stroke', edgeColor)
      .attr('stroke-width', (d: any) => (!isCollab(d) ? 1.2 : d.weight >= 6 ? 3.2 : d.weight >= 3 ? 2.4 : 1.4))
      .attr('stroke-opacity', (d: any) => (isCollab(d) && d.weight >= 3 ? 0.95 : 0.6))
      .attr('filter', edgeFilter)
      .attr('cursor', 'pointer')
      .on('mouseenter', (event, d: any) => {
        setHoveredEdge(d);
        setTooltipPos({ x: event.clientX, y: event.clientY });
      })
      .on('mouseleave', () => setHoveredEdge(null));

    // Nodes
    const nodeElements = nodesGroup
      .selectAll('g.node')
      .data(nodesData)
      .enter()
      .append('g')
      .attr('class', 'node')
      .attr('cursor', 'pointer')
      .call(
        d3
          .drag<SVGGElement, any>()
          .on('start', (event, d) => {
            if (!event.active) simulation.alphaTarget(0.3).restart();
            d.fx = d.x;
            d.fy = d.y;
          })
          .on('drag', (event, d) => {
            d.fx = event.x;
            d.fy = event.y;
          })
          .on('end', (event, d) => {
            if (!event.active) simulation.alphaTarget(0);
            d.fx = null;
            d.fy = null;
          })
      )
      .on('click', (_event, d: any) => onSelectRef.current(d));

    nodeElements.each(function (d: any) {
      const el = d3.select(this);

      if (d.type === 'file') {
        const cardW = 96;
        const cardH = 50;

        el.append('rect')
          .attr('class', 'node-ring')
          .attr('x', -cardW / 2)
          .attr('y', -cardH / 2)
          .attr('width', cardW)
          .attr('height', cardH)
          .attr('rx', 4)
          .attr('ry', 4)
          .attr('fill', '#0e0e15')
          .attr('stroke', '#28283a')
          .attr('stroke-width', 1);

        el.append('rect')
          .attr('x', -10)
          .attr('y', -16)
          .attr('width', 20)
          .attr('height', 14)
          .attr('rx', 2)
          .attr('fill', 'none')
          .attr('stroke', '#64748b')
          .attr('stroke-width', 1);

        el.append('line')
          .attr('x1', -4)
          .attr('y1', -9)
          .attr('x2', 4)
          .attr('y2', -9)
          .attr('stroke', '#64748b')
          .attr('stroke-width', 1);

        const label = String(d.label || '');
        el.append('text')
          .attr('x', 0)
          .attr('y', 14)
          .attr('text-anchor', 'middle')
          .attr('fill', '#cbd5e1')
          .attr('font-size', '9.5px')
          .attr('font-family', 'Fira Code, monospace')
          .text(label.length > 13 ? label.substring(0, 11) + '..' : label);

        el.append('title').text(`${d.full_path || label} (click to open on GitHub)`);
      } else if (d.type === 'ast_function') {
        const tagW = 75;
        const tagH = 26;

        el.append('rect')
          .attr('class', 'node-ring')
          .attr('x', -tagW / 2)
          .attr('y', -tagH / 2)
          .attr('width', tagW)
          .attr('height', tagH)
          .attr('rx', 13)
          .attr('ry', 13)
          .attr('fill', '#15102a')
          .attr('stroke', '#a855f7')
          .attr('stroke-width', 1.5)
          .attr('filter', 'url(#laser-cyan-glow)');

        const label = String(d.label || '');
        el.append('text')
          .attr('x', 0)
          .attr('y', 4)
          .attr('text-anchor', 'middle')
          .attr('fill', '#e9d5ff')
          .attr('font-size', '9px')
          .attr('font-family', 'Fira Code, monospace')
          .text(label.length > 10 ? label.substring(0, 9) + '..' : label);

        el.append('title').text(
          `${d.name || label} in ${d.file_path || ''}` +
            (d.owner ? ` — owner: ${d.owner}${d.ownership_pct != null ? ` (${Math.round(d.ownership_pct)}%)` : ''}` : '')
        );
      } else {
        // Contributor
        const radius = 22;
        const color = d.color || '#00e5ff';

        el.append('circle')
          .attr('class', 'node-aura')
          .attr('r', radius + 5)
          .attr('fill', color)
          .attr('opacity', 0.15)
          .attr('filter', color === '#ff1744' ? 'url(#laser-crimson-glow)' : 'url(#laser-cyan-glow)');

        el.append('circle')
          .attr('class', 'node-ring')
          .attr('r', radius)
          .attr('fill', '#09090e')
          .attr('stroke', color)
          .attr('stroke-width', 2.5);

        el.append('text')
          .attr('x', 0)
          .attr('y', 5)
          .attr('text-anchor', 'middle')
          .attr('fill', color)
          .attr('font-size', '12px')
          .attr('font-weight', '700')
          .attr('font-family', 'Fira Code, monospace')
          .text(d.badge || String(d.id).substring(0, 2).toUpperCase());

        const displayName = String(d.name || d.label || d.id || 'Contributor');
        const pillW = Math.min(Math.max(displayName.length * 7.2 + 14, 48), 120);

        el.append('rect')
          .attr('class', 'node-pill')
          .attr('x', -pillW / 2)
          .attr('y', radius + 6)
          .attr('width', pillW)
          .attr('height', 18)
          .attr('rx', 4)
          .attr('fill', '#090912')
          .attr('stroke', 'rgba(255, 255, 255, 0.15)')
          .attr('stroke-width', 1);

        el.append('text')
          .attr('class', 'node-name')
          .attr('x', 0)
          .attr('y', radius + 19)
          .attr('text-anchor', 'middle')
          .attr('fill', '#f1f5f9')
          .attr('font-size', '10.5px')
          .attr('font-weight', '600')
          .attr('font-family', 'Inter, system-ui, sans-serif')
          .text(displayName.length > 15 ? displayName.substring(0, 13) + '..' : displayName);
      }
    });

    simulation.on('tick', () => {
      linkElements
        .attr('x1', (d: any) => d.source.x)
        .attr('y1', (d: any) => d.source.y)
        .attr('x2', (d: any) => d.target.x)
        .attr('y2', (d: any) => d.target.y);
      nodeElements.attr('transform', (d: any) => `translate(${d.x}, ${d.y})`);
    });

    const zoom = d3
      .zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.3, 3])
      .on('zoom', (event) => g.attr('transform', event.transform));
    zoomBehaviorRef.current = zoom;
    svg.call(zoom);

    return () => {
      simulation.stop();
    };
  }, [nodes, edges, layoutMode]);

  // ---------------------------------------------------------------------------
  // Selection highlight: restyles existing elements, never rebuilds the graph.
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!svgRef.current) return;
    d3.select(svgRef.current)
      .selectAll<SVGGElement, any>('g.node')
      .each(function (d) {
        const on = d.id === selectedNode?.id;
        const el = d3.select(this);
        const ring = el.select('.node-ring');

        if (d.type === 'file') {
          ring
            .attr('stroke', on ? '#00e5ff' : '#28283a')
            .attr('stroke-width', on ? 2 : 1)
            .attr('filter', on ? 'url(#laser-cyan-glow)' : null);
        } else if (d.type !== 'ast_function') {
          const color = d.color || '#00e5ff';
          ring.attr('stroke-width', on ? 3.5 : 2.5);
          el.select('.node-aura').attr('opacity', on ? 0.35 : 0.15);
          el.select('.node-pill')
            .attr('stroke', on ? color : 'rgba(255, 255, 255, 0.15)')
            .attr('stroke-width', on ? 1.5 : 1);
          el.select('.node-name').attr('fill', on ? '#ffffff' : '#f1f5f9');
        }
      });
  }, [selectedNode, nodes, edges, layoutMode]);

  // Zoom controls
  const handleZoomIn = () => {
    if (svgRef.current && zoomBehaviorRef.current) {
      d3.select(svgRef.current).transition().duration(250).call(zoomBehaviorRef.current.scaleBy, 1.25);
    }
  };
  const handleZoomOut = () => {
    if (svgRef.current && zoomBehaviorRef.current) {
      d3.select(svgRef.current).transition().duration(250).call(zoomBehaviorRef.current.scaleBy, 0.8);
    }
  };
  const handleResetZoom = () => {
    if (svgRef.current && zoomBehaviorRef.current) {
      d3.select(svgRef.current).transition().duration(300).call(zoomBehaviorRef.current.transform, d3.zoomIdentity);
    }
  };

  const tooltipTitle = (e: GraphEdge) =>
    e.type === 'authored_file' ? 'Authored File'
    : e.type === 'owns_ast_function' ? 'Function Ownership'
    : e.type === 'contains' ? 'File contains Function'
    : 'Collaboration Connection';

  return (
    <div ref={containerRef} className="relative w-full h-full bg-[#060609] overflow-hidden select-none">
      <svg ref={svgRef} className="w-full h-full cursor-grab active:cursor-grabbing" />

      {nodes.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center text-sm text-slate-500 pointer-events-none">
          No contributors found for this repository in the sampled history.
        </div>
      )}

      {/* Floating Canvas Controls */}
      <div className="absolute bottom-5 right-5 flex items-center gap-1.5 p-1.5 rounded-lg bg-slate-900/80 border border-slate-800 backdrop-blur-md z-10 shadow-xl">
        <button
          onClick={handleZoomIn}
          title="Zoom In"
          className="p-2 rounded hover:bg-slate-800 text-slate-300 hover:text-white transition-colors cursor-pointer"
        >
          <ZoomIn className="w-4 h-4" />
        </button>
        <button
          onClick={handleZoomOut}
          title="Zoom Out"
          className="p-2 rounded hover:bg-slate-800 text-slate-300 hover:text-white transition-colors cursor-pointer"
        >
          <ZoomOut className="w-4 h-4" />
        </button>
        <button
          onClick={handleResetZoom}
          title="Reset View"
          className="p-2 rounded hover:bg-slate-800 text-slate-300 hover:text-white transition-colors cursor-pointer"
        >
          <RotateCcw className="w-4 h-4" />
        </button>
      </div>

      {/* Legend */}
      <div className="absolute top-5 left-5 p-3 rounded-xl bg-slate-950/80 border border-slate-800/80 backdrop-blur-md z-10 text-xs shadow-2xl flex flex-col gap-2 pointer-events-none">
        <div className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold flex items-center gap-1.5">
          <Compass className="w-3.5 h-3.5 text-cyan-400" />
          <span>Graph Legend</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-4 h-0.5 bg-[#ff1744] shadow-[0_0_8px_#ff1744]" />
          <span className="text-slate-300">Strong collaboration (co-edits / reviews)</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-4 h-0.5 bg-[#ffd600] shadow-[0_0_8px_#ffd600]" />
          <span className="text-slate-300">Includes PR reviews</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-4 h-0.5 bg-[#00e5ff] shadow-[0_0_8px_#00e5ff]" />
          <span className="text-slate-300">Co-edits / function ownership</span>
        </div>
        {networkStats && (
          <div className="text-[10px] text-slate-500 pt-1 border-t border-slate-800">
            {networkStats.total_contributors} contributors • {networkStats.total_collaborations} links • density{' '}
            {networkStats.graph_density}
          </div>
        )}
      </div>

      {/* Edge Hover Tooltip */}
      {hoveredEdge && tooltipPos && (
        <div
          style={{ top: tooltipPos.y - 120, left: tooltipPos.x - 100 }}
          className="fixed pointer-events-none z-30 p-2.5 rounded-lg bg-slate-900 border border-slate-700 text-xs shadow-2xl backdrop-blur-md max-w-xs"
        >
          <div className="font-semibold text-cyan-300 mb-1">{tooltipTitle(hoveredEdge)}</div>
          {(!hoveredEdge.type || hoveredEdge.type === 'collaboration') && (
            <>
              <div className="text-slate-300">
                Co-edits: <span className="font-bold text-white">{hoveredEdge.co_edits || 0}</span>
              </div>
              <div className="text-slate-300">
                PR Reviews: <span className="font-bold text-white">{hoveredEdge.pr_reviews || 0}</span>
              </div>
              <div className="text-slate-300">
                Shared function ownership:{' '}
                <span className="font-bold text-white">{hoveredEdge.function_co_ownership || 0}</span>
              </div>
              {hoveredEdge.shared_files && hoveredEdge.shared_files.length > 0 && (
                <div className="text-slate-400 text-[10px] mt-1 font-mono truncate">
                  Files: {hoveredEdge.shared_files.join(', ')}
                </div>
              )}
            </>
          )}
          {hoveredEdge.type === 'authored_file' && (
            <div className="text-slate-300">
              Commits to this file (sampled): <span className="font-bold text-white">{hoveredEdge.commits ?? 0}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
};