import { AStarStep } from '../routing/a-star';
import { GraphEdge } from '../osm/graph';
import { MapRenderer } from '../map/map-renderer';

export interface AnimationStats {
  exploredEdges: number;
  routeEdges: number;
  totalSteps: number;
}

export class Animator {
  private steps: AStarStep[] = [];
  private pathEdgeSet = new Set<string>();
  private pathEdgeMap = new Map<string, GraphEdge>();
  private currentIndex = 0;
  private animationId: number | null = null;
  private speed = 5;
  private lastFrameTime = 0;
  private onComplete: (() => void) | null = null;
  private onProgress: ((stats: AnimationStats) => void) | null = null;
  private exploredCount = 0;
  private routeCount = 0;

  constructor(private renderer: MapRenderer) {}

  loadSteps(steps: AStarStep[], finalPath: GraphEdge[]): void {
    this.stop();
    this.renderer.clearAnimation();
    this.steps = steps;
    this.currentIndex = 0;
    this.exploredCount = 0;
    this.routeCount = 0;
    this.pathEdgeSet.clear();
    this.pathEdgeMap.clear();

    for (const edge of finalPath) {
      const key = this.edgeKey(edge);
      this.pathEdgeSet.add(key);
      this.pathEdgeMap.set(key, edge);
    }
  }

  setSpeed(speed: number): void {
    this.speed = Math.max(1, Math.min(10, speed));
  }

  getSpeed(): number {
    return this.speed;
  }

  start(onComplete?: () => void, onProgress?: (stats: AnimationStats) => void): void {
    if (this.animationId !== null) return;
    this.onComplete = onComplete ?? null;
    this.onProgress = onProgress ?? null;
    this.lastFrameTime = performance.now();
    this.emitProgress();
    this.tick();
  }

  stop(): void {
    if (this.animationId !== null) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }
  }

  reset(): void {
    this.stop();
    this.renderer.clearAnimation();
    this.currentIndex = 0;
    this.exploredCount = 0;
    this.routeCount = 0;
  }

  isRunning(): boolean {
    return this.animationId !== null;
  }

  private tick = (): void => {
    const now = performance.now();
    const elapsed = now - this.lastFrameTime;

    // Steps per frame based on speed:
    // Speed 1: ~1 step per 200ms → need 200ms between steps
    // Speed 10: process many steps per frame
    const stepsPerFrame = this.getStepsPerFrame();
    const interval = this.getInterval();

    if (elapsed < interval) {
      this.animationId = requestAnimationFrame(this.tick);
      return;
    }

    this.lastFrameTime = now;

    let processed = 0;
    while (processed < stepsPerFrame && this.currentIndex < this.steps.length) {
      const step = this.steps[this.currentIndex];
      this.currentIndex++;

      if (step.type === 'explore') {
        this.renderer.addExploredEdge(step.edge);
        this.exploredCount++;
        const edgeKey = this.edgeKey(step.edge);
        if (this.pathEdgeSet.has(edgeKey)) {
          // Use trimmed edge geometry (from finalPath) instead of the original explored edge
          const trimmedEdge = this.pathEdgeMap.get(edgeKey) ?? step.edge;
          this.renderer.addRouteEdge(trimmedEdge);
          this.routeCount++;
        }
        processed++;
      } else if (step.type === 'done' || step.type === 'no-route') {
        this.emitProgress();
        this.stop();
        this.onComplete?.();
        return;
      }
    }

    this.emitProgress();

    if (this.currentIndex >= this.steps.length) {
      this.stop();
      this.onComplete?.();
      return;
    }

    this.animationId = requestAnimationFrame(this.tick);
  };

  private emitProgress(): void {
    this.onProgress?.({
      exploredEdges: this.exploredCount,
      routeEdges: this.routeCount,
      totalSteps: this.steps.length,
    });
  }

  private getStepsPerFrame(): number {
    // Exponential scaling: speed 1 = 2, speed 10 = ~500
    if (this.speed <= 1) return 2;
    if (this.speed <= 3) return this.speed * 4;
    if (this.speed <= 6) return this.speed * 10;
    return Math.round(Math.pow(2, this.speed));
  }

  private getInterval(): number {
    // Speed 1: 100ms, Speed 2+: every frame
    if (this.speed <= 1) return 100;
    return 0; // Process every frame
  }

  private edgeKey(edge: GraphEdge): string {
    const a = Math.min(edge.from, edge.to);
    const b = Math.max(edge.from, edge.to);
    return `${edge.wayId}-${a}-${b}`;
  }
}
