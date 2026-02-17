import './style.css';
import { MapView } from './map/map-view';
import { MapRenderer } from './map/map-renderer';
import { parseOSM } from './osm/parser';
import { snapToRoad, SnapResult, trimRouteToSnapPoints } from './routing/map-matching';
import { runAStarToCompletion } from './routing/a-star';
import { Animator } from './animation/animator';
import { SettingsPanel } from './ui/settings-panel';
import { initTheme, toggleTheme } from './ui/theme';
import { RoutingGraph, RoutingMode } from './osm/graph';
import { ProgressBar } from './ui/progress-bar';
import { RouteInfoPanel } from './ui/route-info-panel';

// ── Application State ──
let graph: RoutingGraph | null = null;
let origin: SnapResult | null = null;
let destination: SnapResult | null = null;
let currentMode: RoutingMode = 'car';
let clickState: 'origin' | 'destination' = 'origin';
let ignoreRestrictions = false;

// ── Initialize ──
initTheme();
const mapView = new MapView('map');
const renderer = new MapRenderer(mapView);
const animator = new Animator(renderer);

const routeInfoPanel = new RouteInfoPanel();

const panel = new SettingsPanel('settings-panel', {
  onMapFileSelect: loadMap,
  onRoutingModeChange: changeMode,
  onSpeedChange: (speed) => animator.setSpeed(speed),
  onTilesToggle: (visible) => mapView.setTileLayerVisible(visible),
  onThemeToggle: () => {
    toggleTheme();
    // Redraw roads with new theme colors
    if (graph) renderer.drawRoads(graph);
  },
  onIgnoreRestrictionsToggle: (ignore) => {
    ignoreRestrictions = ignore;
    if (origin && destination) {
      calculateRoute();
    }
  },
});

mapView.onClick(handleMapClick);

renderer.onMarkerDrag('origin', handleOriginDrag);
renderer.onMarkerDrag('destination', handleDestinationDrag);

panel.init();

