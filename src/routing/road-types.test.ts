import { describe, it, expect } from 'vitest';
import { GraphEdge, GraphNode } from '../osm/graph';
import {
  isEdgeAccessible,
  isBarrierBlocking,
  canTraverseDirection,
  getTravelSpeed,
  getTravelTime,
  getMaxSpeed,
} from './road-types';

function makeEdge(overrides: Partial<GraphEdge> = {}): GraphEdge {
  return {
    from: 1,
    to: 2,
    wayId: 100,
    highway: 'residential',
    maxspeed: 0,
    oneway: false,
    onewayBicycle: false,
    isReverse: false,
    distance: 100,
    geometry: [[0, 0], [1, 1]],
    ...overrides,
  };
}

describe('isEdgeAccessible', () => {
  it('allows car on residential', () => {
    expect(isEdgeAccessible(makeEdge({ highway: 'residential' }), 'car')).toBe(true);
  });

  it('blocks car on footway', () => {
    expect(isEdgeAccessible(makeEdge({ highway: 'footway' }), 'car')).toBe(false);
  });

  it('allows bicycle on cycleway', () => {
    expect(isEdgeAccessible(makeEdge({ highway: 'cycleway' }), 'bicycle')).toBe(true);
  });

  it('blocks bicycle on footway', () => {
    expect(isEdgeAccessible(makeEdge({ highway: 'footway' }), 'bicycle')).toBe(false);
  });

  it('allows pedestrian on footway', () => {
    expect(isEdgeAccessible(makeEdge({ highway: 'footway' }), 'pedestrian')).toBe(true);
  });

  it('allows pedestrian on steps', () => {
    expect(isEdgeAccessible(makeEdge({ highway: 'steps' }), 'pedestrian')).toBe(true);
  });

  it('blocks all modes on busway', () => {
    expect(isEdgeAccessible(makeEdge({ highway: 'busway' }), 'car')).toBe(false);
    expect(isEdgeAccessible(makeEdge({ highway: 'busway' }), 'bicycle')).toBe(false);
    expect(isEdgeAccessible(makeEdge({ highway: 'busway' }), 'pedestrian')).toBe(false);
  });

  it('returns false for unknown highway type', () => {
    expect(isEdgeAccessible(makeEdge({ highway: 'construction' }), 'car')).toBe(false);
    expect(isEdgeAccessible(makeEdge({ highway: 'construction' }), 'bicycle')).toBe(false);
    expect(isEdgeAccessible(makeEdge({ highway: 'construction' }), 'pedestrian')).toBe(false);
  });

  it('allows car on primary', () => {
    expect(isEdgeAccessible(makeEdge({ highway: 'primary' }), 'car')).toBe(true);
  });

  it('blocks car on cycleway', () => {
    expect(isEdgeAccessible(makeEdge({ highway: 'cycleway' }), 'car')).toBe(false);
  });

  it('blocks car when motor_vehicle=no', () => {
    expect(isEdgeAccessible(makeEdge({ highway: 'residential', motorVehicle: 'no' }), 'car')).toBe(false);
  });

  it('blocks car when motor_vehicle=private', () => {
    expect(isEdgeAccessible(makeEdge({ highway: 'residential', motorVehicle: 'private' }), 'car')).toBe(false);
  });

  it('allows car when motor_vehicle=yes', () => {
    expect(isEdgeAccessible(makeEdge({ highway: 'residential', motorVehicle: 'yes' }), 'car')).toBe(true);
  });

  it('blocks car when vehicle=no', () => {
    expect(isEdgeAccessible(makeEdge({ highway: 'residential', vehicle: 'no' }), 'car')).toBe(false);
  });

  it('motor_vehicle overrides vehicle for car', () => {
    expect(isEdgeAccessible(makeEdge({ highway: 'residential', motorVehicle: 'yes', vehicle: 'no' }), 'car')).toBe(true);
  });

  it('blocks car when access=no', () => {
    expect(isEdgeAccessible(makeEdge({ highway: 'residential', access: 'no' }), 'car')).toBe(false);
  });

  it('blocks car when access=private', () => {
    expect(isEdgeAccessible(makeEdge({ highway: 'residential', access: 'private' }), 'car')).toBe(false);
  });

  it('motor_vehicle overrides access for car', () => {
    expect(isEdgeAccessible(makeEdge({ highway: 'residential', motorVehicle: 'yes', access: 'no' }), 'car')).toBe(true);
  });

  it('blocks bicycle when bicycle=no', () => {
    expect(isEdgeAccessible(makeEdge({ highway: 'residential', bicycle: 'no' }), 'bicycle')).toBe(false);
  });

  it('allows bicycle when bicycle=yes on cycleway', () => {
    expect(isEdgeAccessible(makeEdge({ highway: 'cycleway', bicycle: 'yes' }), 'bicycle')).toBe(true);
  });

  it('blocks bicycle when vehicle=no', () => {
    expect(isEdgeAccessible(makeEdge({ highway: 'residential', vehicle: 'no' }), 'bicycle')).toBe(false);
  });

  it('bicycle tag overrides vehicle for bicycle', () => {
    expect(isEdgeAccessible(makeEdge({ highway: 'residential', bicycle: 'yes', vehicle: 'no' }), 'bicycle')).toBe(true);
  });

  it('blocks pedestrian when foot=no', () => {
    expect(isEdgeAccessible(makeEdge({ highway: 'footway', foot: 'no' }), 'pedestrian')).toBe(false);
  });

  it('blocks pedestrian when access=private', () => {
    expect(isEdgeAccessible(makeEdge({ highway: 'residential', access: 'private' }), 'pedestrian')).toBe(false);
  });

  it('foot tag overrides access for pedestrian', () => {
    expect(isEdgeAccessible(makeEdge({ highway: 'residential', foot: 'yes', access: 'no' }), 'pedestrian')).toBe(true);
  });

  it('allows car when access=destination (permissive)', () => {
    expect(isEdgeAccessible(makeEdge({ highway: 'residential', access: 'destination' }), 'car')).toBe(true);
  });
});

