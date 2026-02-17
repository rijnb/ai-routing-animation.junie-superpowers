/**
 * A loading overlay with a proper progress bar that shows
 * the current phase and percentage while the map is loading.
 */
export class ProgressBar {
  private overlay: HTMLElement;
  private label: HTMLElement;
  private fill: HTMLElement;
  private percentLabel: HTMLElement;

  constructor() {
    this.overlay = document.createElement('div');
    this.overlay.className = 'loading-overlay';

    const box = document.createElement('div');
    box.className = 'progress-box';

    this.label = document.createElement('div');
    this.label.className = 'progress-label';
    this.label.textContent = 'Loading…';

    const track = document.createElement('div');
    track.className = 'progress-track';

    this.fill = document.createElement('div');
    this.fill.className = 'progress-fill';

    this.percentLabel = document.createElement('div');
    this.percentLabel.className = 'progress-percent';
    this.percentLabel.textContent = '0%';

    track.appendChild(this.fill);
    box.appendChild(this.label);
    box.appendChild(track);
    box.appendChild(this.percentLabel);
    this.overlay.appendChild(box);
  }

  show(): void {
    document.body.appendChild(this.overlay);
  }

  /** Update the progress bar (0–100) and the phase label. */
  update(percent: number, message: string): void {
    const clamped = Math.min(100, Math.max(0, percent));
    this.fill.style.width = `${clamped}%`;
    this.percentLabel.textContent = `${Math.round(clamped)}%`;
    this.label.textContent = message;
  }

  hide(): void {
    this.overlay.remove();
  }
}
