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
 * Extract the value of an XML attribute from a tag string.
 * Returns undefined if the attribute is not found.
 */
function getAttr(tag: string, name: string): string | undefined {
  const key = name + '="';
  const i = tag.indexOf(key);
  if (i === -1) return undefined;
  const start = i + key.length;
  const end = tag.indexOf('"', start);
  if (end === -1) return undefined;
  return tag.substring(start, end);
}

/**
 * Extract the value of an OSM <tag k="..." v="..."/> element.
 * Searches for k="key" and returns the corresponding v value.
 */
function getTagValue(body: string, key: string): string | undefined {
  const search = 'k="' + key + '"';
  const i = body.indexOf(search);
  if (i === -1) return undefined;
  // Find the v="..." after the k="..."
  const vStart = body.indexOf('v="', i + search.length);
  if (vStart === -1) return undefined;
  const valStart = vStart + 3;
  const valEnd = body.indexOf('"', valStart);
  if (valEnd === -1) return undefined;
  return body.substring(valStart, valEnd);
}

/**
 * Lightweight streaming OSM XML parser.
 *
 * Uses indexOf-based scanning instead of global regexes to avoid
 * catastrophic backtracking on large XML strings (which causes Safari
 * to hang). Individual elements are extracted with substring and
 * parsed with small-scope string operations.
 */
