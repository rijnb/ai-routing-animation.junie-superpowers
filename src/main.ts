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
console.debug('[init] Starting application initialization...');
initTheme();
console.debug('[init] Theme initialized');
const mapView = new MapView('map');
console.debug('[init] MapView created');
const renderer = new MapRenderer(mapView);
console.debug('[init] MapRenderer created');
const animator = new Animator(renderer);
console.debug('[init] Animator created');

const routeInfoPanel = new RouteInfoPanel();
console.debug('[init] RouteInfoPanel created');

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
console.debug('[init] Map click handler registered');

renderer.onMarkerDrag('origin', handleOriginDrag);
renderer.onMarkerDrag('destination', handleDestinationDrag);
console.debug('[init] Marker drag handlers registered');

console.debug('[init] Calling panel.init() to load map file list...');
panel.init();
console.debug('[init] panel.init() called (async, may still be loading)');

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
  console.debug(`[fetchWithProgress] Starting fetch for: ${url}`);
  const fetchStart = performance.now();
  const response = await fetch(url);
  console.debug(`[fetchWithProgress] Fetch response received: status=${response.status}, took ${(performance.now() - fetchStart).toFixed(1)}ms`);
  if (!response.ok) throw new Error(`Failed to load ${filename}`);

  const contentLength = Number(response.headers.get('Content-Length') || 0);
  console.debug(`[fetchWithProgress] Content-Length: ${contentLength}, has body stream: ${!!response.body}`);
  if (!contentLength || !response.body) {
    console.debug('[fetchWithProgress] No Content-Length or no body stream, falling back to blob download');
    progress.update(50, `Downloading ${filename}…`);
    const blob = await response.blob();
    console.debug(`[fetchWithProgress] Blob downloaded: ${blob.size} bytes, starting decompression...`);
    return decompressIfGzipped(blob);
  }

  const reader = response.body.getReader();
  let received = 0;

  // Stream chunks directly into a Blob to avoid keeping both
  // the chunks array and a merged Uint8Array in memory simultaneously.
  console.debug('[fetchWithProgress] Starting streaming download...');
  const streamStart = performance.now();
  const chunks: Uint8Array[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    const pct = Math.round((received / contentLength) * 60);
    progress.update(pct, `Downloading ${filename}…`);
  }
  console.debug(`[fetchWithProgress] Stream download complete: ${received} bytes in ${chunks.length} chunks, took ${(performance.now() - streamStart).toFixed(1)}ms`);

  // Build blob directly from chunks — avoids the intermediate merged Uint8Array
  console.debug('[fetchWithProgress] Building blob from chunks...');
  const blob = new Blob(chunks as BlobPart[]);
  // Release chunk references immediately
  chunks.length = 0;
  console.debug(`[fetchWithProgress] Blob built: ${blob.size} bytes, starting decompression...`);
  return decompressIfGzipped(blob);
}

async function decompressIfGzipped(blob: Blob): Promise<string> {
  // Check for gzip magic bytes (1f 8b) to detect if the data is still compressed.
  // Servers may set Content-Encoding: gzip, causing the browser to decompress
  // transparently, so we cannot rely on the filename extension alone.
  console.debug(`[decompress] Checking gzip magic bytes for blob of size ${blob.size}...`);
  const header = new Uint8Array(await blob.slice(0, 2).arrayBuffer());
  if (header[0] === 0x1f && header[1] === 0x8b) {
    console.debug('[decompress] Gzip detected, starting DecompressionStream...');
    const decompressStart = performance.now();
    const ds = new DecompressionStream('gzip');
    console.debug('[decompress] DecompressionStream created, piping blob stream...');
    const decompressedStream = blob.stream().pipeThrough(ds);
    console.debug('[decompress] Stream piped, awaiting decompressed blob...');
    const decompressedBlob = await new Response(decompressedStream).blob();
    console.debug(`[decompress] Decompressed blob: ${decompressedBlob.size} bytes, took ${(performance.now() - decompressStart).toFixed(1)}ms`);
    console.debug('[decompress] Converting decompressed blob to text...');
    const textStart = performance.now();
    const text = await decompressedBlob.text();
    console.debug(`[decompress] Text conversion done: ${text.length} chars, took ${(performance.now() - textStart).toFixed(1)}ms`);
    return text;
  }
  console.debug('[decompress] Not gzip, converting blob to text directly...');
  const textStart = performance.now();
  const text = await blob.text();
  console.debug(`[decompress] Text conversion done: ${text.length} chars, took ${(performance.now() - textStart).toFixed(1)}ms`);
  return text;
}

