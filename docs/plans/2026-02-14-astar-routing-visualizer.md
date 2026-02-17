# A* Routing Visualizer Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a TypeScript browser app that parses OSM files, renders maps, and animates A* pathfinding across car/bicycle/pedestrian routing modes.

**Architecture:** Vite+TypeScript app with Leaflet for map rendering. OSM XML parsed client-side into a graph. Generator-based A* runs to completion, then replays exploration steps as animation. Floating draggable settings panel with dark/light themes.

**Tech Stack:** Vite, TypeScript, Leaflet, Vitest (for unit tests on pure logic)

---

### Task 1: Project Scaffolding

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vite.config.ts`
- Create: `index.html`
- Create: `src/main.ts`
- Create: `src/style.css`
- Create: `public/maps/index.json`
- Create: `scripts/generate-map-index.ts`

**Step 1: Initialize project with Vite + TypeScript + Leaflet + Vitest**

```bash
npm init -y
npm install leaflet
npm install -D typescript vite vitest @types/leaflet
```

**Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "preserve",
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "types": ["leaflet"]
  },
  "include": ["src"]
}
```

**Step 3: Create `vite.config.ts`**

```typescript
import { defineConfig } from 'vite';

export default defineConfig({
  server: { open: true },
  test: { environment: 'node' }
});
```

**Step 4: Create `index.html`**

```html
<!DOCTYPE html>
<html lang="en" data-theme="light">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>A* Routing Visualizer</title>
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
  <link rel="stylesheet" href="/src/style.css" />
</head>
<body>
  <div id="map"></div>
  <div id="settings-panel"></div>
  <script type="module" src="/src/main.ts"></script>
</body>
</html>
```

**Step 5: Create minimal `src/style.css`**

Minimal reset + full-screen map styling, CSS custom properties for theme, floating panel base styles.

**Step 6: Create `src/main.ts`**

```typescript
import './style.css';
console.log('A* Routing Visualizer loaded');
```

**Step 7: Create `public/maps/index.json`**

```json
["amsterdam.osm", "leiden.osm"]
```

**Step 8: Create `scripts/generate-map-index.ts`**

Script that scans `public/maps/` for `.osm` files and writes `public/maps/index.json`.

**Step 9: Verify**

```bash
npx vite --open
```

Expected: Browser opens, console shows "A* Routing Visualizer loaded", blank page with no errors.

**Step 10: Commit**

```bash
git add -A
git commit -m "feat: project scaffolding with Vite + TypeScript + Leaflet"
```

---

### Task 2: Graph Types & Road Type Configuration

**Files:**
- Create: `src/osm/graph.ts`
- Create: `src/routing/road-types.ts`
- Create: `src/routing/road-types.test.ts`

**Step 1: Write `src/osm/graph.ts`**

Define all core types:

```typescript
export type RoutingMode = 'car' | 'bicycle' | 'pedestrian';

export interface GraphNode {
  id: number;
  lat: number;
  lon: number;
}

export interface GraphEdge {
  from: number;
  to: number;
  wayId: number;
  highway: string;
  maxspeed: number;
  oneway: boolean;
  onewayBicycle: boolean;
  distance: number;
  geometry: [number, number][];
}

export interface TurnRestriction {
  fromWayId: number;
  viaNodeId: number;
  toWayId: number;
  type: string; // 'no_left_turn', 'no_right_turn', 'no_u_turn', 'no_straight_on', etc.
}

export interface RoutingGraph {
  nodes: Map<number, GraphNode>;
  adjacency: Map<number, GraphEdge[]>;
  restrictions: TurnRestriction[];
}
```

**Step 2: Write `src/routing/road-types.ts`**

Road access rules, default speeds, edge accessibility check, travel speed per mode:

