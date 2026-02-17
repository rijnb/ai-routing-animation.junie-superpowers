import L from 'leaflet';

export class MapView {
  private map: L.Map;
  private tileLayer: L.TileLayer;

  constructor(containerId: string) {
    this.map = L.map(containerId, {
      zoomControl: true,
      attributionControl: true,
    });

    // Create custom panes with z-ordering
    this.map.createPane('roadsPane').style.zIndex = '400';
    this.map.createPane('exploredPane').style.zIndex = '450';
    this.map.createPane('routePane').style.zIndex = '500';
    this.map.createPane('markersPane').style.zIndex = '600';

    // OSM tile layer at 50% opacity (default on)
    this.tileLayer = L.tileLayer(
      'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
      {
        attribution: '&copy; OpenStreetMap contributors',
        opacity: 0.5,
        maxZoom: 19,
      },
    ).addTo(this.map);

    // Default view (Netherlands)
    this.map.setView([52.37, 4.89], 14);
  }

  fitBounds(bounds: L.LatLngBoundsExpression): void {
    this.map.fitBounds(bounds, { padding: [20, 20] });
  }

  setTileLayerVisible(visible: boolean): void {
    if (visible) {
      if (!this.map.hasLayer(this.tileLayer)) {
        this.tileLayer.addTo(this.map);
      }
    } else {
      if (this.map.hasLayer(this.tileLayer)) {
        this.map.removeLayer(this.tileLayer);
      }
    }
  }

  getMap(): L.Map {
    return this.map;
  }

  onClick(handler: (lat: number, lon: number) => void): void {
    this.map.on('click', (e: L.LeafletMouseEvent) => {
      handler(e.latlng.lat, e.latlng.lng);
    });
  }
}
