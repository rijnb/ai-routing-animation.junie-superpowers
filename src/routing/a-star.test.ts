import { describe, it, expect } from 'vitest';
import { aStarRoute, AStarStep, runAStarToCompletion } from './a-star';
import { RoutingGraph, GraphEdge, GraphNode, TurnRestriction } from '../osm/graph';

function makeNode(id: number, lat: number, lon: number): GraphNode {
  return { id, lat, lon };
}

function makeEdge(
  from: number, to: number, wayId: number,
  overrides: Partial<GraphEdge> = {},
): GraphEdge {
  return {
    from, to, wayId,
    highway: 'residential',
    maxspeed: 30,
    oneway: false,
    onewayBicycle: false,
    isReverse: false,
    distance: 100,
    geometry: [[0, 0], [1, 1]],
    ...overrides,
  };
}

function buildGraph(
  nodes: GraphNode[],
  edges: GraphEdge[],
  restrictions: TurnRestriction[] = [],
): RoutingGraph {
  const nodeMap = new Map<number, GraphNode>();
  for (const n of nodes) nodeMap.set(n.id, n);

  const adjacency = new Map<number, GraphEdge[]>();
  for (const e of edges) {
    if (!adjacency.has(e.from)) adjacency.set(e.from, []);
    adjacency.get(e.from)!.push({ ...e, isReverse: false });
    // Always add reverse edge
    const rev: GraphEdge = {
      ...e,
      from: e.to,
      to: e.from,
      isReverse: true,
      geometry: [...e.geometry].reverse() as [number, number][],
    };
    if (!adjacency.has(e.to)) adjacency.set(e.to, []);
    adjacency.get(e.to)!.push(rev);
  }

  return { nodes: nodeMap, adjacency, restrictions };
}

function collectSteps(gen: Generator<AStarStep>): AStarStep[] {
  const steps: AStarStep[] = [];
  for (const step of gen) steps.push(step);
  return steps;
}

