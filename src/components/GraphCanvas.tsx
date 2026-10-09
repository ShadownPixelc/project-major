import React, { useEffect, useRef, useState } from 'react';
import * as d3 from 'd3';
import { ContributorNode, FileNode, AstFunctionNode, GraphNode, GraphEdge, NetworkStats } from '../types';
import { ZoomIn, ZoomOut, RotateCcw, Compass, Layers, Info } from 'lucide-react';

interface GraphCanvasProps {
  nodes: GraphNode[];
  edges: GraphEdge[];
  selectedNode: GraphNode | null;
  onSelectNode: (node: GraphNode | null) => void;
  networkStats?: NetworkStats;
  layoutMode?: 'constellation' | 'force';
}

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

  useEffect(() => {
    if (!svgRef.current || !containerRef.current) return;

    const width = containerRef.current.clientWidth || 900;
    const height = containerRef.current.clientHeight || 650;
    const centerX = width / 2;
    const centerY = height / 2;

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    // Definitions: Filters and Glow effects
    const defs = svg.append('defs');

    // Laser Crimson Glow filter
    const crimsonFilter = defs.append('filter').attr('id', 'laser-crimson-glow').attr('x', '-50%').attr('y', '-50%').attr('width', '200%').attr('height', '200%');
    crimsonFilter.append('feGaussianBlur').attr('stdDeviation', '4').attr('result', 'coloredBlur');
    const crimsonMerge = crimsonFilter.append('feMerge');
    crimsonMerge.append('feMergeNode').attr('in', 'coloredBlur');
    crimsonMerge.append('feMergeNode').attr('in', 'SourceGraphic');

    // Laser Gold Glow filter
    const goldFilter = defs.append('filter').attr('id', 'laser-gold-glow').attr('x', '-50%').attr('y', '-50%').attr('width', '200%').attr('height', '200%');
    goldFilter.append('feGaussianBlur').attr('stdDeviation', '3.5').attr('result', 'coloredBlur');
    const goldMerge = goldFilter.append('feMerge');
    goldMerge.append('feMergeNode').attr('in', 'coloredBlur');
    goldMerge.append('feMergeNode').attr('in', 'SourceGraphic');

    // Laser Cyan Glow filter
    const cyanFilter = defs.append('filter').attr('id', 'laser-cyan-glow').attr('x', '-50%').attr('y', '-50%').attr('width', '200%').attr('height', '200%');
    cyanFilter.append('feGaussianBlur').attr('stdDeviation', '3').attr('result', 'coloredBlur');
    const cyanMerge = cyanFilter.append('feMerge');
    cyanMerge.append('feMergeNode').attr('in', 'coloredBlur');
    cyanMerge.append('feMergeNode').attr('in', 'SourceGraphic');

    // Root Group for Zoom & Pan
    const g = svg.append('g').attr('class', 'graph-viewport');

    // Background Layer: Orbital Radar Rings (Matched directly to Image 2)
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

    // Radial axis lines
    for (let angle = 0; angle < 360; angle += 45) {
      const rad = (angle * Math.PI) / 180;
      const x2 = centerX + Math.cos(rad) * maxRadius * 1.15;
      const y2 = centerY + Math.sin(rad) * maxRadius * 1.15;
      radarGroup
        .append('line')
        .attr('x1', centerX)
        .attr('y1', centerY)
        .attr('x2', x2)
        .attr('y2', y2)
        .attr('stroke', 'rgba(255, 255, 255, 0.04)')
        .attr('stroke-dasharray', '2 4');
    }

    // Clone data for simulation to avoid mutating props directly
    const nodesData = nodes.map((d, index) => {
      const isFile = (d as any).type === 'file';
      const isAst = (d as any).type === 'ast_function';
      // Compute initial constellation orbital position
      if (layoutMode === 'constellation') {
        const total = nodes.length;
        const angle = (index / total) * 2 * Math.PI;
        const radius = isFile ? maxRadius * 0.95 : (isAst ? maxRadius * 0.75 : maxRadius * 0.42);
        return {
          ...d,
          x: centerX + Math.cos(angle) * radius + (Math.random() - 0.5) * 40,
          y: centerY + Math.sin(angle) * radius + (Math.random() - 0.5) * 40,
        };
      }
      return { ...d, x: centerX + (Math.random() - 0.5) * 200, y: centerY + (Math.random() - 0.5) * 200 };
    });

    // Build safe node ID index supporting lookup by ID, name, or label
    const nodeById = new Map<string, string>();
    nodesData.forEach((n: any) => {
      if (n.id) nodeById.set(String(n.id), String(n.id));
      if (n.name) nodeById.set(String(n.name), String(n.id));
      if (n.label) nodeById.set(String(n.label), String(n.id));
    });

    // Safely resolve and filter edges so d3.forceLink never receives an unknown node ID
    const edgesData = edges
      .map((d) => {
        const rawSource = typeof d.source === 'object' ? (d.source as any).id : d.source;
        const rawTarget = typeof d.target === 'object' ? (d.target as any).id : d.target;
        const resolvedSource = nodeById.get(String(rawSource));
        const resolvedTarget = nodeById.get(String(rawTarget));

        if (!resolvedSource || !resolvedTarget) {
          return null;
        }

        return {
          ...d,
          source: resolvedSource,
          target: resolvedTarget,
        };
      })
      .filter((e): e is NonNullable<typeof e> => e !== null);

    // Groups for Edge rendering
    const edgesGroup = g.append('g').attr('class', 'edges');
    const nodesGroup = g.append('g').attr('class', 'nodes');

    // Simulation Setup
    const simulation = d3
      .forceSimulation(nodesData as any)
      .force(
        'link',
        d3
          .forceLink(edgesData)
          .id((d: any) => d.id)
          .distance((d: any) => (d.weight > 5 ? 110 : 160))
          .strength(0.35)
      )
      .force('charge', d3.forceManyBody().strength((d: any) => (d.type === 'file' ? -350 : -250)))
      .force('collide', d3.forceCollide().radius((d: any) => (d.type === 'file' ? 50 : 36)).iterations(2))
      .force('center', d3.forceCenter(centerX, centerY).strength(0.08));

    if (layoutMode === 'constellation') {
      simulation.force(
        'radial',
        d3.forceRadial(
          (d: any) => (d.type === 'file' ? maxRadius * 0.92 : d.type === 'ast_function' ? maxRadius * 0.7 : maxRadius * 0.38),
          centerX,
          centerY
        ).strength(0.55)
      );
    }

    // Render Edges
    const linkElements = edgesGroup
      .selectAll('line')
      .data(edgesData)
      .enter()
      .append('line')
      .attr('stroke', (d: any) => {
        if (d.color === '#ff1744' || d.weight > 5) return '#ff1744';
        if (d.color === '#ffd600' || d.pr_reviews > 0) return '#ffd600';
        if (d.color === '#00e5ff') return '#00e5ff';
        return 'rgba(255, 255, 255, 0.16)';
      })
      .attr('stroke-width', (d: any) => {
        if (d.weight > 10) return 3.2;
        if (d.weight > 4) return 2.4;
        return 1.4;
      })
      .attr('stroke-opacity', (d: any) => (d.weight > 4 ? 0.95 : 0.6))
      .attr('filter', (d: any) => {
        if (d.color === '#ff1744' || d.weight > 5) return 'url(#laser-crimson-glow)';
        if (d.color === '#ffd600' || d.pr_reviews > 0) return 'url(#laser-gold-glow)';
        if (d.color === '#00e5ff') return 'url(#laser-cyan-glow)';
        return null;
      })
      .attr('cursor', 'pointer')
      .on('mouseenter', (event, d: any) => {
        setHoveredEdge(d);
        setTooltipPos({ x: event.clientX, y: event.clientY });
      })
      .on('mouseleave', () => {
        setHoveredEdge(null);
      });

    // Render Node Containers
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
      .on('click', (_event, d: any) => {
        onSelectNode(d);
      });

    // Render specifics based on node type
    nodeElements.each(function (d: any) {
      const el = d3.select(this);

      if (d.type === 'file') {
        // Render File Tablet Card (Matched to rectangular cards in Image 2)
        const cardW = 96;
        const cardH = 50;

        // Card background
        el.append('rect')
          .attr('x', -cardW / 2)
          .attr('y', -cardH / 2)
          .attr('width', cardW)
          .attr('height', cardH)
          .attr('rx', 4)
          .attr('ry', 4)
          .attr('fill', '#0e0e15')
          .attr('stroke', selectedNode?.id === d.id ? '#00e5ff' : '#28283a')
          .attr('stroke-width', selectedNode?.id === d.id ? 2 : 1)
          .attr('filter', selectedNode?.id === d.id ? 'url(#laser-cyan-glow)' : 'none');

        // File icon placeholder / mini symbol
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

        // File label
        const displayLabel = d.label.length > 13 ? d.label.substring(0, 11) + '..' : d.label;
        el.append('text')
          .attr('x', 0)
          .attr('y', 14)
          .attr('text-anchor', 'middle')
          .attr('fill', '#cbd5e1')
          .attr('font-size', '9.5px')
          .attr('font-family', 'Fira Code, monospace')
          .text(displayLabel);
      } else if (d.type === 'ast_function') {
        // AST Function node: Pill / Diamond tag
        const tagW = 75;
        const tagH = 26;

        el.append('rect')
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

        el.append('text')
          .attr('x', 0)
          .attr('y', 4)
          .attr('text-anchor', 'middle')
          .attr('fill', '#e9d5ff')
          .attr('font-size', '9px')
          .attr('font-family', 'Fira Code, monospace')
          .text(d.label.length > 10 ? d.label.substring(0, 9) + '..' : d.label);
      } else {
        // Contributor Node (Matched directly to Image 2: Glowing Colored Orbs)
        const radius = 22;
        const color = d.color || '#00e5ff';
        const isSelected = selectedNode?.id === d.id;

        // Outer glow aura
        el.append('circle')
          .attr('r', radius + 5)
          .attr('fill', color)
          .attr('opacity', isSelected ? 0.35 : 0.15)
          .attr('filter', color === '#ff1744' ? 'url(#laser-crimson-glow)' : 'url(#laser-cyan-glow)');

        // Outer neon perimeter ring
        el.append('circle')
          .attr('r', radius)
          .attr('fill', '#09090e')
          .attr('stroke', color)
          .attr('stroke-width', isSelected ? 3.5 : 2.5);

        // Inner Badge Number (e.g. 01, 02, 03... as in Image 2)
        el.append('text')
          .attr('x', 0)
          .attr('y', 5)
          .attr('text-anchor', 'middle')
          .attr('fill', color)
          .attr('font-size', '12px')
          .attr('font-weight', '700')
          .attr('font-family', 'Fira Code, monospace')
          .text(d.badge || d.id.substring(0, 2).toUpperCase());

        // Contributor Name below node with high-contrast pill
        const displayName = d.name || d.label || d.id || 'Contributor';
        const pillW = Math.min(Math.max(displayName.length * 7.2 + 14, 48), 120);
        const pillH = 18;

        el.append('rect')
          .attr('x', -pillW / 2)
          .attr('y', radius + 6)
          .attr('width', pillW)
          .attr('height', pillH)
          .attr('rx', 4)
          .attr('fill', '#090912')
          .attr('stroke', isSelected ? color : 'rgba(255, 255, 255, 0.15)')
          .attr('stroke-width', isSelected ? 1.5 : 1);

        el.append('text')
          .attr('x', 0)
          .attr('y', radius + 19)
          .attr('text-anchor', 'middle')
          .attr('fill', isSelected ? '#ffffff' : '#f1f5f9')
          .attr('font-size', '10.5px')
          .attr('font-weight', '600')
          .attr('font-family', 'Inter, system-ui, sans-serif')
          .text(displayName.length > 15 ? displayName.substring(0, 13) + '..' : displayName);
      }
    });

    // Update positions on simulation tick
    simulation.on('tick', () => {
      linkElements
        .attr('x1', (d: any) => d.source.x)
        .attr('y1', (d: any) => d.source.y)
        .attr('x2', (d: any) => d.target.x)
        .attr('y2', (d: any) => d.target.y);

      nodeElements.attr('transform', (d: any) => `translate(${d.x}, ${d.y})`);
    });

    // Zoom and Pan handling
    const zoom = d3
      .zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.3, 3])
      .on('zoom', (event) => {
        g.attr('transform', event.transform);
      });

    zoomBehaviorRef.current = zoom;
    svg.call(zoom);

    return () => {
      simulation.stop();
    };
  }, [nodes, edges, selectedNode, layoutMode]);

  // Zoom control helpers
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

  return (
    <div ref={containerRef} className="relative w-full h-full bg-[#060609] overflow-hidden select-none">
      <svg ref={svgRef} className="w-full h-full cursor-grab active:cursor-grabbing" />

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
          title="Reset Constellation View"
          className="p-2 rounded hover:bg-slate-800 text-slate-300 hover:text-white transition-colors cursor-pointer"
        >
          <RotateCcw className="w-4 h-4" />
        </button>
      </div>

      {/* Legend & Laser Color Indicators - Matched to Image 2 Palette */}
      <div className="absolute top-5 left-5 p-3 rounded-xl bg-slate-950/80 border border-slate-800/80 backdrop-blur-md z-10 text-xs shadow-2xl flex flex-col gap-2 pointer-events-none">
        <div className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold flex items-center gap-1.5">
          <Compass className="w-3.5 h-3.5 text-cyan-400" />
          <span>Graph Legend</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-4 h-0.5 bg-[#ff1744] shadow-[0_0_8px_#ff1744]" />
          <span className="text-slate-300">Co-Editing / Heavy Dependency</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-4 h-0.5 bg-[#ffd600] shadow-[0_0_8px_#ffd600]" />
          <span className="text-slate-300">Pull Request Review Link</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-4 h-0.5 bg-[#00e5ff] shadow-[0_0_8px_#00e5ff]" />
          <span className="text-slate-300">Tree-sitter AST Function Link</span>
        </div>
      </div>

      {/* Edge Hover Tooltip */}
      {hoveredEdge && tooltipPos && (
        <div
          style={{ top: tooltipPos.y - 120, left: tooltipPos.x - 100 }}
          className="fixed pointer-events-none z-30 p-2.5 rounded-lg bg-slate-900 border border-slate-700 text-xs shadow-2xl backdrop-blur-md max-w-xs"
        >
          <div className="font-semibold text-cyan-300 mb-1">Collaboration Connection</div>
          <div className="text-slate-300">
            Co-edits: <span className="font-bold text-white">{hoveredEdge.co_edits || 0}</span>
          </div>
          <div className="text-slate-300">
            PR Reviews: <span className="font-bold text-white">{hoveredEdge.pr_reviews || 0}</span>
          </div>
          {hoveredEdge.shared_files && hoveredEdge.shared_files.length > 0 && (
            <div className="text-slate-400 text-[10px] mt-1 font-mono truncate">
              Files: {hoveredEdge.shared_files.join(', ')}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