describe('isBarrierBlocking', () => {
  function makeNode(barrier?: string): GraphNode {
    return { id: 1, lat: 0, lon: 0, barrier };
  }

  it('blocks car at bollard', () => {
    expect(isBarrierBlocking(makeNode('bollard'), 'car')).toBe(true);
  });

  it('blocks car at block', () => {
    expect(isBarrierBlocking(makeNode('block'), 'car')).toBe(true);
  });

  it('blocks car at cycle_barrier', () => {
    expect(isBarrierBlocking(makeNode('cycle_barrier'), 'car')).toBe(true);
  });

  it('does not block car at gate', () => {
    expect(isBarrierBlocking(makeNode('gate'), 'car')).toBe(false);
  });

  it('does not block car at lift_gate', () => {
    expect(isBarrierBlocking(makeNode('lift_gate'), 'car')).toBe(false);
  });

  it('does not block car at cattle_grid', () => {
    expect(isBarrierBlocking(makeNode('cattle_grid'), 'car')).toBe(false);
  });

  it('does not block car when no barrier', () => {
    expect(isBarrierBlocking(makeNode(undefined), 'car')).toBe(false);
  });

  it('blocks bicycle at block', () => {
    expect(isBarrierBlocking(makeNode('block'), 'bicycle')).toBe(true);
  });

  it('does not block bicycle at bollard', () => {
    expect(isBarrierBlocking(makeNode('bollard'), 'bicycle')).toBe(false);
  });

  it('does not block pedestrian at bollard', () => {
    expect(isBarrierBlocking(makeNode('bollard'), 'pedestrian')).toBe(false);
  });

  it('does not block pedestrian at any barrier', () => {
    expect(isBarrierBlocking(makeNode('block'), 'pedestrian')).toBe(false);
    expect(isBarrierBlocking(makeNode('cycle_barrier'), 'pedestrian')).toBe(false);
  });
});

