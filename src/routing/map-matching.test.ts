import { describe, it, expect } from 'vitest';
import { projectPointOnSegment, snapToRoad, trimRouteToSnapPoints, SnapResult } from './map-matching';
import { RoutingGraph, GraphEdge, GraphNode } from '../osm/graph';

function makeGraph(edges: GraphEdge[], nodes: GraphNode[]): RoutingGraph {
  const nodeMap = new Map<number, GraphNode>();
  for (const n of nodes) nodeMap.set(n.id, n);

  const adjacency = new Map<number, GraphEdge[]>();
  for (const e of edges) {
    if (!adjacency.has(e.from)) adjacency.set(e.from, []);
    adjacency.get(e.from)!.push(e);
    if (!adjacency.has(e.to)) adjacency.set(e.to, []);
    adjacency.get(e.to)!.push(e);
  }

  return { nodes: nodeMap, adjacency, restrictions: [] };
}

describe('projectPointOnSegment', () => {
  it('projects point onto middle of segment', () => {
    // Segment from (0,0) to (10,0), point at (5,5)
    const p = projectPointOnSegment(5, 5, 0, 0, 10, 0);
    expect(p.x).toBeCloseTo(5);
    expect(p.y).toBeCloseTo(0);
    expect(p.t).toBeCloseTo(0.5);
  });

  it('clamps to start when before segment', () => {
    const p = projectPointOnSegment(-5, 0, 0, 0, 10, 0);
    expect(p.x).toBeCloseTo(0);
    expect(p.y).toBeCloseTo(0);
    expect(p.t).toBeCloseTo(0);
  });

  it('clamps to end when past segment', () => {
    const p = projectPointOnSegment(15, 0, 0, 0, 10, 0);
    expect(p.x).toBeCloseTo(10);
    expect(p.y).toBeCloseTo(0);
    expect(p.t).toBeCloseTo(1);
  });

  it('handles zero-length segment', () => {
    const p = projectPointOnSegment(5, 5, 3, 3, 3, 3);
    expect(p.x).toBeCloseTo(3);
    expect(p.y).toBeCloseTo(3);
    expect(p.t).toBe(0);
  });
});

describe('snapToRoad', () => {
  const nodes: GraphNode[] = [
    { id: 1, lat: 52.370, lon: 4.890 },
    { id: 2, lat: 52.370, lon: 4.900 },
    { id: 3, lat: 52.380, lon: 4.890 },
    { id: 4, lat: 52.380, lon: 4.900 },
  ];

  const residentialEdge: GraphEdge = {
    from: 1, to: 2, wayId: 100,
    highway: 'residential', maxspeed: 30,
    oneway: false, onewayBicycle: false, isReverse: false,
    distance: 100,
    geometry: [[52.370, 4.890], [52.370, 4.900]],
  };

  const footwayEdge: GraphEdge = {
    from: 3, to: 4, wayId: 200,
    highway: 'footway', maxspeed: 0,
    oneway: false, onewayBicycle: false, isReverse: false,
    distance: 100,
    geometry: [[52.380, 4.890], [52.380, 4.900]],
  };

  it('snaps to nearest accessible road', () => {
    const graph = makeGraph([residentialEdge, footwayEdge], nodes);
    // Point near the residential edge
    const result = snapToRoad(52.3705, 4.895, graph, 'car');
    expect(result).not.toBeNull();
    expect(result!.edge.wayId).toBe(100);
    expect(result!.distanceToSnap).toBeGreaterThan(0);
  });

  it('returns null when no accessible roads exist', () => {
    // Only footway, which car can't use
    const graph = makeGraph([footwayEdge], nodes);
    const result = snapToRoad(52.380, 4.895, graph, 'car');
    expect(result).toBeNull();
  });

  it('respects routing mode access rules', () => {
    const graph = makeGraph([residentialEdge, footwayEdge], nodes);
    // Point closer to footway edge, pedestrian mode
    const result = snapToRoad(52.379, 4.895, graph, 'pedestrian');
    expect(result).not.toBeNull();
    expect(result!.edge.wayId).toBe(200);
  });

  it('returns nearest node id', () => {
    const graph = makeGraph([residentialEdge], nodes);
    // Click near node 1 end of the edge
    const result = snapToRoad(52.370, 4.891, graph, 'car');
    expect(result).not.toBeNull();
    expect(result!.nodeId).toBe(1);
  });

  it('returns nearest node id for other end', () => {
    const graph = makeGraph([residentialEdge], nodes);
    // Click near node 2 end of the edge
    const result = snapToRoad(52.370, 4.899, graph, 'car');
    expect(result).not.toBeNull();
    expect(result!.nodeId).toBe(2);
  });
});

