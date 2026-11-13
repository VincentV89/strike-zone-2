import { MalformedMapError, type WaypointNode, type WaypointGraph, type RawWaypointNode } from './types.js';

class WaypointNodeImpl implements WaypointNode {
  neighbors: WaypointNode[] = [];

  constructor(
    readonly id: string,
    readonly position: { x: number; y: number; z: number },
  ) {}
}

class WaypointGraphImpl implements WaypointGraph {
  constructor(readonly nodes: ReadonlyMap<string, WaypointNode>) {}

  findNearest(pos: { x: number; y: number; z: number }): WaypointNode {
    let nearest: WaypointNode | undefined;
    let minDistSq = Infinity;

    for (const node of this.nodes.values()) {
      const dx = node.position.x - pos.x;
      const dy = node.position.y - pos.y;
      const dz = node.position.z - pos.z;
      const distSq = dx * dx + dy * dy + dz * dz;
      if (distSq < minDistSq) {
        minDistSq = distSq;
        nearest = node;
      }
    }

    if (!nearest) {
      throw new MalformedMapError('waypoint graph has no nodes');
    }
    return nearest;
  }
}

export function buildWaypointGraph(rawNodes: RawWaypointNode[]): WaypointGraph {
  if (rawNodes.length < 8) {
    throw new MalformedMapError(
      `insufficient waypoint count: ${rawNodes.length} (minimum is 8)`,
    );
  }

  const nodeMap = new Map<string, WaypointNodeImpl>();

  // Pass 1: construct nodes
  for (const raw of rawNodes) {
    nodeMap.set(raw.id, new WaypointNodeImpl(raw.id, raw.position));
  }

  // Pass 2: resolve neighbor id-refs into live WaypointNode references
  for (const raw of rawNodes) {
    const node = nodeMap.get(raw.id);
    if (!node) continue; // unreachable; satisfies noUncheckedIndexedAccess

    node.neighbors = raw.neighbors.map((neighborId) => {
      const neighbor = nodeMap.get(neighborId);
      if (!neighbor) {
        throw new MalformedMapError(
          `waypoint "${raw.id}" references unknown neighbor "${neighborId}"`,
        );
      }
      return neighbor;
    });

    Object.freeze(node.neighbors);
    Object.freeze(node);
  }

  // BFS connectivity check — entire graph must be one connected component
  const startResult = nodeMap.values().next();
  if (startResult.done) {
    throw new MalformedMapError('waypoint graph has no nodes');
  }
  const start = startResult.value;
  const visited = new Set<string>();
  const queue: WaypointNode[] = [start];
  visited.add(start.id);

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) break;
    for (const neighbor of current.neighbors) {
      if (!visited.has(neighbor.id)) {
        visited.add(neighbor.id);
        queue.push(neighbor);
      }
    }
  }

  if (visited.size !== nodeMap.size) {
    throw new MalformedMapError('waypoint graph is disconnected');
  }

  return new WaypointGraphImpl(new Map(nodeMap));
}