describe('canTraverseDirection', () => {
  it('allows car forward on oneway', () => {
    const edge = makeEdge({ oneway: true, isReverse: false });
    expect(canTraverseDirection(edge, 1, 'car')).toBe(true);
  });

  it('blocks car going wrong way on oneway', () => {
    const edge = makeEdge({ oneway: true, isReverse: true });
    expect(canTraverseDirection(edge, 2, 'car')).toBe(false);
  });

  it('allows car in both directions when not oneway', () => {
    const fwd = makeEdge({ oneway: false, isReverse: false });
    const rev = makeEdge({ oneway: false, isReverse: true });
    expect(canTraverseDirection(fwd, 1, 'car')).toBe(true);
    expect(canTraverseDirection(rev, 2, 'car')).toBe(true);
  });

  it('allows bicycle wrong way when onewayBicycle is false', () => {
    const edge = makeEdge({ oneway: true, onewayBicycle: false, isReverse: true });
    expect(canTraverseDirection(edge, 2, 'bicycle')).toBe(true);
  });

  it('blocks bicycle wrong way when onewayBicycle is true', () => {
    const edge = makeEdge({ oneway: true, onewayBicycle: true, isReverse: true });
    expect(canTraverseDirection(edge, 2, 'bicycle')).toBe(false);
  });

  it('allows pedestrian on oneway in either direction', () => {
    const fwd = makeEdge({ oneway: true, isReverse: false });
    const rev = makeEdge({ oneway: true, isReverse: true });
    expect(canTraverseDirection(fwd, 1, 'pedestrian')).toBe(true);
    expect(canTraverseDirection(rev, 2, 'pedestrian')).toBe(true);
  });

  it('allows car wrong way on oneway when ignoreRestrictions is true', () => {
    const edge = makeEdge({ oneway: true, isReverse: true });
    expect(canTraverseDirection(edge, 2, 'car', true)).toBe(true);
  });

  it('still blocks car wrong way on oneway when ignoreRestrictions is false', () => {
    const edge = makeEdge({ oneway: true, isReverse: true });
    expect(canTraverseDirection(edge, 2, 'car', false)).toBe(false);
  });
});

describe('getTravelSpeed', () => {
  it('returns 20 for bicycle regardless of road', () => {
    expect(getTravelSpeed(makeEdge({ highway: 'primary', maxspeed: 50 }), 'bicycle')).toBe(20);
    expect(getTravelSpeed(makeEdge({ highway: 'residential' }), 'bicycle')).toBe(20);
  });

  it('returns 5 for pedestrian regardless of road', () => {
    expect(getTravelSpeed(makeEdge({ highway: 'primary', maxspeed: 50 }), 'pedestrian')).toBe(5);
    expect(getTravelSpeed(makeEdge({ highway: 'footway' }), 'pedestrian')).toBe(5);
  });

  it('returns maxspeed for car when set', () => {
    expect(getTravelSpeed(makeEdge({ maxspeed: 70 }), 'car')).toBe(70);
  });

  it('returns default speed for car when maxspeed is 0', () => {
    expect(getTravelSpeed(makeEdge({ highway: 'primary', maxspeed: 0 }), 'car')).toBe(50);
    expect(getTravelSpeed(makeEdge({ highway: 'residential', maxspeed: 0 }), 'car')).toBe(30);
    expect(getTravelSpeed(makeEdge({ highway: 'service', maxspeed: 0 }), 'car')).toBe(15);
  });

  it('returns fallback 30 for unknown highway type', () => {
    expect(getTravelSpeed(makeEdge({ highway: 'unknown', maxspeed: 0 }), 'car')).toBe(30);
  });
});

describe('getTravelTime', () => {
  it('computes time = distance / speed in seconds', () => {
    const edge = makeEdge({ distance: 1000, maxspeed: 36 });
    // 36 km/h = 10 m/s → 1000m / 10 m/s = 100s
    expect(getTravelTime(edge, 'car')).toBeCloseTo(100, 1);
  });

  it('computes travel time for bicycle', () => {
    const edge = makeEdge({ distance: 1000 });
    // 20 km/h = 5.556 m/s → 1000 / 5.556 ≈ 180s
    expect(getTravelTime(edge, 'bicycle')).toBeCloseTo(180, 0);
  });

  it('computes travel time for pedestrian', () => {
    const edge = makeEdge({ distance: 500 });
    // 5 km/h = 1.389 m/s → 500 / 1.389 ≈ 360s
    expect(getTravelTime(edge, 'pedestrian')).toBeCloseTo(360, 0);
  });
});

describe('getMaxSpeed', () => {
  it('returns 20 for bicycle', () => {
    expect(getMaxSpeed('bicycle')).toBe(20);
  });

  it('returns 5 for pedestrian', () => {
    expect(getMaxSpeed('pedestrian')).toBe(5);
  });

  it('returns 100 for car', () => {
    expect(getMaxSpeed('car')).toBe(100);
  });
});
