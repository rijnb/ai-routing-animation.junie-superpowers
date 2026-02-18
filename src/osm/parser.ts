import { RoutingGraph, GraphNode, GraphEdge, TurnRestriction } from './graph';

export function haversine(
  lat1: number, lon1: number,
  lat2: number, lon2: number,
): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * String interning pool: reuses the same string instance for repeated values
 * (highway types, access tags) to avoid allocating thousands of duplicate strings.
 */
const internPool = new Map<string, string>();
function intern(s: string): string {
  const existing = internPool.get(s);
  if (existing !== undefined) return existing;
  internPool.set(s, s);
  return s;
}

/**
 * Lightweight streaming OSM XML parser.
 *
 * Instead of building a full DOM tree via DOMParser (which roughly doubles
 * memory usage), this scans the XML string with targeted regex passes for
 * <node>, <way>, and <relation> elements.  Each element is parsed
 * individually and discarded immediately, so peak memory stays close to
 * the size of the XML string itself plus the final graph structures.
 */
export function parseOSM(xmlString: string): RoutingGraph {
  // ── 1. Parse nodes ───────────────────────────────────────────────
  // We store every node in a compact Float64Array-backed structure.
  // Key: node id → { lat, lon, barrier? }
  const allNodes = new Map<number, GraphNode>();

  const nodeRe = /<node\s[^>]*?\bid="(\d+)"[^>]*?\blat="([^"]+)"[^>]*?\blon="([^"]+)"[^>]*?(?:\/>|>([\s\S]*?)<\/node>)/g;
  let m: RegExpExecArray | null;

  while ((m = nodeRe.exec(xmlString)) !== null) {
    const id = Number(m[1]);
    const lat = Number(m[2]);
    const lon = Number(m[3]);
    if (isNaN(id) || isNaN(lat) || isNaN(lon)) continue;

    let barrier: string | undefined;
    const inner = m[4]; // undefined for self-closing nodes
    if (inner) {
      const bm = /\bk="barrier"\s+v="([^"]+)"/.exec(inner);
      if (bm) barrier = intern(bm[1]);
    }
    allNodes.set(id, { id, lat, lon, barrier });
  }

  // ── 2. Parse ways → edges ────────────────────────────────────────
  const adjacency = new Map<number, GraphEdge[]>();
  const referencedNodes = new Set<number>();

  const wayRe = /<way\s[^>]*?\bid="(\d+)"[^>]*?>([\s\S]*?)<\/way>/g;
  const ndRe = /<nd\s+ref="(\d+)"\s*\/>/g;

  while ((m = wayRe.exec(xmlString)) !== null) {
    const wayBody = m[2];

    // Quick highway check: skip ways without highway tag (majority of ways)
    const hwMatch = /\bk="highway"\s+v="([^"]+)"/.exec(wayBody);
    if (!hwMatch) continue;

    const wayId = Number(m[1]);
    const highway = intern(hwMatch[1]);

    // Parse tags with targeted regexes — only the ones we need
    const owMatch = /\bk="oneway"\s+v="([^"]+)"/.exec(wayBody);
    const owVal = owMatch ? owMatch[1] : null;
    const oneway = owVal === 'yes' || owVal === '1' || owVal === 'true';

    const owbMatch = /\bk="oneway:bicycle"\s+v="([^"]+)"/.exec(wayBody);
    const onewayBicycle = owbMatch ? owbMatch[1] !== 'no' : true;

    const msMatch = /\bk="maxspeed"\s+v="([^"]+)"/.exec(wayBody);
    const maxspeed = msMatch ? (parseInt(msMatch[1], 10) || 0) : 0;

    const accMatch = /\bk="access"\s+v="([^"]+)"/.exec(wayBody);
    const access = accMatch ? intern(accMatch[1]) : undefined;

    const mvMatch = /\bk="motor_vehicle"\s+v="([^"]+)"/.exec(wayBody);
    const motorVehicle = mvMatch ? intern(mvMatch[1]) : undefined;

    const vMatch = /\bk="vehicle"\s+v="([^"]+)"/.exec(wayBody);
    const vehicle = vMatch ? intern(vMatch[1]) : undefined;

    const bicMatch = /\bk="bicycle"\s+v="([^"]+)"/.exec(wayBody);
    const bicycleTag = bicMatch ? intern(bicMatch[1]) : undefined;

    const footMatch = /\bk="foot"\s+v="([^"]+)"/.exec(wayBody);
    const footTag = footMatch ? intern(footMatch[1]) : undefined;

    // Collect nd refs
    const nodeIds: number[] = [];
    ndRe.lastIndex = 0;
    let nm: RegExpExecArray | null;
    while ((nm = ndRe.exec(wayBody)) !== null) {
      nodeIds.push(Number(nm[1]));
    }

    // Build edges for consecutive node pairs
    for (let j = 0; j < nodeIds.length - 1; j++) {
      const fromId = nodeIds[j];
      const toId = nodeIds[j + 1];
      const fromNode = allNodes.get(fromId);
      const toNode = allNodes.get(toId);
      if (!fromNode || !toNode) continue;

      referencedNodes.add(fromId);
      referencedNodes.add(toId);

      const distance = haversine(fromNode.lat, fromNode.lon, toNode.lat, toNode.lon);

      // Forward edge
      const edge: GraphEdge = {
        from: fromId,
        to: toId,
        wayId,
        highway,
        maxspeed,
        oneway,
        onewayBicycle,
        isReverse: false,
        distance,
        geometry: [[fromNode.lat, fromNode.lon], [toNode.lat, toNode.lon]],
        access,
        motorVehicle,
        vehicle,
        bicycle: bicycleTag,
        foot: footTag,
      };

      let fromList = adjacency.get(fromId);
      if (!fromList) {
        fromList = [];
        adjacency.set(fromId, fromList);
      }
      fromList.push(edge);

      // Reverse edge
      const reverseEdge: GraphEdge = {
        from: toId,
        to: fromId,
        wayId,
        highway,
        maxspeed,
        oneway,
        onewayBicycle,
        isReverse: true,
        distance,
        geometry: [[toNode.lat, toNode.lon], [fromNode.lat, fromNode.lon]],
        access,
        motorVehicle,
        vehicle,
        bicycle: bicycleTag,
        foot: footTag,
      };

      let toList = adjacency.get(toId);
      if (!toList) {
        toList = [];
        adjacency.set(toId, toList);
      }
      toList.push(reverseEdge);
    }
  }

  // ── 3. Parse turn restrictions ───────────────────────────────────
  const restrictions: TurnRestriction[] = [];
  const relRe = /<relation\s[^>]*?>([\s\S]*?)<\/relation>/g;

  while ((m = relRe.exec(xmlString)) !== null) {
    const relBody = m[1];
    const typeMatch = /\bk="type"\s+v="([^"]+)"/.exec(relBody);
    if (!typeMatch || typeMatch[1] !== 'restriction') continue;

    const restMatch = /\bk="restriction"\s+v="([^"]+)"/.exec(relBody);
    if (!restMatch) continue;

    let fromWayId = 0;
    let viaNodeId = 0;
    let toWayId = 0;

    const memRe = /<member\s+type="(\w+)"\s+ref="(\d+)"\s+role="(\w+)"\s*\/>/g;
    let mm: RegExpExecArray | null;
    while ((mm = memRe.exec(relBody)) !== null) {
      const memberType = mm[1];
      const ref = Number(mm[2]);
      const role = mm[3];
      if (role === 'from' && memberType === 'way') fromWayId = ref;
      if (role === 'via' && memberType === 'node') viaNodeId = ref;
      if (role === 'to' && memberType === 'way') toWayId = ref;
    }

    if (fromWayId && viaNodeId && toWayId) {
      restrictions.push({ fromWayId, viaNodeId, toWayId, type: intern(restMatch[1]) });
    }
  }

  // ── 4. Build final node map (only referenced nodes) ──────────────
  const nodes = new Map<number, GraphNode>();
  for (const id of referencedNodes) {
    const node = allNodes.get(id);
    if (node) nodes.set(id, node);
  }

  return { nodes, adjacency, restrictions };
}