// ── Toast Messages ──
function showToast(message: string, duration = 3000): void {
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  document.body.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('visible'));
  setTimeout(() => {
    toast.classList.remove('visible');
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

// ── Map Loading ──
async function fetchWithProgress(
  url: string,
  progress: ProgressBar,
  filename: string,
): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to load ${filename}`);

  const contentLength = Number(response.headers.get('Content-Length') || 0);
  if (!contentLength || !response.body) {
    progress.update(50, `Downloading ${filename}…`);
    const blob = await response.blob();
    return decompressIfGzipped(blob);
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    const pct = Math.round((received / contentLength) * 60);
    progress.update(pct, `Downloading ${filename}…`);
  }

  const merged = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }

  const blob = new Blob([merged]);
  return decompressIfGzipped(blob);
}

async function decompressIfGzipped(blob: Blob): Promise<string> {
  // Check for gzip magic bytes (1f 8b) to detect if the data is still compressed.
  // Servers may set Content-Encoding: gzip, causing the browser to decompress
  // transparently, so we cannot rely on the filename extension alone.
  const header = new Uint8Array(await blob.slice(0, 2).arrayBuffer());
  if (header[0] === 0x1f && header[1] === 0x8b) {
    const ds = new DecompressionStream('gzip');
    const decompressedStream = blob.stream().pipeThrough(ds);
    const decompressedBlob = await new Response(decompressedStream).blob();
    return decompressedBlob.text();
  }
  return blob.text();
}

async function loadMap(filename: string): Promise<void> {
  const progress = new ProgressBar();
  progress.show();
  progress.update(0, `Downloading ${filename}…`);

  try {
    const xmlText = await fetchWithProgress(`/maps/${filename}`, progress, filename);

    // Let the UI repaint before the heavy synchronous parse
    progress.update(60, 'Parsing map data…');
    await new Promise((resolve) => requestAnimationFrame(resolve));

    graph = parseOSM(xmlText);
    origin = null;
    destination = null;
    clickState = 'origin';

    progress.update(85, 'Rendering roads…');
    await new Promise((resolve) => requestAnimationFrame(resolve));

    animator.reset();
    renderer.clearMarkers();
    renderer.drawRoads(graph);

    const bounds = renderer.getBounds(graph);
    if (bounds) mapView.fitBounds(bounds);

    progress.update(100, 'Done');
    showToast(`Loaded ${filename}: ${graph.nodes.size} nodes`);
  } catch (err) {
    showToast(`Error: ${err instanceof Error ? err.message : 'Unknown error'}`);
  } finally {
    progress.hide();
  }
}

// ── Map Click Handling ──
function handleMapClick(lat: number, lon: number): void {
  if (!graph) return;
  if (animator.isRunning()) return;

  const snap = snapToRoad(lat, lon, graph, currentMode);
  if (!snap) {
    showToast('No accessible road nearby');
    return;
  }

  if (clickState === 'origin') {
    origin = snap;
    destination = null;
    animator.reset();
    renderer.clearMarkers();
    renderer.setOriginMarker(snap.lat, snap.lon);
    clickState = 'destination';
    showToast('Origin set. Click destination.');
  } else {
    destination = snap;
    renderer.setDestinationMarker(snap.lat, snap.lon);
    clickState = 'origin';
    calculateRoute();
  }
}

// ── Routing Mode Change ──
function changeMode(mode: RoutingMode): void {
  currentMode = mode;

  if (!graph) return;

  // Re-snap origin and destination to valid roads for new mode
  if (origin) {
    const resnap = snapToRoad(origin.lat, origin.lon, graph, currentMode);
    if (resnap) {
      origin = resnap;
      renderer.clearMarkers();
      renderer.setOriginMarker(origin.lat, origin.lon);
    } else {
      origin = null;
      renderer.clearMarkers();
    }
  }

  if (destination) {
    const resnap = snapToRoad(destination.lat, destination.lon, graph, currentMode);
    if (resnap) {
      destination = resnap;
      renderer.setDestinationMarker(destination.lat, destination.lon);
    } else {
      destination = null;
    }
  }

  // Recalculate route if both points exist
  if (origin && destination) {
    calculateRoute();
  } else {
    animator.reset();
  }
}

// ── Marker Drag Handling ──
function handleOriginDrag(lat: number, lon: number): void {
  if (!graph) return;
  if (animator.isRunning()) return;

  const snap = snapToRoad(lat, lon, graph, currentMode);
  if (!snap) {
    // Snap failed — put marker back to previous position
    if (origin) renderer.setOriginMarker(origin.lat, origin.lon);
    showToast('No accessible road nearby');
    return;
  }

  origin = snap;
  renderer.setOriginMarker(snap.lat, snap.lon);

  if (destination) {
    calculateRoute();
  }
}

function handleDestinationDrag(lat: number, lon: number): void {
  if (!graph) return;
  if (animator.isRunning()) return;

  const snap = snapToRoad(lat, lon, graph, currentMode);
  if (!snap) {
    // Snap failed — put marker back to previous position
    if (destination) renderer.setDestinationMarker(destination.lat, destination.lon);
    showToast('No accessible road nearby');
    return;
  }

  destination = snap;
  renderer.setDestinationMarker(snap.lat, snap.lon);

  if (origin) {
    calculateRoute();
  }
}

// ── Route Calculation ──
function calculateRoute(): void {
  if (!graph || !origin || !destination) return;

  animator.reset();
  routeInfoPanel.hide();

  if (origin.nodeId === destination.nodeId) {
    showToast('Origin and destination are the same point');
    return;
  }

  const { steps, finalPath } = runAStarToCompletion(
    graph,
    origin.nodeId,
    destination.nodeId,
    currentMode,
    { ignoreRestrictions },
  );

  if (!finalPath) {
    showToast('No route found');
    return;
  }

  // Trim first/last edge geometry so the route starts/ends at the actual snap points
  const trimmed = trimRouteToSnapPoints(finalPath, origin, destination);

  const totalTimeMin = steps
    .filter((s) => s.type === 'done')
    .map((s) => (s as { totalTime: number }).totalTime / 60)
    [0] ?? 0;

  const totalDistanceKm = finalPath.reduce((sum, edge) => sum + edge.distance, 0) / 1000;

  routeInfoPanel.show();

  animator.loadSteps(steps, trimmed.edges);
  animator.start(
    () => {
      routeInfoPanel.showResult({
        totalTimeMin,
        totalDistanceKm,
        segments: finalPath.length,
      });
      showToast(`Route: ${Math.round(totalTimeMin)} min, ${finalPath.length} segments`);
    },
    (stats) => {
      routeInfoPanel.updateStats(stats);
    },
  );
}
