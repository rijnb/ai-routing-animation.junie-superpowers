import { RoutingGraph, GraphEdge, RoutingMode } from '../osm/graph';
import { isEdgeAccessible } from './road-types';
import { haversine } from '../osm/parser';

export interface TrimmedRoute {
  edges: GraphEdge[];
}

export interface SnapResult {
  nodeId: number;
  lat: number;
  lon: number;
  edge: GraphEdge;
  distanceToSnap: number;
}

export interface Projection {
  x: number;
  y: number;
  t: number;
}

export function projectPointOnSegment(
  px: number, py: number,
  ax: number, ay: number,
  bx: number, by: number,
): Projection {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;

  if (lenSq === 0) {
    return { x: ax, y: ay, t: 0 };
  }

  let t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));

  return {
    x: ax + t * dx,
    y: ay + t * dy,
    t,
  };
}

export function snapToRoad(
  lat: number,
  lon: number,
  graph: RoutingGraph,
  mode: RoutingMode,
): SnapResult | null {
  let bestDist = Infinity;
  let bestLat = 0;
  let bestLon = 0;
  let bestEdge: GraphEdge | null = null;

  const seen = new Set<string>();

  for (const edges of graph.adjacency.values()) {
    for (const edge of edges) {
      const key = `${edge.wayId}-${edge.from}-${edge.to}`;
      if (seen.has(key)) continue;
      seen.add(key);

      if (!isEdgeAccessible(edge, mode)) continue;

      const geo = edge.geometry;
      for (let i = 0; i < geo.length - 1; i++) {
        const proj = projectPointOnSegment(
          lat, lon,
          geo[i][0], geo[i][1],
          geo[i + 1][0], geo[i + 1][1],
        );
        const dist = haversine(lat, lon, proj.x, proj.y);
        if (dist < bestDist) {
          bestDist = dist;
          bestLat = proj.x;
          bestLon = proj.y;
          bestEdge = edge;
        }
      }
    }
  }

  if (!bestEdge) return null;

  const distToFrom = haversine(bestLat, bestLon, graph.nodes.get(bestEdge.from)!.lat, graph.nodes.get(bestEdge.from)!.lon);
  const distToTo = haversine(bestLat, bestLon, graph.nodes.get(bestEdge.to)!.lat, graph.nodes.get(bestEdge.to)!.lon);
  const nodeId = distToFrom <= distToTo ? bestEdge.from : bestEdge.to;

  return {
    nodeId,
    lat: bestLat,
    lon: bestLon,
    edge: bestEdge,
    distanceToSnap: bestDist,
  };
}

/**
 * Find the geometry index where a snap point falls on an edge's geometry.
 * Returns the segment index i such that the point lies between geo[i] and geo[i+1],
 * and the projected point on that segment.
 */
function findSnapSegment(
  snapLat: number,
  snapLon: number,
  geometry: [number, number][],
): { segmentIndex: number; projLat: number; projLon: number } {
  let bestDist = Infinity;
  let bestIdx = 0;
  let bestLat = geometry[0][0];
  let bestLon = geometry[0][1];

  for (let i = 0; i < geometry.length - 1; i++) {
    const proj = projectPointOnSegment(
      snapLat, snapLon,
      geometry[i][0], geometry[i][1],
      geometry[i + 1][0], geometry[i + 1][1],
    );
    const dist = haversine(snapLat, snapLon, proj.x, proj.y);
    if (dist < bestDist) {
      bestDist = dist;
      bestIdx = i;
      bestLat = proj.x;
      bestLon = proj.y;
    }
  }

  return { segmentIndex: bestIdx, projLat: bestLat, projLon: bestLon };
}

/**
 * Trim a geometry array to start at the given snap point.
 * Keeps the snap point followed by all geometry points after the snap segment.
 */
function trimGeometryFromStart(
  geometry: [number, number][],
  snapLat: number,
  snapLon: number,
): [number, number][] {
  const { segmentIndex, projLat, projLon } = findSnapSegment(snapLat, snapLon, geometry);
  const result: [number, number][] = [[projLat, projLon]];
  for (let i = segmentIndex + 1; i < geometry.length; i++) {
    result.push(geometry[i]);
  }
  return result;
}

/**
 * Trim a geometry array to end at the given snap point.
 * Keeps all geometry points up to and including the snap segment start,
 * followed by the snap point.
 */
function trimGeometryToEnd(
  geometry: [number, number][],
  snapLat: number,
  snapLon: number,
): [number, number][] {
  const { segmentIndex, projLat, projLon } = findSnapSegment(snapLat, snapLon, geometry);
  const result: [number, number][] = [];
  for (let i = 0; i <= segmentIndex; i++) {
    result.push(geometry[i]);
  }
  result.push([projLat, projLon]);
  return result;
}

/**
 * Trim a route's first and last edges so the geometry starts/ends at
 * the actual snap points rather than at graph node positions.
 * Returns new edge objects with clipped geometry; original edges are not mutated.
 */
export function trimRouteToSnapPoints(
  path: GraphEdge[],
  originSnap: SnapResult,
  destinationSnap: SnapResult,
): TrimmedRoute {
  if (path.length === 0) {
    return { edges: [] };
  }

  const edges = path.map(e => ({ ...e, geometry: [...e.geometry] as [number, number][] }));

  if (edges.length === 1) {
    // Single edge: trim both start and end
    const geo = edges[0].geometry;
    const originSeg = findSnapSegment(originSnap.lat, originSnap.lon, geo);
    const destSeg = findSnapSegment(destinationSnap.lat, destinationSnap.lon, geo);

    // Determine which snap comes first along the geometry
    const originFirst =
      originSeg.segmentIndex < destSeg.segmentIndex ||
      (originSeg.segmentIndex === destSeg.segmentIndex &&
        haversine(geo[originSeg.segmentIndex][0], geo[originSeg.segmentIndex][1], originSeg.projLat, originSeg.projLon) <=
        haversine(geo[destSeg.segmentIndex][0], geo[destSeg.segmentIndex][1], destSeg.projLat, destSeg.projLon));

    if (originFirst) {
      const trimmed = trimGeometryFromStart(geo, originSnap.lat, originSnap.lon);
      edges[0].geometry = trimGeometryToEnd(trimmed, destinationSnap.lat, destinationSnap.lon);
    } else {
      const trimmed = trimGeometryFromStart(geo, destinationSnap.lat, destinationSnap.lon);
      edges[0].geometry = trimGeometryToEnd(trimmed, originSnap.lat, originSnap.lon);
    }
  } else {
    // Trim start of first edge from origin snap point
    const firstGeo = edges[0].geometry;
    const firstNodeId = edges[0].from;
    if (originSnap.nodeId === firstNodeId) {
      edges[0].geometry = trimGeometryFromStart(firstGeo, originSnap.lat, originSnap.lon);
    } else {
      edges[0].geometry = trimGeometryToEnd(firstGeo, originSnap.lat, originSnap.lon);
    }

    // Trim end of last edge to destination snap point
    const lastIdx = edges.length - 1;
    const lastGeo = edges[lastIdx].geometry;
    const lastToNodeId = edges[lastIdx].to;
    if (destinationSnap.nodeId === lastToNodeId) {
      edges[lastIdx].geometry = trimGeometryToEnd(lastGeo, destinationSnap.lat, destinationSnap.lon);
    } else {
      edges[lastIdx].geometry = trimGeometryFromStart(lastGeo, destinationSnap.lat, destinationSnap.lon);
    }
  }

  return { edges };
}
