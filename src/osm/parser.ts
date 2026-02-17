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

function getTag(el: Element, key: string): string | null {
  const tags = el.getElementsByTagName('tag');
  for (let i = 0; i < tags.length; i++) {
    if (tags[i].getAttribute('k') === key) {
      return tags[i].getAttribute('v');
    }
  }
  return null;
}

export function parseOSM(xmlString: string): RoutingGraph {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlString, 'text/xml');

  // 1. Parse nodes
  const allNodes = new Map<number, GraphNode>();
  const nodeEls = doc.getElementsByTagName('node');
  for (let i = 0; i < nodeEls.length; i++) {
    const el = nodeEls[i];
    const id = Number(el.getAttribute('id'));
    const lat = Number(el.getAttribute('lat'));
    const lon = Number(el.getAttribute('lon'));
    if (!isNaN(id) && !isNaN(lat) && !isNaN(lon)) {
      const barrier = getTag(el, 'barrier') ?? undefined;
      allNodes.set(id, { id, lat, lon, barrier });
    }
  }

  // 2. Parse ways → edges
  const adjacency = new Map<number, GraphEdge[]>();
  const referencedNodes = new Set<number>();
  const wayEls = doc.getElementsByTagName('way');

  for (let i = 0; i < wayEls.length; i++) {
    const way = wayEls[i];
    const highway = getTag(way, 'highway');
    if (!highway) continue;

    const wayId = Number(way.getAttribute('id'));
    const onewayTag = getTag(way, 'oneway');
    const oneway = onewayTag === 'yes' || onewayTag === '1' || onewayTag === 'true';
    const onewayBicycleTag = getTag(way, 'oneway:bicycle');
    const onewayBicycle = onewayBicycleTag !== 'no';
    const maxspeedTag = getTag(way, 'maxspeed');
    const maxspeed = maxspeedTag ? parseInt(maxspeedTag, 10) || 0 : 0;
    const access = getTag(way, 'access') ?? undefined;
    const motorVehicle = getTag(way, 'motor_vehicle') ?? undefined;
    const vehicle = getTag(way, 'vehicle') ?? undefined;
    const bicycleTag = getTag(way, 'bicycle') ?? undefined;
    const footTag = getTag(way, 'foot') ?? undefined;

    const ndEls = way.getElementsByTagName('nd');
    const nodeIds: number[] = [];
    for (let j = 0; j < ndEls.length; j++) {
      nodeIds.push(Number(ndEls[j].getAttribute('ref')));
    }

    for (let j = 0; j < nodeIds.length - 1; j++) {
      const fromId = nodeIds[j];
      const toId = nodeIds[j + 1];
      const fromNode = allNodes.get(fromId);
      const toNode = allNodes.get(toId);
      if (!fromNode || !toNode) continue;

      referencedNodes.add(fromId);
      referencedNodes.add(toId);

      const distance = haversine(fromNode.lat, fromNode.lon, toNode.lat, toNode.lon);
      const geometry: [number, number][] = [
        [fromNode.lat, fromNode.lon],
        [toNode.lat, toNode.lon],
      ];

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
        geometry,
        access,
        motorVehicle,
        vehicle,
        bicycle: bicycleTag,
        foot: footTag,
      };

      // Forward direction: always add edge from fromId
      if (!adjacency.has(fromId)) adjacency.set(fromId, []);
      adjacency.get(fromId)!.push(edge);

      // Reverse direction: always add reverse edge from toId
      // canTraverseDirection() will check oneway rules per mode using isReverse
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
      if (!adjacency.has(toId)) adjacency.set(toId, []);
      adjacency.get(toId)!.push(reverseEdge);
    }
  }

  // 3. Parse turn restrictions
  const restrictions: TurnRestriction[] = [];
  const relationEls = doc.getElementsByTagName('relation');
  for (let i = 0; i < relationEls.length; i++) {
    const rel = relationEls[i];
    const type = getTag(rel, 'type');
    if (type !== 'restriction') continue;

    const restrictionType = getTag(rel, 'restriction');
    if (!restrictionType) continue;

    let fromWayId = 0;
    let viaNodeId = 0;
    let toWayId = 0;

    const members = rel.getElementsByTagName('member');
    for (let j = 0; j < members.length; j++) {
      const role = members[j].getAttribute('role');
      const memberType = members[j].getAttribute('type');
      const ref = Number(members[j].getAttribute('ref'));
      if (role === 'from' && memberType === 'way') fromWayId = ref;
      if (role === 'via' && memberType === 'node') viaNodeId = ref;
      if (role === 'to' && memberType === 'way') toWayId = ref;
    }

    if (fromWayId && viaNodeId && toWayId) {
      restrictions.push({ fromWayId, viaNodeId, toWayId, type: restrictionType });
    }
  }

  // 4. Build final node map (only referenced nodes)
  const nodes = new Map<number, GraphNode>();
  for (const id of referencedNodes) {
    const node = allNodes.get(id);
    if (node) nodes.set(id, node);
  }

  return { nodes, adjacency, restrictions };
}