export function parseOSM(xmlString: string): RoutingGraph {
  console.debug(`[parseOSM] Starting parse of XML string: ${xmlString.length} chars`);
  const totalStart = performance.now();

  // ── 1. Parse nodes ───────────────────────────────────────────────
  console.debug('[parseOSM] Phase 1: Parsing nodes...');
  const nodesStart = performance.now();
  const allNodes = new Map<number, GraphNode>();

  let pos = 0;
  while (pos < xmlString.length) {
    const nodeStart = xmlString.indexOf('<node ', pos);
    if (nodeStart === -1) break;

    // Check for self-closing or body-containing node
    const selfClose = xmlString.indexOf('/>', nodeStart);
    const bodyOpen = xmlString.indexOf('>', nodeStart);
    if (bodyOpen === -1) break;

    let element: string;
    let inner: string | undefined;

    if (selfClose !== -1 && selfClose <= bodyOpen) {
      // Self-closing: <node ... />
      element = xmlString.substring(nodeStart, selfClose + 2);
      pos = selfClose + 2;
    } else {
      // Has body: <node ...>...</node>
      const closeTag = xmlString.indexOf('</node>', bodyOpen);
      if (closeTag === -1) { pos = bodyOpen + 1; continue; }
      element = xmlString.substring(nodeStart, closeTag + 7);
      inner = xmlString.substring(bodyOpen + 1, closeTag);
      pos = closeTag + 7;
    }

    const id = Number(getAttr(element, 'id'));
    const lat = Number(getAttr(element, 'lat'));
    const lon = Number(getAttr(element, 'lon'));
    if (isNaN(id) || isNaN(lat) || isNaN(lon)) continue;

    let barrier: string | undefined;
    if (inner) {
      const bv = getTagValue(inner, 'barrier');
      if (bv) barrier = intern(bv);
    }
    allNodes.set(id, { id, lat, lon, barrier });
  }
  console.debug(`[parseOSM] Phase 1 complete: ${allNodes.size} nodes parsed, took ${(performance.now() - nodesStart).toFixed(1)}ms`);

  // ── 2. Parse ways → edges ────────────────────────────────────────
  console.debug('[parseOSM] Phase 2: Parsing ways → edges...');
  const waysStart = performance.now();
  let wayCount = 0;
  const adjacency = new Map<number, GraphEdge[]>();
  const referencedNodes = new Set<number>();

  pos = 0;
  while (pos < xmlString.length) {
    const wayStart = xmlString.indexOf('<way ', pos);
    if (wayStart === -1) break;

    const bodyOpen = xmlString.indexOf('>', wayStart);
    if (bodyOpen === -1) break;

    const closeTag = xmlString.indexOf('</way>', bodyOpen);
    if (closeTag === -1) { pos = bodyOpen + 1; continue; }

    const wayTag = xmlString.substring(wayStart, bodyOpen + 1);
    const wayBody = xmlString.substring(bodyOpen + 1, closeTag);
    pos = closeTag + 6;

    // Quick highway check: skip ways without highway tag
    const highway = getTagValue(wayBody, 'highway');
    if (!highway) continue;

    const wayId = Number(getAttr(wayTag, 'id'));
    const internedHighway = intern(highway);

    // Parse tags
    const owVal = getTagValue(wayBody, 'oneway');
    const oneway = owVal === 'yes' || owVal === '1' || owVal === 'true';

    const owbVal = getTagValue(wayBody, 'oneway:bicycle');
    const onewayBicycle = owbVal ? owbVal !== 'no' : true;

    const msVal = getTagValue(wayBody, 'maxspeed');
    const maxspeed = msVal ? (parseInt(msVal, 10) || 0) : 0;

    const accVal = getTagValue(wayBody, 'access');
    const access = accVal ? intern(accVal) : undefined;

    const mvVal = getTagValue(wayBody, 'motor_vehicle');
    const motorVehicle = mvVal ? intern(mvVal) : undefined;

    const vVal = getTagValue(wayBody, 'vehicle');
    const vehicle = vVal ? intern(vVal) : undefined;

    const bicVal = getTagValue(wayBody, 'bicycle');
    const bicycleTag = bicVal ? intern(bicVal) : undefined;

    const footVal = getTagValue(wayBody, 'foot');
    const footTag = footVal ? intern(footVal) : undefined;

    // Collect nd refs using indexOf scanning
    const nodeIds: number[] = [];
    let ndPos = 0;
    while (ndPos < wayBody.length) {
      const ndStart = wayBody.indexOf('<nd ', ndPos);
      if (ndStart === -1) break;
      const ndEnd = wayBody.indexOf('/>', ndStart);
      if (ndEnd === -1) break;
      const refVal = getAttr(wayBody.substring(ndStart, ndEnd + 2), 'ref');
      if (refVal) nodeIds.push(Number(refVal));
      ndPos = ndEnd + 2;
    }

    wayCount++;
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
        highway: internedHighway,
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
        highway: internedHighway,
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

  console.debug(`[parseOSM] Phase 2 complete: ${wayCount} highway ways, ${adjacency.size} adjacency entries, ${referencedNodes.size} referenced nodes, took ${(performance.now() - waysStart).toFixed(1)}ms`);

  // ── 3. Parse turn restrictions ───────────────────────────────────
  console.debug('[parseOSM] Phase 3: Parsing turn restrictions...');
  const restrictionsStart = performance.now();
  const restrictions: TurnRestriction[] = [];

  pos = 0;
  while (pos < xmlString.length) {
    const relStart = xmlString.indexOf('<relation ', pos);
    if (relStart === -1) break;

    const bodyOpen = xmlString.indexOf('>', relStart);
    if (bodyOpen === -1) break;

    const closeTag = xmlString.indexOf('</relation>', bodyOpen);
    if (closeTag === -1) { pos = bodyOpen + 1; continue; }

    const relBody = xmlString.substring(bodyOpen + 1, closeTag);
    pos = closeTag + 11;

    const typeVal = getTagValue(relBody, 'type');
    if (typeVal !== 'restriction') continue;

    const restVal = getTagValue(relBody, 'restriction');
    if (!restVal) continue;

    let fromWayId = 0;
    let viaNodeId = 0;
    let toWayId = 0;

    // Parse <member> elements using indexOf
    let memPos = 0;
    while (memPos < relBody.length) {
      const memStart = relBody.indexOf('<member ', memPos);
      if (memStart === -1) break;
      const memEnd = relBody.indexOf('/>', memStart);
      if (memEnd === -1) break;
      const memTag = relBody.substring(memStart, memEnd + 2);
      memPos = memEnd + 2;

      const memberType = getAttr(memTag, 'type');
      const ref = Number(getAttr(memTag, 'ref'));
      const role = getAttr(memTag, 'role');
      if (role === 'from' && memberType === 'way') fromWayId = ref;
      if (role === 'via' && memberType === 'node') viaNodeId = ref;
      if (role === 'to' && memberType === 'way') toWayId = ref;
    }

    if (fromWayId && viaNodeId && toWayId) {
      restrictions.push({ fromWayId, viaNodeId, toWayId, type: intern(restVal) });
    }
  }

  console.debug(`[parseOSM] Phase 3 complete: ${restrictions.length} restrictions, took ${(performance.now() - restrictionsStart).toFixed(1)}ms`);

  // ── 4. Build final node map (only referenced nodes) ──────────────
  console.debug('[parseOSM] Phase 4: Building final node map...');
  const finalNodeStart = performance.now();
  const nodes = new Map<number, GraphNode>();
  for (const id of referencedNodes) {
    const node = allNodes.get(id);
    if (node) nodes.set(id, node);
  }

  console.debug(`[parseOSM] Phase 4 complete: ${nodes.size} final nodes, took ${(performance.now() - finalNodeStart).toFixed(1)}ms`);
  console.debug(`[parseOSM] Total parse time: ${(performance.now() - totalStart).toFixed(1)}ms`);
  return { nodes, adjacency, restrictions };
}
