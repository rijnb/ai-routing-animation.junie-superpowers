import { AnimationStats } from '../animation/animator';

export interface RouteResult {
  totalTimeMin: number;
  totalDistanceKm: number;
  segments: number;
}

export class RouteInfoPanel {
  private container: HTMLElement;
  private statsEl: HTMLElement;
  private resultEl: HTMLElement;

  constructor() {
    this.container = document.createElement('div');
    this.container.id = 'route-info-panel';
    this.container.className = 'route-info-panel';
    this.container.style.display = 'none';

    // Legend section
    const legend = document.createElement('div');
    legend.className = 'route-legend';
    legend.innerHTML = `
      <div class="legend-title">Legend</div>
      <div class="legend-item">
        <span class="legend-line legend-line--route"></span>
        <span>Optimal route</span>
      </div>
      <div class="legend-item">
        <span class="legend-line legend-line--explored"></span>
        <span>Examined alternatives</span>
      </div>
    `;
    this.container.appendChild(legend);

    // Live stats section
    this.statsEl = document.createElement('div');
    this.statsEl.className = 'route-stats';
    this.container.appendChild(this.statsEl);

    // Final route result section
    this.resultEl = document.createElement('div');
    this.resultEl.className = 'route-result';
    this.container.appendChild(this.resultEl);

    document.body.appendChild(this.container);
  }

  show(): void {
    this.container.style.display = '';
    this.resultEl.innerHTML = '';
  }

  hide(): void {
    this.container.style.display = 'none';
  }

  updateStats(stats: AnimationStats): void {
    this.statsEl.innerHTML = `
      <div class="stats-row">
        <span class="stats-label">Edges explored</span>
        <span class="stats-value">${stats.exploredEdges.toLocaleString()}</span>
      </div>
      <div class="stats-row">
        <span class="stats-label">Route segments found</span>
        <span class="stats-value">${stats.routeEdges.toLocaleString()}</span>
      </div>
    `;
  }

  showResult(result: RouteResult): void {
    const dist = result.totalDistanceKm < 1
      ? `${Math.round(result.totalDistanceKm * 1000)} m`
      : `${result.totalDistanceKm.toFixed(1)} km`;

    const time = result.totalTimeMin < 1
      ? `${Math.round(result.totalTimeMin * 60)} sec`
      : `${Math.round(result.totalTimeMin)} min`;

    this.resultEl.innerHTML = `
      <div class="result-title">Optimal Route</div>
      <div class="stats-row">
        <span class="stats-label">Distance</span>
        <span class="stats-value">${dist}</span>
      </div>
      <div class="stats-row">
        <span class="stats-label">Travel time</span>
        <span class="stats-value">${time}</span>
      </div>
      <div class="stats-row">
        <span class="stats-label">Segments</span>
        <span class="stats-value">${result.segments}</span>
      </div>
    `;
  }
}
