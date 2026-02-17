import { RoutingGraph, GraphEdge, RoutingMode } from '../osm/graph';
import { isEdgeAccessible, canTraverseDirection, getTravelTime, getMaxSpeed, isBarrierBlocking } from './road-types';
import { haversine } from '../osm/parser';

export interface AStarExploreStep {
  type: 'explore';
  edge: GraphEdge;
  fromNodeId: number;
  toNodeId: number;
}

export interface AStarDoneStep {
  type: 'done';
  path: GraphEdge[];
  pathNodeIds: number[];
  totalTime: number;
}

export interface AStarNoRouteStep {
  type: 'no-route';
}

export type AStarStep = AStarExploreStep | AStarDoneStep | AStarNoRouteStep;

// Simple binary min-heap
class MinHeap<T> {
  private items: { key: number; value: T }[] = [];

  get size(): number {
    return this.items.length;
  }

  push(key: number, value: T): void {
    this.items.push({ key, value });
    this.bubbleUp(this.items.length - 1);
  }

  pop(): T | undefined {
    if (this.items.length === 0) return undefined;
    const top = this.items[0].value;
    const last = this.items.pop()!;
    if (this.items.length > 0) {
      this.items[0] = last;
      this.sinkDown(0);
    }
    return top;
  }

  private bubbleUp(i: number): void {
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.items[i].key >= this.items[parent].key) break;
      [this.items[i], this.items[parent]] = [this.items[parent], this.items[i]];
      i = parent;
    }
  }

  private sinkDown(i: number): void {
    const n = this.items.length;
    while (true) {
      let smallest = i;
      const left = 2 * i + 1;
      const right = 2 * i + 2;
      if (left < n && this.items[left].key < this.items[smallest].key) smallest = left;
      if (right < n && this.items[right].key < this.items[smallest].key) smallest = right;
      if (smallest === i) break;
      [this.items[i], this.items[smallest]] = [this.items[smallest], this.items[i]];
      i = smallest;
    }
  }
}

interface CameFromEntry {
  prevNodeId: number;
  edge: GraphEdge;
  prevWayId: number;
}

function isRestricted(
  graph: RoutingGraph,
  fromWayId: number,
  viaNodeId: number,
  toWayId: number,
): boolean {
  for (const r of graph.restrictions) {
    if (r.fromWayId === fromWayId && r.viaNodeId === viaNodeId && r.toWayId === toWayId) {
      if (r.type.startsWith('no_')) return true;
    }
  }
  return false;
}

export interface AStarOptions {
  ignoreRestrictions?: boolean;
}

export function* aStarRoute(
  graph: RoutingGraph,
  startNodeId: number,
  endNodeId: number,
  mode: RoutingMode,
  options: AStarOptions = {},
): Generator<AStarStep> {
  const endNode = graph.nodes.get(endNodeId);
  const startNode = graph.nodes.get(startNodeId);
  if (!endNode || !startNode) {
    yield { type: 'no-route' };
    return;
  }

  if (startNodeId === endNodeId) {
    yield { type: 'done', path: [], pathNodeIds: [startNodeId], totalTime: 0 };
    return;
  }

  const maxSpeedMs = getMaxSpeed(mode) / 3.6;
  const heuristic = (nodeId: number): number => {
    const node = graph.nodes.get(nodeId)!;
    return haversine(node.lat, node.lon, endNode.lat, endNode.lon) / maxSpeedMs;
  };

  const gScore = new Map<number, number>();
  const cameFrom = new Map<number, CameFromEntry>();
  const openSet = new MinHeap<number>();
  const closed = new Set<number>();

  gScore.set(startNodeId, 0);
  openSet.push(heuristic(startNodeId), startNodeId);

  while (openSet.size > 0) {
    const currentId = openSet.pop()!;

    if (closed.has(currentId)) continue;
    closed.add(currentId);

    if (currentId === endNodeId) {
      // Reconstruct path
      const path: GraphEdge[] = [];
      const pathNodeIds: number[] = [];
      let cur = endNodeId;
      while (cameFrom.has(cur)) {
        const entry = cameFrom.get(cur)!;
        path.push(entry.edge);
        pathNodeIds.push(cur);
        cur = entry.prevNodeId;
      }
      pathNodeIds.push(startNodeId);
      path.reverse();
      pathNodeIds.reverse();
      yield { type: 'done', path, pathNodeIds, totalTime: gScore.get(endNodeId)! };
      return;
    }

    const currentG = gScore.get(currentId) ?? Infinity;
    const currentEntry = cameFrom.get(currentId);
    const currentWayId = currentEntry ? currentEntry.edge.wayId : 0;

    const neighbors = graph.adjacency.get(currentId);
    if (!neighbors) continue;

    for (const edge of neighbors) {
      if (!isEdgeAccessible(edge, mode)) continue;

      // Determine which direction we're traversing this edge
      const toNodeId = edge.from === currentId ? edge.to : edge.from;

      if (!canTraverseDirection(edge, currentId, mode, !!options.ignoreRestrictions)) continue;

      // Turn restriction check (cars only)
      if (mode === 'car' && currentWayId !== 0 && !options.ignoreRestrictions) {
        if (isRestricted(graph, currentWayId, currentId, edge.wayId)) continue;
      }

      // Barrier node check: skip if the target node has a blocking barrier
      if (!options.ignoreRestrictions) {
        const toNode = graph.nodes.get(toNodeId);
        if (toNode && isBarrierBlocking(toNode, mode)) continue;
      }

      yield { type: 'explore', edge, fromNodeId: currentId, toNodeId };

      const tentativeG = currentG + getTravelTime(edge, mode);

      if (tentativeG < (gScore.get(toNodeId) ?? Infinity)) {
        gScore.set(toNodeId, tentativeG);
        cameFrom.set(toNodeId, { prevNodeId: currentId, edge, prevWayId: edge.wayId });
        openSet.push(tentativeG + heuristic(toNodeId), toNodeId);
      }
    }
  }

  yield { type: 'no-route' };
}

export function runAStarToCompletion(
  graph: RoutingGraph,
  startNodeId: number,
  endNodeId: number,
  mode: RoutingMode,
  options: AStarOptions = {},
): { steps: AStarStep[]; finalPath: GraphEdge[] | null } {
  const steps: AStarStep[] = [];
  let finalPath: GraphEdge[] | null = null;

  for (const step of aStarRoute(graph, startNodeId, endNodeId, mode, options)) {
    steps.push(step);
    if (step.type === 'done') {
      finalPath = step.path;
    }
  }

  return { steps, finalPath };
}