describe('aStarRoute', () => {
  // Simple linear graph: 1 -- 2 -- 3
  const nodes = [
    makeNode(1, 52.370, 4.890),
    makeNode(2, 52.371, 4.891),
    makeNode(3, 52.372, 4.892),
  ];

  it('finds path on simple 3-node graph', () => {
    const edges = [
      makeEdge(1, 2, 100, { distance: 100, geometry: [[52.370, 4.890], [52.371, 4.891]] }),
      makeEdge(2, 3, 200, { distance: 100, geometry: [[52.371, 4.891], [52.372, 4.892]] }),
    ];
    const graph = buildGraph(nodes, edges);
    const { steps, finalPath } = runAStarToCompletion(graph, 1, 3, 'car');

    expect(finalPath).not.toBeNull();
    expect(finalPath!.length).toBe(2);

    const lastStep = steps[steps.length - 1];
    expect(lastStep.type).toBe('done');
    if (lastStep.type === 'done') {
      expect(lastStep.pathNodeIds).toEqual([1, 2, 3]);
    }
  });

  it('finds fastest route preferring higher speed roads', () => {
    // Two paths from 1→3: direct slow road, or via 4 on fast road
    const node4 = makeNode(4, 52.371, 4.893);
    const edges = [
      // Direct: 1→3 via slow road (distance 200, speed 10 → time = 200/2.78 ≈ 72s)
      makeEdge(1, 3, 100, { distance: 200, maxspeed: 10, geometry: [[52.370, 4.890], [52.372, 4.892]] }),
      // Via 4: 1→4 fast (distance 150, speed 100 → time = 150/27.78 ≈ 5.4s)
      makeEdge(1, 4, 200, { distance: 150, maxspeed: 100, geometry: [[52.370, 4.890], [52.371, 4.893]] }),
      // 4→3 fast (distance 150, speed 100 → time ≈ 5.4s)
      makeEdge(4, 3, 300, { distance: 150, maxspeed: 100, geometry: [[52.371, 4.893], [52.372, 4.892]] }),
    ];
    const graph = buildGraph([...nodes, node4], edges);
    const { finalPath } = runAStarToCompletion(graph, 1, 3, 'car');

    expect(finalPath).not.toBeNull();
    // Should go via node 4 (faster)
    expect(finalPath!.length).toBe(2);
    expect(finalPath!.some(e => e.wayId === 200)).toBe(true);
    expect(finalPath!.some(e => e.wayId === 300)).toBe(true);
  });

  it('respects oneway restrictions for car', () => {
    // Edge 1→2 is oneway, so car can't go 2→1
    const edges = [
      makeEdge(1, 2, 100, { oneway: true, distance: 100, geometry: [[52.370, 4.890], [52.371, 4.891]] }),
    ];
    const graph = buildGraph(nodes.slice(0, 2), edges);
    const { finalPath } = runAStarToCompletion(graph, 2, 1, 'car');
    expect(finalPath).toBeNull();
  });

  it('ignores oneway for pedestrian', () => {
    const edges = [
      makeEdge(1, 2, 100, {
        oneway: true, distance: 100,
        highway: 'residential',
        geometry: [[52.370, 4.890], [52.371, 4.891]],
      }),
    ];
    const graph = buildGraph(nodes.slice(0, 2), edges);
    const { finalPath } = runAStarToCompletion(graph, 2, 1, 'pedestrian');
    expect(finalPath).not.toBeNull();
    expect(finalPath!.length).toBe(1);
  });

  it('yields explore steps for each examined edge', () => {
    const edges = [
      makeEdge(1, 2, 100, { distance: 100, geometry: [[52.370, 4.890], [52.371, 4.891]] }),
      makeEdge(2, 3, 200, { distance: 100, geometry: [[52.371, 4.891], [52.372, 4.892]] }),
    ];
    const graph = buildGraph(nodes, edges);
    const steps = collectSteps(aStarRoute(graph, 1, 3, 'car'));

    const exploreSteps = steps.filter(s => s.type === 'explore');
    expect(exploreSteps.length).toBeGreaterThan(0);
  });

  it('yields no-route when destination unreachable', () => {
    // Node 3 is isolated (only footway, which car can't use)
    const edges = [
      makeEdge(1, 2, 100, { distance: 100, geometry: [[52.370, 4.890], [52.371, 4.891]] }),
      makeEdge(2, 3, 200, { distance: 100, highway: 'footway', geometry: [[52.371, 4.891], [52.372, 4.892]] }),
    ];
    const graph = buildGraph(nodes, edges);
    const { finalPath, steps } = runAStarToCompletion(graph, 1, 3, 'car');

    expect(finalPath).toBeNull();
    expect(steps[steps.length - 1].type).toBe('no-route');
  });

  it('respects turn restrictions for car', () => {
    // 1→2 (way 100), 2→3 (way 200) with no_left_turn restriction
    // Also add alternative 2→4→3
    const node4 = makeNode(4, 52.371, 4.893);
    const edges = [
      makeEdge(1, 2, 100, { distance: 100, geometry: [[52.370, 4.890], [52.371, 4.891]] }),
      makeEdge(2, 3, 200, { distance: 100, geometry: [[52.371, 4.891], [52.372, 4.892]] }),
      makeEdge(2, 4, 300, { distance: 50, geometry: [[52.371, 4.891], [52.371, 4.893]] }),
      makeEdge(4, 3, 400, { distance: 50, geometry: [[52.371, 4.893], [52.372, 4.892]] }),
    ];
    const restrictions: TurnRestriction[] = [
      { fromWayId: 100, viaNodeId: 2, toWayId: 200, type: 'no_left_turn' },
    ];
    const graph = buildGraph([...nodes, node4], edges, restrictions);
    const { finalPath } = runAStarToCompletion(graph, 1, 3, 'car');

    expect(finalPath).not.toBeNull();
    // Should go via node 4 to avoid the restriction
    expect(finalPath!.some(e => e.wayId === 300)).toBe(true);
    expect(finalPath!.some(e => e.wayId === 400)).toBe(true);
  });

  it('ignores turn restrictions for bicycle', () => {
    const edges = [
      makeEdge(1, 2, 100, { distance: 100, geometry: [[52.370, 4.890], [52.371, 4.891]] }),
      makeEdge(2, 3, 200, { distance: 100, geometry: [[52.371, 4.891], [52.372, 4.892]] }),
    ];
    const restrictions: TurnRestriction[] = [
      { fromWayId: 100, viaNodeId: 2, toWayId: 200, type: 'no_left_turn' },
    ];
    const graph = buildGraph(nodes, edges, restrictions);
    const { finalPath } = runAStarToCompletion(graph, 1, 3, 'bicycle');

    expect(finalPath).not.toBeNull();
    // Bicycle ignores restriction, goes directly 1→2→3
    expect(finalPath!.length).toBe(2);
  });

  it('yields done with correct total time', () => {
    const edges = [
      makeEdge(1, 2, 100, { distance: 1000, maxspeed: 36, geometry: [[52.370, 4.890], [52.371, 4.891]] }),
    ];
    const graph = buildGraph(nodes.slice(0, 2), edges);
    const { steps } = runAStarToCompletion(graph, 1, 2, 'car');

    const doneStep = steps.find(s => s.type === 'done');
    expect(doneStep).toBeDefined();
    if (doneStep && doneStep.type === 'done') {
      // 36 km/h = 10 m/s, 1000m → 100s
      expect(doneStep.totalTime).toBeCloseTo(100, 0);
    }
  });

  it('handles same start and end', () => {
    const edges = [
      makeEdge(1, 2, 100, { distance: 100, geometry: [[52.370, 4.890], [52.371, 4.891]] }),
    ];
    const graph = buildGraph(nodes.slice(0, 2), edges);
    const { steps, finalPath } = runAStarToCompletion(graph, 1, 1, 'car');

    expect(finalPath).not.toBeNull();
    expect(finalPath!.length).toBe(0);
    const doneStep = steps.find(s => s.type === 'done');
    expect(doneStep).toBeDefined();
    if (doneStep && doneStep.type === 'done') {
      expect(doneStep.totalTime).toBe(0);
      expect(doneStep.pathNodeIds).toEqual([1]);
    }
  });

  it('ignores oneway for car when ignoreRestrictions is true', () => {
    const edges = [
      makeEdge(1, 2, 100, { oneway: true, distance: 100, geometry: [[52.370, 4.890], [52.371, 4.891]] }),
    ];
    const graph = buildGraph(nodes.slice(0, 2), edges);
    // Without ignoreRestrictions: no route 2→1
    const { finalPath: blocked } = runAStarToCompletion(graph, 2, 1, 'car');
    expect(blocked).toBeNull();
    // With ignoreRestrictions: route found
    const { finalPath } = runAStarToCompletion(graph, 2, 1, 'car', { ignoreRestrictions: true });
    expect(finalPath).not.toBeNull();
    expect(finalPath!.length).toBe(1);
  });

  it('ignores turn restrictions for car when ignoreRestrictions is true', () => {
    const node4 = makeNode(4, 52.371, 4.893);
    const edges = [
      makeEdge(1, 2, 100, { distance: 100, geometry: [[52.370, 4.890], [52.371, 4.891]] }),
      makeEdge(2, 3, 200, { distance: 100, geometry: [[52.371, 4.891], [52.372, 4.892]] }),
      makeEdge(2, 4, 300, { distance: 50, geometry: [[52.371, 4.891], [52.371, 4.893]] }),
      makeEdge(4, 3, 400, { distance: 50, geometry: [[52.371, 4.893], [52.372, 4.892]] }),
    ];
    const restrictions: TurnRestriction[] = [
      { fromWayId: 100, viaNodeId: 2, toWayId: 200, type: 'no_left_turn' },
    ];
    const graph = buildGraph([...nodes, node4], edges, restrictions);
    // With ignoreRestrictions: takes direct path through restriction
    const { finalPath } = runAStarToCompletion(graph, 1, 3, 'car', { ignoreRestrictions: true });
    expect(finalPath).not.toBeNull();
    // Should go directly 1→2→3 (via way 200) since restriction is ignored
    expect(finalPath!.some(e => e.wayId === 200)).toBe(true);
    expect(finalPath!.length).toBe(2);
  });

  it('car avoids bollard barrier node and takes detour', () => {
    // 1→2→3 direct, but node 2 has a bollard → car must detour via 4
    const node4 = makeNode(4, 52.371, 4.893);
    const barrierNode2: GraphNode = { id: 2, lat: 52.371, lon: 4.891, barrier: 'bollard' };
    const edges = [
      makeEdge(1, 2, 100, { distance: 100, geometry: [[52.370, 4.890], [52.371, 4.891]] }),
      makeEdge(2, 3, 200, { distance: 100, geometry: [[52.371, 4.891], [52.372, 4.892]] }),
      makeEdge(1, 4, 300, { distance: 150, geometry: [[52.370, 4.890], [52.371, 4.893]] }),
      makeEdge(4, 3, 400, { distance: 150, geometry: [[52.371, 4.893], [52.372, 4.892]] }),
    ];
    const graph = buildGraph([nodes[0], barrierNode2, nodes[2], node4], edges);
    const { finalPath } = runAStarToCompletion(graph, 1, 3, 'car');

    expect(finalPath).not.toBeNull();
    // Should go via node 4 to avoid bollard at node 2
    expect(finalPath!.some(e => e.wayId === 300)).toBe(true);
    expect(finalPath!.some(e => e.wayId === 400)).toBe(true);
  });

  it('pedestrian passes through bollard barrier', () => {
    const barrierNode2: GraphNode = { id: 2, lat: 52.371, lon: 4.891, barrier: 'bollard' };
    const edges = [
      makeEdge(1, 2, 100, { distance: 100, geometry: [[52.370, 4.890], [52.371, 4.891]] }),
      makeEdge(2, 3, 200, { distance: 100, geometry: [[52.371, 4.891], [52.372, 4.892]] }),
    ];
    const graph = buildGraph([nodes[0], barrierNode2, nodes[2]], edges);
    const { finalPath } = runAStarToCompletion(graph, 1, 3, 'pedestrian');

    expect(finalPath).not.toBeNull();
    expect(finalPath!.length).toBe(2);
  });

  it('car avoids road with motor_vehicle=no', () => {
    const node4 = makeNode(4, 52.371, 4.893);
    const edges = [
      makeEdge(1, 2, 100, { distance: 100, motorVehicle: 'no', geometry: [[52.370, 4.890], [52.371, 4.891]] }),
      makeEdge(2, 3, 200, { distance: 100, motorVehicle: 'no', geometry: [[52.371, 4.891], [52.372, 4.892]] }),
      makeEdge(1, 4, 300, { distance: 150, geometry: [[52.370, 4.890], [52.371, 4.893]] }),
      makeEdge(4, 3, 400, { distance: 150, geometry: [[52.371, 4.893], [52.372, 4.892]] }),
    ];
    const graph = buildGraph([...nodes, node4], edges);
    const { finalPath } = runAStarToCompletion(graph, 1, 3, 'car');

    expect(finalPath).not.toBeNull();
    expect(finalPath!.some(e => e.wayId === 300)).toBe(true);
    expect(finalPath!.some(e => e.wayId === 400)).toBe(true);
  });

  it('car ignores barrier when ignoreRestrictions is true', () => {
    const barrierNode2: GraphNode = { id: 2, lat: 52.371, lon: 4.891, barrier: 'bollard' };
    const edges = [
      makeEdge(1, 2, 100, { distance: 100, geometry: [[52.370, 4.890], [52.371, 4.891]] }),
      makeEdge(2, 3, 200, { distance: 100, geometry: [[52.371, 4.891], [52.372, 4.892]] }),
    ];
    const graph = buildGraph([nodes[0], barrierNode2, nodes[2]], edges);
    const { finalPath } = runAStarToCompletion(graph, 1, 3, 'car', { ignoreRestrictions: true });

    expect(finalPath).not.toBeNull();
    expect(finalPath!.length).toBe(2);
  });

  it('car cannot reach destination when only path has access=no', () => {
    const edges = [
      makeEdge(1, 2, 100, { distance: 100, access: 'no', geometry: [[52.370, 4.890], [52.371, 4.891]] }),
      makeEdge(2, 3, 200, { distance: 100, access: 'no', geometry: [[52.371, 4.891], [52.372, 4.892]] }),
    ];
    const graph = buildGraph(nodes, edges);
    const { finalPath } = runAStarToCompletion(graph, 1, 3, 'car');
    expect(finalPath).toBeNull();
  });
});
