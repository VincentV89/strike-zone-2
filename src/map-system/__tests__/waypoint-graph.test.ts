import { describe, it, expect } from 'vitest';

import { buildWaypointGraph } from '../waypoint-graph.js';
import { MalformedMapError, type RawWaypointNode } from '../types.js';

function makeLinearChain(count: number): RawWaypointNode[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `wp-${i}`,
    position: { x: i * 10, y: 0, z: 0 },
    neighbors:
      i === 0
        ? [`wp-1`]
        : i === count - 1
          ? [`wp-${count - 2}`]
          : [`wp-${i - 1}`, `wp-${i + 1}`],
  }));
}

describe('buildWaypointGraph', () => {
  it('builds a graph with the correct number of nodes', () => {
    const graph = buildWaypointGraph(makeLinearChain(10));
    expect(graph.nodes.size).toBe(10);
  });

  it('returns nodes indexed by id', () => {
    const graph = buildWaypointGraph(makeLinearChain(8));
    expect(graph.nodes.has('wp-0')).toBe(true);
    expect(graph.nodes.has('wp-7')).toBe(true);
  });

  it('resolves neighbors as live WaypointNode references', () => {
    const graph = buildWaypointGraph(makeLinearChain(8));
    const node = graph.nodes.get('wp-3')!;
    expect(node.neighbors).toHaveLength(2);
    expect(node.neighbors[0]?.id).toBe('wp-2');
    expect(node.neighbors[1]?.id).toBe('wp-4');
  });

  it('preserves node positions', () => {
    const graph = buildWaypointGraph(makeLinearChain(8));
    const node = graph.nodes.get('wp-4')!;
    expect(node.position).toEqual({ x: 40, y: 0, z: 0 });
  });

  it('freezes each node so it is immutable', () => {
    const graph = buildWaypointGraph(makeLinearChain(8));
    const node = graph.nodes.get('wp-0')!;
    expect(Object.isFrozen(node)).toBe(true);
  });

  it('freezes the neighbors array on each node', () => {
    const graph = buildWaypointGraph(makeLinearChain(8));
    const node = graph.nodes.get('wp-0')!;
    expect(Object.isFrozen(node.neighbors)).toBe(true);
  });

  it('throws MalformedMapError when fewer than 8 nodes are provided', () => {
    expect(() => buildWaypointGraph(makeLinearChain(7))).toThrow(MalformedMapError);
  });

  it('error message mentions the actual count when < 8', () => {
    expect(() => buildWaypointGraph(makeLinearChain(5))).toThrow(/5/);
  });

  it('throws MalformedMapError for an unknown neighbor id', () => {
    const nodes: RawWaypointNode[] = [
      ...makeLinearChain(8),
      { id: 'wp-extra', position: { x: 100, y: 0, z: 0 }, neighbors: ['does-not-exist'] },
    ];
    expect(() => buildWaypointGraph(nodes)).toThrow(MalformedMapError);
  });

  it('error for unknown neighbor includes the offending id', () => {
    const nodes: RawWaypointNode[] = [
      ...makeLinearChain(8),
      { id: 'wp-extra', position: { x: 100, y: 0, z: 0 }, neighbors: ['ghost-node'] },
    ];
    expect(() => buildWaypointGraph(nodes)).toThrow(/ghost-node/);
  });

  it('throws MalformedMapError for a disconnected graph', () => {
    // Two isolated subgraphs: nodes 0-3 connected, nodes 4-7 connected, no bridge
    const island1: RawWaypointNode[] = Array.from({ length: 4 }, (_, i) => ({
      id: `a-${i}`,
      position: { x: i, y: 0, z: 0 },
      neighbors: i === 0 ? ['a-1'] : i === 3 ? ['a-2'] : [`a-${i - 1}`, `a-${i + 1}`],
    }));
    const island2: RawWaypointNode[] = Array.from({ length: 4 }, (_, i) => ({
      id: `b-${i}`,
      position: { x: i + 100, y: 0, z: 0 },
      neighbors: i === 0 ? ['b-1'] : i === 3 ? ['b-2'] : [`b-${i - 1}`, `b-${i + 1}`],
    }));
    expect(() => buildWaypointGraph([...island1, ...island2])).toThrow(MalformedMapError);
  });

  it('disconnected graph error message mentions "disconnected"', () => {
    const island1: RawWaypointNode[] = Array.from({ length: 4 }, (_, i) => ({
      id: `a-${i}`,
      position: { x: i, y: 0, z: 0 },
      neighbors: i === 0 ? ['a-1'] : i === 3 ? ['a-2'] : [`a-${i - 1}`, `a-${i + 1}`],
    }));
    const island2: RawWaypointNode[] = Array.from({ length: 4 }, (_, i) => ({
      id: `b-${i}`,
      position: { x: i + 100, y: 0, z: 0 },
      neighbors: i === 0 ? ['b-1'] : i === 3 ? ['b-2'] : [`b-${i - 1}`, `b-${i + 1}`],
    }));
    expect(() => buildWaypointGraph([...island1, ...island2])).toThrow(/disconnected/);
  });
});

describe('WaypointGraph.findNearest', () => {
  it('returns the single node when graph has one cluster', () => {
    const graph = buildWaypointGraph(makeLinearChain(8));
    // Position exactly at wp-3 (x=30)
    const nearest = graph.findNearest({ x: 30, y: 0, z: 0 });
    expect(nearest.id).toBe('wp-3');
  });

  it('returns the closest node for a position between two nodes', () => {
    const graph = buildWaypointGraph(makeLinearChain(8));
    // x=25 is between wp-2 (20) and wp-3 (30) — equidistant; pick whichever
    const nearest = graph.findNearest({ x: 24, y: 0, z: 0 });
    expect(nearest.id).toBe('wp-2');
  });

  it('handles 3D positions correctly', () => {
    const graph = buildWaypointGraph(makeLinearChain(8));
    // Large Y offset brings the query closest to wp-0
    const nearest = graph.findNearest({ x: 5, y: 1000, z: 0 });
    expect(nearest.id).toBe('wp-0');
  });

  it('returns the first node for a query at the origin when chain starts at x=0', () => {
    const graph = buildWaypointGraph(makeLinearChain(8));
    const nearest = graph.findNearest({ x: 0, y: 0, z: 0 });
    expect(nearest.id).toBe('wp-0');
  });
});
