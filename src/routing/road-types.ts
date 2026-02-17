import { GraphEdge, GraphNode, RoutingMode } from '../osm/graph';

/**
 * Barrier types that physically block motor vehicles.
 * Gates and lift_gates are assumed openable; cattle_grid is passable by cars.
 */
const CAR_BLOCKING_BARRIERS = new Set([
  'bollard', 'block', 'cycle_barrier', 'bus_trap',
  'kissing_gate', 'stile', 'turnstile', 'planter',
  'height_restrictor', 'sally_port', 'yes',
]);

/**
 * Barrier types that block bicycles.
 */
const BICYCLE_BLOCKING_BARRIERS = new Set([
  'block', 'kissing_gate', 'stile', 'turnstile',
]);

/**
 * Returns true when a barrier node blocks the given routing mode.
 */
export function isBarrierBlocking(node: GraphNode, mode: RoutingMode): boolean {
  if (!node.barrier) return false;
  if (mode === 'car') return CAR_BLOCKING_BARRIERS.has(node.barrier);
  if (mode === 'bicycle') return BICYCLE_BLOCKING_BARRIERS.has(node.barrier);
  // Pedestrians can pass virtually all barriers
  return false;
}

const ROAD_ACCESS: Record<string, Record<RoutingMode, boolean>> = {
  motorway:      { car: true,  bicycle: false, pedestrian: false },
  motorway_link: { car: true,  bicycle: false, pedestrian: false },
  trunk:         { car: true,  bicycle: false, pedestrian: false },
  trunk_link:    { car: true,  bicycle: false, pedestrian: false },
  primary:       { car: true,  bicycle: true,  pedestrian: true },
  primary_link:  { car: true,  bicycle: true,  pedestrian: true },
  secondary:     { car: true,  bicycle: true,  pedestrian: true },
  secondary_link:{ car: true,  bicycle: true,  pedestrian: true },
  tertiary:      { car: true,  bicycle: true,  pedestrian: true },
  tertiary_link: { car: true,  bicycle: true,  pedestrian: true },
  residential:   { car: true,  bicycle: true,  pedestrian: true },
  unclassified:  { car: true,  bicycle: true,  pedestrian: true },
  service:       { car: true,  bicycle: true,  pedestrian: true },
  living_street: { car: true,  bicycle: true,  pedestrian: true },
  cycleway:      { car: false, bicycle: true,  pedestrian: true },
  footway:       { car: false, bicycle: false, pedestrian: true },
  pedestrian:    { car: false, bicycle: false, pedestrian: true },
  path:          { car: false, bicycle: false, pedestrian: true },
  steps:         { car: false, bicycle: false, pedestrian: true },
  busway:        { car: false, bicycle: false, pedestrian: false },
};

const DEFAULT_SPEEDS: Record<string, number> = {
  motorway: 100, motorway_link: 60,
  trunk: 80, trunk_link: 50,
  primary: 50, primary_link: 40,
  secondary: 50, secondary_link: 30,
  tertiary: 30, tertiary_link: 20,
  residential: 30, unclassified: 30,
  service: 15, living_street: 15,
  cycleway: 20,
  footway: 5, pedestrian: 5, path: 5, steps: 3,
  busway: 50,
};

/**
 * Values that deny access for a given tag.
 * 'destination' and 'private' are treated as blocked because this router
 * does not model destination-only routing.
 */
const DENY_VALUES = new Set(['no', 'private']);

export function isEdgeAccessible(edge: GraphEdge, mode: RoutingMode): boolean {
  const roadAccess = ROAD_ACCESS[edge.highway];
  if (!roadAccess || !roadAccess[mode]) return false;

  // Mode-specific override tags (most specific wins)
  if (mode === 'car') {
    if (edge.motorVehicle !== undefined) return !DENY_VALUES.has(edge.motorVehicle);
    if (edge.vehicle !== undefined) return !DENY_VALUES.has(edge.vehicle);
  }
  if (mode === 'bicycle') {
    if (edge.bicycle !== undefined) return !DENY_VALUES.has(edge.bicycle);
    if (edge.vehicle !== undefined) return !DENY_VALUES.has(edge.vehicle);
  }
  if (mode === 'pedestrian') {
    if (edge.foot !== undefined) return !DENY_VALUES.has(edge.foot);
  }

  // General access tag
  if (edge.access !== undefined) return !DENY_VALUES.has(edge.access);

  return true;
}

export function canTraverseDirection(
  edge: GraphEdge,
  _fromNodeId: number,
  mode: RoutingMode,
  ignoreRestrictions = false,
): boolean {
  if (mode === 'pedestrian') return true;
  if (!edge.oneway) return true;

  // For oneway roads, isReverse means this edge goes against the oneway direction
  const isAgainstOneway = edge.isReverse;

  if (mode === 'bicycle') {
    if (!isAgainstOneway) return true;
    return !edge.onewayBicycle;
  }

  // car: cannot go against oneway (unless restrictions are overridden)
  if (ignoreRestrictions) return true;
  return !isAgainstOneway;
}

export function getTravelSpeed(edge: GraphEdge, mode: RoutingMode): number {
  if (mode === 'bicycle') return 20;
  if (mode === 'pedestrian') return 5;
  if (edge.maxspeed > 0) return edge.maxspeed;
  return DEFAULT_SPEEDS[edge.highway] ?? 30;
}

export function getTravelTime(edge: GraphEdge, mode: RoutingMode): number {
  const speedKmh = getTravelSpeed(edge, mode);
  const speedMs = speedKmh / 3.6;
  return edge.distance / speedMs;
}

export function getMaxSpeed(mode: RoutingMode): number {
  if (mode === 'bicycle') return 20;
  if (mode === 'pedestrian') return 5;
  return 100;
}
