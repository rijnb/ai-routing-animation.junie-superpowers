import { describe, it, expect } from 'vitest';
import { parseOSM, haversine } from './parser';

function osmXml(inner: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?><osm version="0.6">${inner}</osm>`;
}

describe('haversine', () => {
  it('returns 0 for same point', () => {
    expect(haversine(52.37, 4.89, 52.37, 4.89)).toBe(0);
  });

  it('computes distance between two known points', () => {
    // Amsterdam Centraal (52.3791, 4.9003) → Dam Square (52.3731, 4.8932)
    const d = haversine(52.3791, 4.9003, 52.3731, 4.8932);
    expect(d).toBeGreaterThan(700);
    expect(d).toBeLessThan(900);
  });
});

describe('parseOSM', () => {
  it('parses nodes', () => {
    const xml = osmXml(`
      <node id="1" lat="52.37" lon="4.89"/>
      <node id="2" lat="52.38" lon="4.90"/>
    `);
    const graph = parseOSM(xml);
    // Nodes not referenced by any way are pruned
    expect(graph.nodes.size).toBe(0);
  });

  it('parses a simple way into edges', () => {
    const xml = osmXml(`
      <node id="1" lat="52.370" lon="4.890"/>
      <node id="2" lat="52.371" lon="4.891"/>
      <node id="3" lat="52.372" lon="4.892"/>
      <way id="100">
        <nd ref="1"/><nd ref="2"/><nd ref="3"/>
        <tag k="highway" v="residential"/>
      </way>
    `);
    const graph = parseOSM(xml);
    expect(graph.nodes.size).toBe(3);
    // Non-oneway: forward + reverse for each segment pair
    // Node 1: edge 1→2 + reverse from node 2 (2→1)
    const edges1 = graph.adjacency.get(1)!;
    expect(edges1.some((e) => e.from === 1 && e.to === 2)).toBe(true);
  });

  it('creates bidirectional edges for non-oneway roads', () => {
    const xml = osmXml(`
      <node id="1" lat="52.370" lon="4.890"/>
      <node id="2" lat="52.371" lon="4.891"/>
      <way id="100">
        <nd ref="1"/><nd ref="2"/>
        <tag k="highway" v="residential"/>
      </way>
    `);
    const graph = parseOSM(xml);
    const edges1 = graph.adjacency.get(1)!;
    const edges2 = graph.adjacency.get(2)!;
    expect(edges1.some((e) => e.from === 1 && e.to === 2)).toBe(true);
    expect(edges2.some((e) => e.from === 2 && e.to === 1)).toBe(true);
  });

  it('creates forward and reverse edges for oneway roads with isReverse flag', () => {
    const xml = osmXml(`
      <node id="1" lat="52.370" lon="4.890"/>
      <node id="2" lat="52.371" lon="4.891"/>
      <way id="100">
        <nd ref="1"/><nd ref="2"/>
        <tag k="highway" v="residential"/>
        <tag k="oneway" v="yes"/>
      </way>
    `);
    const graph = parseOSM(xml);
    const edges1 = graph.adjacency.get(1)!;
    // Forward edge exists with isReverse=false
    const fwd = edges1.find((e) => e.from === 1 && e.to === 2);
    expect(fwd).toBeDefined();
    expect(fwd!.isReverse).toBe(false);
    // Reverse edge exists at node 2 with isReverse=true
    const edges2 = graph.adjacency.get(2)!;
    const rev = edges2.find((e) => e.from === 2 && e.to === 1);
    expect(rev).toBeDefined();
    expect(rev!.isReverse).toBe(true);
    expect(rev!.oneway).toBe(true);
  });

  it('parses maxspeed tag', () => {
    const xml = osmXml(`
      <node id="1" lat="52.370" lon="4.890"/>
      <node id="2" lat="52.371" lon="4.891"/>
      <way id="100">
        <nd ref="1"/><nd ref="2"/>
        <tag k="highway" v="primary"/>
        <tag k="maxspeed" v="50"/>
      </way>
    `);
    const graph = parseOSM(xml);
    const edge = graph.adjacency.get(1)!.find((e) => e.from === 1)!;
    expect(edge.maxspeed).toBe(50);
  });

  it('parses oneway:bicycle tag', () => {
    const xml = osmXml(`
      <node id="1" lat="52.370" lon="4.890"/>
      <node id="2" lat="52.371" lon="4.891"/>
      <way id="100">
        <nd ref="1"/><nd ref="2"/>
        <tag k="highway" v="residential"/>
        <tag k="oneway" v="yes"/>
        <tag k="oneway:bicycle" v="no"/>
      </way>
    `);
    const graph = parseOSM(xml);
    const edge = graph.adjacency.get(1)!.find((e) => e.from === 1)!;
    expect(edge.oneway).toBe(true);
    expect(edge.onewayBicycle).toBe(false);
  });

  it('parses turn restrictions', () => {
    const xml = osmXml(`
      <node id="1" lat="52.370" lon="4.890"/>
      <node id="2" lat="52.371" lon="4.891"/>
      <node id="3" lat="52.372" lon="4.892"/>
      <way id="100">
        <nd ref="1"/><nd ref="2"/>
        <tag k="highway" v="residential"/>
      </way>
      <way id="200">
        <nd ref="2"/><nd ref="3"/>
        <tag k="highway" v="residential"/>
      </way>
      <relation id="500">
        <member type="way" ref="100" role="from"/>
        <member type="node" ref="2" role="via"/>
        <member type="way" ref="200" role="to"/>
        <tag k="type" v="restriction"/>
        <tag k="restriction" v="no_left_turn"/>
      </relation>
    `);
    const graph = parseOSM(xml);
    expect(graph.restrictions).toHaveLength(1);
    expect(graph.restrictions[0]).toEqual({
      fromWayId: 100,
      viaNodeId: 2,
      toWayId: 200,
      type: 'no_left_turn',
    });
  });

  it('computes haversine distance for edges', () => {
    const xml = osmXml(`
      <node id="1" lat="52.370" lon="4.890"/>
      <node id="2" lat="52.371" lon="4.891"/>
      <way id="100">
        <nd ref="1"/><nd ref="2"/>
        <tag k="highway" v="residential"/>
      </way>
    `);
    const graph = parseOSM(xml);
    const edge = graph.adjacency.get(1)!.find((e) => e.from === 1)!;
    expect(edge.distance).toBeGreaterThan(0);
    // ~130m between these points
    expect(edge.distance).toBeGreaterThan(100);
    expect(edge.distance).toBeLessThan(200);
  });

  it('ignores ways without highway tag', () => {
    const xml = osmXml(`
      <node id="1" lat="52.370" lon="4.890"/>
      <node id="2" lat="52.371" lon="4.891"/>
      <way id="100">
        <nd ref="1"/><nd ref="2"/>
        <tag k="building" v="yes"/>
      </way>
    `);
    const graph = parseOSM(xml);
    expect(graph.nodes.size).toBe(0);
    expect(graph.adjacency.size).toBe(0);
  });

  it('stores geometry on edges', () => {
    const xml = osmXml(`
      <node id="1" lat="52.370" lon="4.890"/>
      <node id="2" lat="52.371" lon="4.891"/>
      <way id="100">
        <nd ref="1"/><nd ref="2"/>
        <tag k="highway" v="residential"/>
      </way>
    `);
    const graph = parseOSM(xml);
    const edge = graph.adjacency.get(1)!.find((e) => e.from === 1)!;
    expect(edge.geometry).toEqual([[52.370, 4.890], [52.371, 4.891]]);
  });

  it('parses barrier tag on nodes', () => {
    const xml = osmXml(`
      <node id="1" lat="52.370" lon="4.890"/>
      <node id="2" lat="52.371" lon="4.891">
        <tag k="barrier" v="bollard"/>
      </node>
      <way id="100">
        <nd ref="1"/><nd ref="2"/>
        <tag k="highway" v="residential"/>
      </way>
    `);
    const graph = parseOSM(xml);
    expect(graph.nodes.get(2)!.barrier).toBe('bollard');
    expect(graph.nodes.get(1)!.barrier).toBeUndefined();
  });

  it('parses access tags on ways', () => {
    const xml = osmXml(`
      <node id="1" lat="52.370" lon="4.890"/>
      <node id="2" lat="52.371" lon="4.891"/>
      <way id="100">
        <nd ref="1"/><nd ref="2"/>
        <tag k="highway" v="residential"/>
        <tag k="access" v="private"/>
        <tag k="motor_vehicle" v="no"/>
        <tag k="vehicle" v="no"/>
        <tag k="bicycle" v="yes"/>
        <tag k="foot" v="yes"/>
      </way>
    `);
    const graph = parseOSM(xml);
    const edge = graph.adjacency.get(1)!.find((e) => e.from === 1)!;
    expect(edge.access).toBe('private');
    expect(edge.motorVehicle).toBe('no');
    expect(edge.vehicle).toBe('no');
    expect(edge.bicycle).toBe('yes');
    expect(edge.foot).toBe('yes');
  });

  it('leaves access tags undefined when not present', () => {
    const xml = osmXml(`
      <node id="1" lat="52.370" lon="4.890"/>
      <node id="2" lat="52.371" lon="4.891"/>
      <way id="100">
        <nd ref="1"/><nd ref="2"/>
        <tag k="highway" v="residential"/>
      </way>
    `);
    const graph = parseOSM(xml);
    const edge = graph.adjacency.get(1)!.find((e) => e.from === 1)!;
    expect(edge.access).toBeUndefined();
    expect(edge.motorVehicle).toBeUndefined();
    expect(edge.vehicle).toBeUndefined();
    expect(edge.bicycle).toBeUndefined();
    expect(edge.foot).toBeUndefined();
  });
});