```typescript
import { GraphEdge, RoutingMode } from '../osm/graph';

const ROAD_ACCESS: Record<string, Record<RoutingMode, boolean>> = {
  motorway:      { car: true,  bicycle: false, pedestrian: false },
  trunk:         { car: true,  bicycle: false, pedestrian: false },
  primary:       { car: true,  bicycle: true,  pedestrian: true },
  secondary:     { car: true,  bicycle: true,  pedestrian: true },
  tertiary:      { car: true,  bicycle: true,  pedestrian: true },
  residential:   { car: true,  bicycle: true,  pedestrian: true },
  unclassified:  { car: true,  bicycle: true,  pedestrian: true },
  service:       { car: true,  bicycle: true,  pedestrian: true },
  living_street: { car: true,  bicycle: true,  pedestrian: true },
  cycleway:      { car: false, bicycle: true,  pedestrian: true },
  footway:       { car: false, bicycle: false, pedestrian: true },
  pedestrian:    { car: false, bicycle: false, pedestrian: true },
  path:          { car: false, bicycle: false, pedestrian: true },
  steps:         { car: false, bicycle: false, pedestrian: true },
  busway:        { car: false, bicycle: false, pedestrian: false },
};

const DEFAULT_SPEEDS: Record<string, number> = {
  motorway: 100, trunk: 80, primary: 50, secondary: 50,
  tertiary: 30, residential: 30, service: 15, unclassified: 30,
  living_street: 15, cycleway: 20, footway: 5, pedestrian: 5,
  path: 5, steps: 3, busway: 50,
};

export function isEdgeAccessible(edge: GraphEdge, mode: RoutingMode): boolean { ... }
export function canTraverseDirection(edge: GraphEdge, fromNodeId: number, mode: RoutingMode): boolean { ... }
export function getTravelSpeed(edge: GraphEdge, mode: RoutingMode): number { ... }
export function getTravelTime(edge: GraphEdge, mode: RoutingMode): number { ... }
```

`canTraverseDirection` checks oneway: cars respect it, bicycles check onewayBicycle, pedestrians ignore.

**Step 3: Write failing tests in `src/routing/road-types.test.ts`**

```typescript
import { describe, it, expect } from 'vitest';
import { isEdgeAccessible, canTraverseDirection, getTravelSpeed, getTravelTime } from './road-types';

describe('isEdgeAccessible', () => {
  it('allows car on residential', () => { ... });
  it('blocks car on footway', () => { ... });
  it('allows bicycle on cycleway', () => { ... });
  it('blocks bicycle on footway', () => { ... });
  it('allows pedestrian on footway', () => { ... });
  it('blocks all on busway', () => { ... });
  it('returns false for unknown highway type', () => { ... });
});

describe('canTraverseDirection', () => {
  it('blocks car going wrong way on oneway', () => { ... });
  it('allows bicycle wrong way when onewayBicycle is false', () => { ... });
  it('allows pedestrian on oneway in either direction', () => { ... });
});

describe('getTravelSpeed', () => {
  it('returns 20 for bicycle regardless of road', () => { ... });
  it('returns 5 for pedestrian regardless of road', () => { ... });
  it('returns maxspeed for car when set', () => { ... });
  it('returns default speed for car when maxspeed is 0', () => { ... });
});

describe('getTravelTime', () => {
  it('computes time = distance / speed in seconds', () => { ... });
});
```

**Step 4: Run tests, verify they fail**

```bash
npx vitest run src/routing/road-types.test.ts
```

**Step 5: Implement the functions to pass all tests**

**Step 6: Run tests, verify they pass**

```bash
npx vitest run src/routing/road-types.test.ts
```

**Step 7: Commit**

```bash
git add -A
git commit -m "feat: graph types and road type configuration with tests"
```

---

### Task 3: OSM Parser

**Files:**
- Create: `src/osm/parser.ts`
- Create: `src/osm/parser.test.ts`

**Step 1: Write `src/osm/parser.ts`**

Parse OSM XML string into a `RoutingGraph`:

```typescript
import { RoutingGraph, GraphNode, GraphEdge, TurnRestriction } from './graph';

export function parseOSM(xmlString: string): RoutingGraph { ... }
```

