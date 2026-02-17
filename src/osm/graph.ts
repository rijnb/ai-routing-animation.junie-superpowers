export type RoutingMode = 'car' | 'bicycle' | 'pedestrian';

export interface GraphNode {
  id: number;
  lat: number;
  lon: number;
  barrier?: string;
}

export interface GraphEdge {
  from: number;
  to: number;
  wayId: number;
  highway: string;
  maxspeed: number;
  oneway: boolean;
  onewayBicycle: boolean;
  isReverse: boolean;
  distance: number;
  geometry: [number, number][];
  access?: string;
  motorVehicle?: string;
  vehicle?: string;
  bicycle?: string;
  foot?: string;
}

export interface TurnRestriction {
  fromWayId: number;
  viaNodeId: number;
  toWayId: number;
  type: string;
}

export interface RoutingGraph {
  nodes: Map<number, GraphNode>;
  adjacency: Map<number, GraphEdge[]>;
  restrictions: TurnRestriction[];
}
