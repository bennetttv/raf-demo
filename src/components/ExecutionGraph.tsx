import { useEffect, useMemo, useRef } from 'react';
import * as d3 from 'd3';

export interface GraphNode extends d3.SimulationNodeDatum {
  id: string;
  label: string;
  type: 'problem' | 'decompose' | 'step' | 'voter' | 'answer' | 'result';
  color: string;
  radius: number;
  fullText?: string;
  active?: boolean;
}

export interface GraphLink extends d3.SimulationLinkDatum<GraphNode> {
  id: string;
  source: string | GraphNode;
  target: string | GraphNode;
  color: string;
  opacity?: number;
}

interface Props {
  nodes: GraphNode[];
  links: GraphLink[];
}

const WIDTH = 360;
const HEIGHT = 760;

export function ExecutionGraph({ nodes, links }: Props) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const simulationRef = useRef<d3.Simulation<GraphNode, GraphLink> | null>(null);
  const zoomLayerRef = useRef<SVGGElement | null>(null);
  const initializedRef = useRef(false);

  const graphData = useMemo(() => {
    // Filter out links that reference nodes not yet in the graph (prevents D3 crash)
    const nodeIds = new Set(nodes.map((n) => n.id));
    const safeLinks = links.filter((l) => {
      const src = typeof l.source === 'string' ? l.source : l.source.id;
      const tgt = typeof l.target === 'string' ? l.target : l.target.id;
      return nodeIds.has(src) && nodeIds.has(tgt);
    });
    return { nodes, links: safeLinks };
  }, [nodes, links]);

  useEffect(() => {
    if (!svgRef.current || initializedRef.current) return;

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();
    svg.attr('viewBox', `0 0 ${WIDTH} ${HEIGHT}`);

    const defs = svg.append('defs');
    const glow = defs.append('filter').attr('id', 'result-glow');
    glow.append('feGaussianBlur').attr('stdDeviation', '5').attr('result', 'coloredBlur');
    const merge = glow.append('feMerge');
    merge.append('feMergeNode').attr('in', 'coloredBlur');
    merge.append('feMergeNode').attr('in', 'SourceGraphic');

    const zoomLayer = svg.append('g').attr('class', 'zoom-layer');
    zoomLayerRef.current = zoomLayer.node();
    zoomLayer.append('g').attr('class', 'links');
    zoomLayer.append('g').attr('class', 'nodes');

    svg.call(
      d3
        .zoom<SVGSVGElement, unknown>()
        .scaleExtent([0.5, 1.7])
        .on('zoom', (event) => {
          zoomLayer.attr('transform', event.transform);
        }),
    );

    simulationRef.current = d3
      .forceSimulation<GraphNode>(graphData.nodes)
      .force('link', d3.forceLink<GraphNode, GraphLink>(graphData.links).id((d) => d.id).distance(90).strength(0.6))
      .force('charge', d3.forceManyBody().strength(-260))
      .force('center', d3.forceCenter(WIDTH / 2, HEIGHT / 2))
      .force('collide', d3.forceCollide<GraphNode>().radius((d) => d.radius + 14))
      .force('y', d3.forceY(HEIGHT / 2).strength(0.04));

    initializedRef.current = true;
  }, [graphData]);

  useEffect(() => {
    if (!svgRef.current || !simulationRef.current || !zoomLayerRef.current) return;

    const svg = d3.select(svgRef.current);
    const zoomLayer = d3.select(zoomLayerRef.current);
    const linkGroup = zoomLayer.select<SVGGElement>('.links');
    const nodeGroup = zoomLayer.select<SVGGElement>('.nodes');

    const drag = d3
      .drag<SVGGElement, GraphNode>()
      .on('start', (event, d) => {
        if (!event.active) simulationRef.current?.alphaTarget(0.3).restart();
        d.fx = d.x;
        d.fy = d.y;
      })
      .on('drag', (_event, d) => {
        d.fx = _event.x;
        d.fy = _event.y;
      })
      .on('end', (event, d) => {
        if (!event.active) simulationRef.current?.alphaTarget(0);
        d.fx = null;
        d.fy = null;
      });

    const tooltip = svg
      .selectAll<SVGTextElement, string>('.graph-tooltip')
      .data([1])
      .join('text')
      .attr('class', 'graph-tooltip')
      .attr('fill', '#f9fafb')
      .attr('font-size', 11)
      .attr('opacity', 0)
      .attr('pointer-events', 'none');

    const linkSelection = linkGroup.selectAll<SVGLineElement, GraphLink>('.graph-link').data(graphData.links, (d) => d.id);
    linkSelection.exit().remove();
    const linkEnter = linkSelection
      .enter()
      .append('line')
      .attr('class', 'graph-link')
      .attr('stroke-width', 2)
      .attr('stroke-linecap', 'round');

    const mergedLinks = linkEnter.merge(linkSelection).attr('stroke', (d) => d.color).attr('opacity', (d) => d.opacity ?? 0.6);

    const nodeSelection = nodeGroup.selectAll<SVGGElement, GraphNode>('.graph-node').data(graphData.nodes, (d) => d.id);
    nodeSelection.exit().remove();

    const nodeEnter = nodeSelection
      .enter()
      .append('g')
      .attr('class', (d) => `graph-node node-${d.type}`)
      .style('cursor', 'grab')
      .call(drag)
      .on('mouseenter', function (_event, d) {
        d3.select(this).select('circle').attr('stroke-width', 3);
        tooltip.attr('opacity', 1).text(d.fullText ?? d.label);
      })
      .on('mousemove', function (event) {
        const [x, y] = d3.pointer(event, svg.node());
        tooltip.attr('x', x + 12).attr('y', y - 12);
      })
      .on('mouseleave', function () {
        d3.select(this).select('circle').attr('stroke-width', 1.5);
        tooltip.attr('opacity', 0);
      });

    nodeEnter
      .append('circle')
      .attr('r', 0)
      .attr('fill', (d) => d.color)
      .attr('stroke', 'rgba(255,255,255,0.25)')
      .attr('stroke-width', 1.5)
      .transition()
      .duration(500)
      .attr('r', (d) => d.radius);

    nodeEnter
      .append('text')
      .attr('text-anchor', 'middle')
      .attr('dy', 4)
      .attr('fill', '#f9fafb')
      .attr('font-size', (d) => (d.type === 'step' ? 10 : 11))
      .attr('font-family', 'JetBrains Mono')
      .text((d) => d.label.length > 12 ? `${d.label.slice(0, 11)}…` : d.label);

    const mergedNodes = nodeEnter
      .merge(nodeSelection)
      .attr('class', (d) => `graph-node node-${d.type}${d.active ? ' active' : ''}`);

    mergedNodes
      .select('circle')
      .attr('fill', (d) => d.color)
      .attr('r', (d) => d.radius)
      .attr('filter', (d) => (d.type === 'result' ? 'url(#result-glow)' : null));

    (simulationRef.current.force('link') as d3.ForceLink<GraphNode, GraphLink>).links(graphData.links);
    simulationRef.current.nodes(graphData.nodes);
    simulationRef.current.on('tick', () => {
      mergedLinks
        .attr('x1', (d) => (d.source as GraphNode).x ?? 0)
        .attr('y1', (d) => (d.source as GraphNode).y ?? 0)
        .attr('x2', (d) => (d.target as GraphNode).x ?? 0)
        .attr('y2', (d) => (d.target as GraphNode).y ?? 0);

      mergedNodes.attr('transform', (d) => `translate(${d.x ?? 0},${d.y ?? 0})`);
    });

    simulationRef.current.alpha(0.35).restart();
  }, [graphData]);

  return <svg ref={svgRef} className="h-full w-full rounded-[28px] bg-transparent" aria-label="RAF execution graph" />;
}