async function loadMap(filename: string): Promise<void> {
  console.debug(`[loadMap] ========== Loading map: ${filename} ==========`);
  const loadMapStart = performance.now();
  const progress = new ProgressBar();
  progress.show();
  progress.update(0, `Downloading ${filename}…`);

  try {
    console.debug('[loadMap] Starting fetchWithProgress...');
    let xmlText: string | null = await fetchWithProgress(`/maps/${filename}`, progress, filename);
    console.debug(`[loadMap] fetchWithProgress complete: ${xmlText?.length ?? 0} chars, elapsed ${(performance.now() - loadMapStart).toFixed(1)}ms`);

    // Let the UI repaint before the heavy synchronous parse
    progress.update(60, 'Parsing map data…');
    console.debug('[loadMap] Waiting for UI repaint before parsing...');
    await new Promise((resolve) => requestAnimationFrame(resolve));
    console.debug('[loadMap] UI repaint done, starting parseOSM...');

    const parseStart = performance.now();
    graph = parseOSM(xmlText);
    console.debug(`[loadMap] parseOSM complete: ${graph.nodes.size} nodes, ${graph.adjacency.size} adjacency entries, ${graph.restrictions.length} restrictions, took ${(performance.now() - parseStart).toFixed(1)}ms`);
    // Release the XML string as soon as parsing is complete to free memory
    xmlText = null;
    origin = null;
    destination = null;
    clickState = 'origin';

    progress.update(85, 'Rendering roads…');
    console.debug('[loadMap] Waiting for UI repaint before rendering...');
    await new Promise((resolve) => requestAnimationFrame(resolve));
    console.debug('[loadMap] UI repaint done, starting road rendering...');

    const renderStart = performance.now();
    animator.reset();
    renderer.clearMarkers();
    renderer.drawRoads(graph);
    console.debug(`[loadMap] drawRoads complete, took ${(performance.now() - renderStart).toFixed(1)}ms`);

    console.debug('[loadMap] Computing bounds...');
    const bounds = renderer.getBounds(graph);
    if (bounds) {
      console.debug('[loadMap] Fitting map to bounds...');
      mapView.fitBounds(bounds);
    }

    progress.update(100, 'Done');
    console.debug(`[loadMap] ========== Map loaded successfully: ${graph.nodes.size} nodes, total ${(performance.now() - loadMapStart).toFixed(1)}ms ==========`);
    showToast(`Loaded ${filename}: ${graph.nodes.size} nodes`);
  } catch (err) {
    console.error(`[loadMap] Error loading map:`, err);
    showToast(`Error: ${err instanceof Error ? err.message : 'Unknown error'}`);
  } finally {
    progress.hide();
  }
}

// ── Map Click Handling ──
function handleMapClick(lat: number, lon: number): void {
  console.debug(`[handleMapClick] Click at lat=${lat.toFixed(6)}, lon=${lon.toFixed(6)}, state=${clickState}`);
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

  console.debug(`[calculateRoute] Starting route calculation: origin=${origin.nodeId}, destination=${destination.nodeId}, mode=${currentMode}, ignoreRestrictions=${ignoreRestrictions}`);
  const routeStart = performance.now();
  animator.reset();
  routeInfoPanel.hide();

  if (origin.nodeId === destination.nodeId) {
    showToast('Origin and destination are the same point');
    return;
  }

  console.debug('[calculateRoute] Running A* algorithm...');
  const astarStart = performance.now();
  const { steps, finalPath } = runAStarToCompletion(
    graph,
    origin.nodeId,
    destination.nodeId,
    currentMode,
    { ignoreRestrictions },
  );
  console.debug(`[calculateRoute] A* complete: ${steps.length} steps, path=${finalPath ? finalPath.length + ' edges' : 'null'}, took ${(performance.now() - astarStart).toFixed(1)}ms`);

  if (!finalPath) {
    showToast('No route found');
    return;
  }

  // Trim first/last edge geometry so the route starts/ends at the actual snap points
  console.debug('[calculateRoute] Trimming route to snap points...');
  const trimmed = trimRouteToSnapPoints(finalPath, origin, destination);

  const totalTimeMin = steps
    .filter((s) => s.type === 'done')
    .map((s) => (s as { totalTime: number }).totalTime / 60)
    [0] ?? 0;

  const totalDistanceKm = finalPath.reduce((sum, edge) => sum + edge.distance, 0) / 1000;

  routeInfoPanel.show();

  animator.loadSteps(steps, trimmed.edges);
  console.debug(`[calculateRoute] Starting animation, total calc time: ${(performance.now() - routeStart).toFixed(1)}ms`);
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
