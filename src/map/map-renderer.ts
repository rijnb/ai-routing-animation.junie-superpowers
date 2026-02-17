import L from 'leaflet';
import { RoutingGraph, GraphEdge } from '../osm/graph';
import { MapView } from './map-view';

export type MarkerDragCallback = (lat: number, lon: number) => void;

export class MapRenderer {
  private roadLayerGroup: L.LayerGroup;
  private exploredLayerGroup: L.LayerGroup;
  private routeLayerGroup: L.LayerGroup;
  private markerLayerGroup: L.LayerGroup;
  private originMarker: L.Marker | null = null;
  private destMarker: L.Marker | null = null;
  private onOriginDrag: MarkerDragCallback | null = null;
  private onDestinationDrag: MarkerDragCallback | null = null;

  constructor(private mapView: MapView) {
    const map = mapView.getMap();
    this.roadLayerGroup = L.layerGroup([], { pane: 'roadsPane' }).addTo(map);
    this.exploredLayerGroup = L.layerGroup([], { pane: 'exploredPane' }).addTo(map);
    this.routeLayerGroup = L.layerGroup([], { pane: 'routePane' }).addTo(map);
    this.markerLayerGroup = L.layerGroup([], { pane: 'markersPane' }).addTo(map);
  }

  drawRoads(graph: RoutingGraph): void {
    this.clearRoads();
    const seen = new Set<string>();

    for (const edges of graph.adjacency.values()) {
      for (const edge of edges) {
        const key = `${edge.wayId}-${edge.from}-${edge.to}`;
        if (seen.has(key)) continue;
        seen.add(key);

        const latlngs = edge.geometry.map(([lat, lon]) => L.latLng(lat, lon));
        const color = this.getRoadColor(edge.highway);
        const weight = this.getRoadWeight(edge.highway);

        L.polyline(latlngs, {
          color,
          weight,
          opacity: 0.7,
          pane: 'roadsPane',
        }).addTo(this.roadLayerGroup);
      }
    }
  }

  clearRoads(): void {
    this.roadLayerGroup.clearLayers();
  }

  addExploredEdge(edge: GraphEdge): void {
    const latlngs = edge.geometry.map(([lat, lon]) => L.latLng(lat, lon));
    L.polyline(latlngs, {
      color: '#3b82f6',
      weight: 2,
      opacity: 0.6,
      pane: 'exploredPane',
    }).addTo(this.exploredLayerGroup);
  }

  addRouteEdge(edge: GraphEdge): void {
    const latlngs = edge.geometry.map(([lat, lon]) => L.latLng(lat, lon));
    L.polyline(latlngs, {
      color: '#ef4444',
      weight: 5,
      opacity: 0.9,
      pane: 'routePane',
    }).addTo(this.routeLayerGroup);
  }

  clearAnimation(): void {
    this.exploredLayerGroup.clearLayers();
    this.routeLayerGroup.clearLayers();
  }

  onMarkerDrag(type: 'origin' | 'destination', callback: MarkerDragCallback): void {
    if (type === 'origin') {
      this.onOriginDrag = callback;
    } else {
      this.onDestinationDrag = callback;
    }
  }

  setOriginMarker(lat: number, lon: number): void {
    if (this.originMarker) {
      this.markerLayerGroup.removeLayer(this.originMarker);
    }
    this.originMarker = this.createDraggableMarker(lat, lon, '#22c55e', (newLat, newLon) => {
      this.onOriginDrag?.(newLat, newLon);
    });
  }

  setDestinationMarker(lat: number, lon: number): void {
    if (this.destMarker) {
      this.markerLayerGroup.removeLayer(this.destMarker);
    }
    this.destMarker = this.createDraggableMarker(lat, lon, '#ef4444', (newLat, newLon) => {
      this.onDestinationDrag?.(newLat, newLon);
    });
  }

  clearMarkers(): void {
    this.markerLayerGroup.clearLayers();
    this.originMarker = null;
    this.destMarker = null;
  }

  private createDraggableMarker(
    lat: number,
    lon: number,
    color: string,
    onDragEnd: (lat: number, lon: number) => void,
  ): L.Marker {
    const icon = L.divIcon({
      className: 'route-marker',
      html: `<div style="
        width: 16px;
        height: 16px;
        border-radius: 50%;
        background: ${color};
        border: 2px solid #fff;
        box-shadow: 0 1px 4px rgba(0,0,0,0.3);
        cursor: grab;
      "></div>`,
      iconSize: [16, 16],
      iconAnchor: [8, 8],
    });

    const marker = L.marker([lat, lon], {
      icon,
      draggable: true,
      pane: 'markersPane',
    }).addTo(this.markerLayerGroup);

    marker.on('dragend', () => {
      const pos = marker.getLatLng();
      onDragEnd(pos.lat, pos.lng);
    });

    return marker;
  }

  getBounds(graph: RoutingGraph): L.LatLngBounds | null {
    const lats: number[] = [];
    const lons: number[] = [];
    for (const node of graph.nodes.values()) {
      lats.push(node.lat);
      lons.push(node.lon);
    }
    if (lats.length === 0) return null;
    return L.latLngBounds(
      [Math.min(...lats), Math.min(...lons)],
      [Math.max(...lats), Math.max(...lons)],
    );
  }

  private getRoadColor(highway: string): string {
    const style = getComputedStyle(document.documentElement);
    const mainColor = style.getPropertyValue('--road-color').trim() || '#888';
    const minorColor = style.getPropertyValue('--road-minor-color').trim() || '#aaa';

    switch (highway) {
      case 'primary':
      case 'primary_link':
      case 'secondary':
      case 'secondary_link':
      case 'tertiary':
      case 'tertiary_link':
        return mainColor;
      default:
        return minorColor;
    }
  }

  private getRoadWeight(highway: string): number {
    switch (highway) {
      case 'primary':
      case 'primary_link':
        return 3;
      case 'secondary':
      case 'secondary_link':
      case 'tertiary':
      case 'tertiary_link':
        return 2;
      default:
        return 1;
    }
  }
}