describe('trimRouteToSnapPoints', () => {
  function makeEdge(
    from: number, to: number, wayId: number,
    geometry: [number, number][],
    overrides: Partial<GraphEdge> = {},
  ): GraphEdge {
    return {
      from, to, wayId,
      highway: 'residential', maxspeed: 30,
      oneway: false, onewayBicycle: false, isReverse: false,
      distance: 100,
      geometry,
      ...overrides,
    };
  }

  function makeSnap(nodeId: number, lat: number, lon: number, edge: GraphEdge): SnapResult {
    return { nodeId, lat, lon, edge, distanceToSnap: 0 };
  }

  it('returns empty edges for empty path', () => {
    const edge = makeEdge(1, 2, 100, [[0, 0], [10, 0]]);
    const origin = makeSnap(1, 0, 0, edge);
    const dest = makeSnap(2, 10, 0, edge);
    const result = trimRouteToSnapPoints([], origin, dest);
    expect(result.edges).toEqual([]);
  });

  it('trims first edge geometry from origin snap point (multi-edge)', () => {
    // Edge from node 1 (0,0) to node 2 (10,0), origin snapped midway at (5,0)
    const edge1 = makeEdge(1, 2, 100, [[0, 0], [10, 0]]);
    const edge2 = makeEdge(2, 3, 200, [[10, 0], [20, 0]]);
    const origin = makeSnap(1, 5, 0, edge1);
    const dest = makeSnap(3, 20, 0, edge2);

    const result = trimRouteToSnapPoints([edge1, edge2], origin, dest);
    // First edge should start at (5,0) not (0,0)
    expect(result.edges[0].geometry[0][0]).toBeCloseTo(5);
    expect(result.edges[0].geometry[0][1]).toBeCloseTo(0);
    // First edge should still end at (10,0)
    const lastPt = result.edges[0].geometry[result.edges[0].geometry.length - 1];
    expect(lastPt[0]).toBeCloseTo(10);
    expect(lastPt[1]).toBeCloseTo(0);
  });

  it('trims last edge geometry to destination snap point (multi-edge)', () => {
    const edge1 = makeEdge(1, 2, 100, [[0, 0], [10, 0]]);
    const edge2 = makeEdge(2, 3, 200, [[10, 0], [20, 0]]);
    const origin = makeSnap(1, 0, 0, edge1);
    const dest = makeSnap(3, 15, 0, edge2);

    const result = trimRouteToSnapPoints([edge1, edge2], origin, dest);
    // Last edge should end at (15,0) not (20,0)
    const lastEdge = result.edges[result.edges.length - 1];
    const lastPt = lastEdge.geometry[lastEdge.geometry.length - 1];
    expect(lastPt[0]).toBeCloseTo(15);
    expect(lastPt[1]).toBeCloseTo(0);
  });

  it('trims both ends on single-edge route', () => {
    const edge = makeEdge(1, 2, 100, [[0, 0], [10, 0]]);
    const origin = makeSnap(1, 3, 0, edge);
    const dest = makeSnap(2, 7, 0, edge);

    const result = trimRouteToSnapPoints([edge], origin, dest);
    expect(result.edges.length).toBe(1);
    // Should start at (3,0) and end at (7,0)
    const geo = result.edges[0].geometry;
    expect(geo[0][0]).toBeCloseTo(3);
    expect(geo[0][1]).toBeCloseTo(0);
    expect(geo[geo.length - 1][0]).toBeCloseTo(7);
    expect(geo[geo.length - 1][1]).toBeCloseTo(0);
  });

  it('does not mutate original edges', () => {
    const edge1 = makeEdge(1, 2, 100, [[0, 0], [10, 0]]);
    const edge2 = makeEdge(2, 3, 200, [[10, 0], [20, 0]]);
    const origin = makeSnap(1, 5, 0, edge1);
    const dest = makeSnap(3, 15, 0, edge2);

    const originalGeo1 = [...edge1.geometry];
    const originalGeo2 = [...edge2.geometry];

    trimRouteToSnapPoints([edge1, edge2], origin, dest);

    expect(edge1.geometry).toEqual(originalGeo1);
    expect(edge2.geometry).toEqual(originalGeo2);
  });

  it('handles multi-segment edge geometry', () => {
    // Edge with 3 geometry points: (0,0) -> (5,0) -> (10,0)
    const edge = makeEdge(1, 2, 100, [[0, 0], [5, 0], [10, 0]]);
    const origin = makeSnap(1, 2.5, 0, edge);
    const dest = makeSnap(2, 7.5, 0, edge);

    const result = trimRouteToSnapPoints([edge], origin, dest);
    const geo = result.edges[0].geometry;
    // Should start at ~(2.5,0), include (5,0), and end at ~(7.5,0)
    expect(geo[0][0]).toBeCloseTo(2.5);
    expect(geo[geo.length - 1][0]).toBeCloseTo(7.5);
    expect(geo.length).toBe(3); // snap point, (5,0), snap point
  });
});