Logic:
1. Use `DOMParser` to parse XML (for tests, use a minimal XML string; for browser, it's native)
2. Extract all `<node>` elements → `Map<id, GraphNode>`
3. Extract all `<way>` elements with a `highway` tag:
   - Get ordered `<nd>` refs
   - Get highway type, oneway, oneway:bicycle, maxspeed tags
   - For each consecutive pair of nd refs, create a `GraphEdge`
   - Compute Haversine distance between node pairs
   - Store geometry as array of [lat, lon]
4. Extract `<relation>` elements with `type=restriction`:
   - Get from (way), via (node), to (way) members
   - Get restriction type from tag
5. Build adjacency list: for each edge, add to `adjacency[from]`; if not oneway, also add reverse edge to `adjacency[to]`
6. Prune nodes not referenced by any way

**Step 2: Write helper `haversine(lat1, lon1, lat2, lon2): number` in meters**

**Step 3: Write tests in `src/osm/parser.test.ts`**

Test with minimal inline OSM XML strings:

```typescript
describe('parseOSM', () => {
  it('parses nodes', () => { ... });
  it('parses a simple way into edges', () => { ... });
  it('creates bidirectional edges for non-oneway roads', () => { ... });
  it('creates unidirectional edges for oneway roads', () => { ... });
  it('parses maxspeed tag', () => { ... });
  it('parses oneway:bicycle tag', () => { ... });
  it('parses turn restrictions', () => { ... });
  it('computes haversine distance', () => { ... });
  it('ignores ways without highway tag', () => { ... });
});
```

Note: Since `DOMParser` is not available in Node, use `jsdom` or a simple XML parser for tests. Add `jsdom` as dev dependency if needed, or set vitest environment to `jsdom`.

**Step 4: Run tests, verify they fail**

**Step 5: Implement parser**

**Step 6: Run tests, verify they pass**

**Step 7: Commit**

```bash
git add -A
git commit -m "feat: OSM XML parser with graph construction"
```

---

### Task 4: Map Matching (Snap to Road)

**Files:**
- Create: `src/routing/map-matching.ts`
- Create: `src/routing/map-matching.test.ts`

**Step 1: Write `src/routing/map-matching.ts`**

```typescript
import { RoutingGraph, GraphEdge, GraphNode, RoutingMode } from '../osm/graph';
import { isEdgeAccessible } from './road-types';

export interface SnapResult {
  nodeId: number;       // nearest graph node to the snapped point
  lat: number;          // snapped point lat
  lon: number;          // snapped point lon
  edge: GraphEdge;      // the edge snapped to
  distanceToSnap: number; // meters from click to snap point
}

export function snapToRoad(
  lat: number, lon: number,
  graph: RoutingGraph, mode: RoutingMode
): SnapResult | null { ... }
```

Logic:
- Iterate all edges accessible for the mode
- For each edge geometry segment, find perpendicular projection of click point
- Clamp to segment endpoints
- Track minimum distance
- Return the nearest graph node (from or to) to the projected point
- Return null if no accessible edge found

**Step 2: Write helper `projectPointOnSegment(px, py, ax, ay, bx, by): {x, y, t}`**

Where t is the parameter [0,1] along segment A→B.

**Step 3: Write tests**

```typescript
describe('snapToRoad', () => {
  it('snaps to nearest accessible road', () => { ... });
  it('returns null when no accessible roads exist', () => { ... });
  it('snaps to segment endpoint when projection is outside', () => { ... });
  it('respects routing mode access rules', () => { ... });
});

describe('projectPointOnSegment', () => {
  it('projects point onto middle of segment', () => { ... });
  it('clamps to start when before segment', () => { ... });
  it('clamps to end when past segment', () => { ... });
});
```

**Step 4: TDD cycle — fail, implement, pass**

**Step 5: Commit**

```bash
git add -A
git commit -m "feat: map matching - snap click to nearest road"
```

---

### Task 5: A* Routing Engine

**Files:**
- Create: `src/routing/a-star.ts`
- Create: `src/routing/a-star.test.ts`

**Step 1: Write `src/routing/a-star.ts`**

```typescript
import { RoutingGraph, GraphEdge, RoutingMode } from '../osm/graph';
import { isEdgeAccessible, canTraverseDirection, getTravelTime } from './road-types';

export interface AStarExploreStep {
  type: 'explore';
  edge: GraphEdge;
  fromNodeId: number;
  toNodeId: number;
}

export interface AStarDoneStep {
  type: 'done';
  path: GraphEdge[];
  pathNodeIds: number[];
  totalTime: number;
}

export interface AStarNoRouteStep {
  type: 'no-route';
}

export type AStarStep = AStarExploreStep | AStarDoneStep | AStarNoRouteStep;

export function* aStarRoute(
  graph: RoutingGraph,
  startNodeId: number,
  endNodeId: number,
  mode: RoutingMode
): Generator<AStarStep> { ... }
```

Implementation:
- Priority queue (min-heap by fScore) — implement a simple binary heap
- gScore map, cameFrom map (storing {nodeId, edge, prevWayId} for turn restriction tracking)
- Heuristic: haversine(current, end) / maxSpeedForMode (admissible)
- On each node expansion, yield `{ type: 'explore', edge }` for each neighbor examined
- When expanding neighbors: check `isEdgeAccessible`, `canTraverseDirection`, and turn restrictions (cars only)
- Turn restriction check: look up `fromWayId-viaNodeId` in restriction map, check if toWayId is forbidden
- When goal reached: reconstruct path, yield `{ type: 'done', path, pathNodeIds, totalTime }`
- When queue empty: yield `{ type: 'no-route' }`

**Step 2: Write `src/routing/a-star.test.ts`**

```typescript
describe('aStarRoute', () => {
  it('finds shortest path on simple 3-node graph', () => { ... });
  it('finds fastest route preferring higher speed roads', () => { ... });
  it('respects oneway restrictions for car', () => { ... });
  it('ignores oneway for pedestrian', () => { ... });
  it('yields explore steps for each examined edge', () => { ... });
  it('yields no-route when destination unreachable', () => { ... });
  it('respects turn restrictions for car', () => { ... });
  it('ignores turn restrictions for bicycle', () => { ... });
  it('yields done with correct path', () => { ... });
});
```

Build small test graphs manually (3-5 nodes) for each test case.

**Step 3: TDD cycle — fail, implement, pass**

**Step 4: Commit**

```bash
git add -A
git commit -m "feat: A* routing engine with generator-based step yielding"
```

---

### Task 6: Theme System & CSS

**Files:**
- Modify: `src/style.css` (expand with full theme + panel + map styles)
- Create: `src/ui/theme.ts`

**Step 1: Write complete `src/style.css`**

CSS custom properties for light/dark themes:
- `--bg-panel`, `--text-color`, `--border-color`, `--road-color`, `--accent`
- Light theme defaults, `[data-theme="dark"]` overrides
- Full-screen map, floating panel styles, slider, toggle buttons, dropdown
- Panel: semi-transparent background, border-radius, box-shadow, backdrop-filter blur
- Draggable header with cursor:move

**Step 2: Write `src/ui/theme.ts`**

```typescript
export type Theme = 'light' | 'dark';

export function initTheme(): Theme { ... }
export function setTheme(theme: Theme): void { ... }
export function toggleTheme(): Theme { ... }
```

Read/write `data-theme` attribute on `<html>`. Persist to localStorage.

**Step 3: Verify visually**

```bash
npx vite
```

Open browser, check that both themes render correctly, panel looks right.

**Step 4: Commit**

```bash
git add -A
git commit -m "feat: theme system with dark/light mode"
```

---

### Task 7: Map View (Leaflet Setup)

**Files:**
- Create: `src/map/map-view.ts`

**Step 1: Write `src/map/map-view.ts`**

```typescript
import L from 'leaflet';

export class MapView {
  private map: L.Map;
  private tileLayer: L.TileLayer;
  private roadsPane: HTMLElement;
  private exploredPane: HTMLElement;
  private routePane: HTMLElement;
  private markersPane: HTMLElement;

  constructor(containerId: string) { ... }

  fitBounds(bounds: L.LatLngBoundsExpression): void { ... }
  setTileLayerVisible(visible: boolean): void { ... }
  getMap(): L.Map { ... }
  onClick(handler: (lat: number, lon: number) => void): void { ... }
}
```

Setup:
- Create Leaflet map in container
- Add OSM tile layer at 50% opacity
- Create custom panes: roads (z:400), explored (z:450), route (z:500), markers (z:600)
- Expose click handler registration

**Step 2: Wire into `src/main.ts`** — just instantiate MapView, verify map shows

**Step 3: Verify visually** — map renders with tile layer

**Step 4: Commit**

```bash
git add -A
git commit -m "feat: Leaflet map view with custom panes"
```

---

### Task 8: Map Renderer (Drawing Roads, Routes, Markers)

**Files:**
- Create: `src/map/map-renderer.ts`

**Step 1: Write `src/map/map-renderer.ts`**

```typescript
import L from 'leaflet';
import { RoutingGraph, GraphEdge, GraphNode } from '../osm/graph';
import { MapView } from './map-view';

export class MapRenderer {
  private roadLayers: L.Polyline[];
  private exploredLayers: L.Polyline[];
  private routeLayer: L.Polyline | null;
  private originMarker: L.CircleMarker | null;
  private destMarker: L.CircleMarker | null;

  constructor(private mapView: MapView) { ... }

  drawRoads(graph: RoutingGraph): void { ... }
  clearRoads(): void { ... }
  addExploredEdge(edge: GraphEdge, graph: RoutingGraph): void { ... }
  addRouteEdge(edge: GraphEdge, graph: RoutingGraph): void { ... }
  clearAnimation(): void { ... }
  setOriginMarker(lat: number, lon: number): void { ... }
  setDestinationMarker(lat: number, lon: number): void { ... }
  clearMarkers(): void { ... }
}
```

- Roads: thin gray lines in roads pane (use theme CSS variable for color via getComputedStyle)
- Explored: blue lines in explored pane, weight 2
- Route: thick red lines in route pane, weight 5
- Origin: green circle marker, Destination: red circle marker

**Step 2: Verify visually** with test data

**Step 3: Commit**

```bash
git add -A
git commit -m "feat: map renderer for roads, routes, and markers"
```

---

### Task 9: Animation Controller

**Files:**
- Create: `src/animation/animator.ts`

**Step 1: Write `src/animation/animator.ts`**

```typescript
import { AStarStep, AStarExploreStep, AStarDoneStep } from '../routing/a-star';
import { GraphEdge } from '../osm/graph';
import { MapRenderer } from '../map/map-renderer';

export class Animator {
  private steps: AStarStep[];
  private pathEdgeSet: Set<string>;  // "from-to" keys for quick lookup
  private currentIndex: number;
  private animationId: number | null;
  private speed: number;  // 1-10

  constructor(private renderer: MapRenderer) { ... }

  loadSteps(steps: AStarStep[], finalPath: GraphEdge[]): void { ... }
  setSpeed(speed: number): void { ... }
  start(): void { ... }
  stop(): void { ... }
  reset(): void { ... }
  isRunning(): boolean { ... }
}
```

Logic:
- `loadSteps`: store all steps, build a Set of edge keys that are in the final path
- `start`: begin animation loop using `requestAnimationFrame`
- Per frame: process N steps based on speed setting
  - Speed 1: 1 step every 200ms
  - Speed 10: process 50+ steps per frame
- For each explore step: call `renderer.addExploredEdge()`
- If the explored edge is in the final path set: also call `renderer.addRouteEdge()`
- When all steps processed or `done` step reached: stop

**Step 2: Commit**

```bash
git add -A
git commit -m "feat: animation controller for A* step replay"
```

---

### Task 10: Settings Panel UI

**Files:**
- Create: `src/ui/settings-panel.ts`
- Create: `src/ui/file-browser.ts`

**Step 1: Write `src/ui/file-browser.ts`**

```typescript
export async function loadMapFileList(): Promise<string[]> {
  const res = await fetch('/maps/index.json');
  return res.json();
}
```

**Step 2: Write `src/ui/settings-panel.ts`**

```typescript
import { RoutingMode } from '../osm/graph';
import { Theme } from './theme';

export interface SettingsCallbacks {
  onMapFileSelect: (filename: string) => void;
  onRoutingModeChange: (mode: RoutingMode) => void;
  onSpeedChange: (speed: number) => void;
  onTilesToggle: (visible: boolean) => void;
  onThemeToggle: () => void;
}

export class SettingsPanel {
  private container: HTMLElement;
  private isDragging: boolean;

  constructor(parentId: string, callbacks: SettingsCallbacks) { ... }

  async init(): Promise<void> { ... }
  setMapFiles(files: string[]): void { ... }
  setActiveMode(mode: RoutingMode): void { ... }
  setSpeed(speed: number): void { ... }
}
```

Build DOM programmatically:
- Header bar ("⚙ Settings") with drag handle
- File dropdown
- Three routing mode toggle buttons with emoji icons
- Speed slider with label showing current value
- Tiles toggle checkbox
- Theme toggle button
- Make panel draggable: mousedown on header → track mousemove → update transform/position

**Step 3: Verify visually** — panel renders, is draggable, controls work

**Step 4: Commit**

```bash
git add -A
git commit -m "feat: floating draggable settings panel"
```

---

### Task 11: Wire Everything Together in main.ts

**Files:**
- Modify: `src/main.ts`

**Step 1: Write the main application controller in `src/main.ts`**

```typescript
import { MapView } from './map/map-view';
import { MapRenderer } from './map/map-renderer';
import { parseOSM } from './osm/parser';
import { snapToRoad, SnapResult } from './routing/map-matching';
import { aStarRoute, AStarStep } from './routing/a-star';
import { Animator } from './animation/animator';
import { SettingsPanel } from './ui/settings-panel';
import { initTheme, toggleTheme } from './ui/theme';
import { loadMapFileList } from './ui/file-browser';
import { RoutingGraph, RoutingMode } from './osm/graph';

// Application state
let graph: RoutingGraph | null;
let origin: SnapResult | null;
let destination: SnapResult | null;
let currentMode: RoutingMode = 'car';
let animator: Animator;
// ... etc
```

Wire all callbacks:
1. **Map file select** → fetch OSM file, parse, draw roads, fit bounds, clear route
2. **Map click** → snap to road, set origin (1st click) or destination (2nd click), run routing
3. **Routing mode change** → re-snap origin/dest, re-route
4. **Route calculation** → run A* generator to completion, collect steps, load into animator, start animation
5. **Speed change** → update animator speed
6. **Tiles toggle** → show/hide tile layer
7. **Theme toggle** → toggle theme

**Step 2: Verify end-to-end** — load Amsterdam map, click two points, see animation

**Step 3: Commit**

```bash
git add -A
git commit -m "feat: wire all components together in main controller"
```

---

### Task 12: Polish & Edge Cases

**Files:**
- Modify: various files for polish

**Step 1: Handle edge cases**
- Show "No route found" message when A* returns no-route
- Show loading indicator while parsing large OSM file (Leiden)
- Disable map clicks during animation
- Reset animation when clicking new origin
- Handle clicking same point for origin and destination

**Step 2: Visual polish**
- Ensure road colors adapt to theme
- Ensure panel is responsive and doesn't overflow on small screens
- Add cursor feedback (crosshair on map, pointer on panel)
- Speed slider label shows descriptive text ("Slow" / "Fast")

**Step 3: Final verification with both maps and all three modes**

**Step 4: Commit**

```bash
git add -A
git commit -m "feat: polish, edge cases, and final verification"
```

---

## Summary

| Task | Description | Key files |
|------|-------------|-----------|
| 1 | Project scaffolding | package.json, tsconfig.json, vite.config.ts, index.html |
| 2 | Graph types & road config | graph.ts, road-types.ts + tests |
| 3 | OSM parser | parser.ts + tests |
| 4 | Map matching | map-matching.ts + tests |
| 5 | A* engine | a-star.ts + tests |
| 6 | Theme system | style.css, theme.ts |
| 7 | Map view (Leaflet) | map-view.ts |
| 8 | Map renderer | map-renderer.ts |
| 9 | Animation controller | animator.ts |
| 10 | Settings panel | settings-panel.ts, file-browser.ts |
| 11 | Wire together | main.ts |
| 12 | Polish & edge cases | various |
