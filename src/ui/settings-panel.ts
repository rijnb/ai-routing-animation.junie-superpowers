import { RoutingMode } from '../osm/graph';
import { loadMapFileList } from './file-browser';

export interface SettingsCallbacks {
  onMapFileSelect: (filename: string) => void;
  onRoutingModeChange: (mode: RoutingMode) => void;
  onSpeedChange: (speed: number) => void;
  onTilesToggle: (visible: boolean) => void;
  onThemeToggle: () => void;
  onIgnoreRestrictionsToggle: (ignore: boolean) => void;
}

export class SettingsPanel {
  private container: HTMLElement;
  private mapSelect!: HTMLSelectElement;
  private modeButtons!: Map<RoutingMode, HTMLButtonElement>;
  private speedSlider!: HTMLInputElement;
  private speedLabel!: HTMLSpanElement;
  private tilesCheckbox!: HTMLInputElement;
  private ignoreRestrictionsCheckbox!: HTMLInputElement;
  private ignoreRestrictionsRow!: HTMLElement;

  // Drag state
  private isDragging = false;
  private dragOffsetX = 0;
  private dragOffsetY = 0;

  constructor(
    parentId: string,
    private callbacks: SettingsCallbacks,
  ) {
    const el = document.getElementById(parentId);
    if (!el) throw new Error(`Element #${parentId} not found`);
    this.container = el;
    this.buildUI();
    this.setupDrag();
  }

  async init(): Promise<void> {
    const files = await loadMapFileList();
    this.setMapFiles(files);
    if (files.length > 0) {
      this.callbacks.onMapFileSelect(files[0]);
    }
  }

  setMapFiles(files: string[]): void {
    this.mapSelect.innerHTML = '';
    for (const file of files) {
      const opt = document.createElement('option');
      opt.value = file;
      opt.textContent = file;
      this.mapSelect.appendChild(opt);
    }
  }

  setActiveMode(mode: RoutingMode): void {
    for (const [m, btn] of this.modeButtons) {
      btn.classList.toggle('active', m === mode);
    }
    this.updateIgnoreRestrictionsState(mode);
  }

  private updateIgnoreRestrictionsState(mode: RoutingMode): void {
    const enabled = mode === 'car';
    this.ignoreRestrictionsCheckbox.disabled = !enabled;
    this.ignoreRestrictionsRow.classList.toggle('disabled', !enabled);
    if (!enabled) {
      this.ignoreRestrictionsCheckbox.checked = false;
      this.callbacks.onIgnoreRestrictionsToggle(false);
    }
  }

  setSpeed(speed: number): void {
    this.speedSlider.value = String(speed);
    this.updateSpeedLabel(speed);
  }

  private buildUI(): void {
    // Header
    const header = document.createElement('div');
    header.className = 'panel-header';
    header.innerHTML = '<span>⚙ Settings</span>';
    this.container.appendChild(header);

    // Body
    const body = document.createElement('div');
    body.className = 'panel-body';
    this.container.appendChild(body);

    // Map file selector
    body.appendChild(this.buildControlGroup('Map', () => {
      this.mapSelect = document.createElement('select');
      this.mapSelect.addEventListener('change', () => {
        this.callbacks.onMapFileSelect(this.mapSelect.value);
      });
      return this.mapSelect;
    }));

    // Routing mode
    body.appendChild(this.buildControlGroup('Routing Mode', () => {
      const div = document.createElement('div');
      div.className = 'mode-buttons';
      this.modeButtons = new Map();

      const modes: { mode: RoutingMode; label: string }[] = [
        { mode: 'car', label: '🚗 Car' },
        { mode: 'bicycle', label: '🚲 Bike' },
        { mode: 'pedestrian', label: '🚶 Walk' },
      ];

      for (const { mode, label } of modes) {
        const btn = document.createElement('button');
        btn.className = 'mode-btn';
        btn.textContent = label;
        if (mode === 'car') btn.classList.add('active');
        btn.addEventListener('click', () => {
          this.setActiveMode(mode);
          this.callbacks.onRoutingModeChange(mode);
        });
        this.modeButtons.set(mode, btn);
        div.appendChild(btn);
      }

      return div;
    }));

    // Animation speed
    body.appendChild(this.buildControlGroup('Animation Speed', () => {
      const wrapper = document.createElement('div');
      wrapper.style.display = 'flex';
      wrapper.style.alignItems = 'center';
      wrapper.style.gap = '8px';

      this.speedSlider = document.createElement('input');
      this.speedSlider.type = 'range';
      this.speedSlider.min = '1';
      this.speedSlider.max = '10';
      this.speedSlider.value = '5';
      this.speedSlider.style.flex = '1';
      this.speedSlider.addEventListener('input', () => {
        const val = Number(this.speedSlider.value);
        this.updateSpeedLabel(val);
        this.callbacks.onSpeedChange(val);
      });

      this.speedLabel = document.createElement('span');
      this.speedLabel.style.fontSize = '12px';
      this.speedLabel.style.minWidth = '24px';
      this.updateSpeedLabel(5);

      wrapper.appendChild(this.speedSlider);
      wrapper.appendChild(this.speedLabel);
      return wrapper;
    }));

    // Ignore restrictions toggle (car only)
    this.ignoreRestrictionsRow = document.createElement('div');
    this.ignoreRestrictionsRow.className = 'toggle-row';
    const restrictionsLabel = document.createElement('label');
    restrictionsLabel.textContent = 'Ignore restrictions';
    this.ignoreRestrictionsCheckbox = document.createElement('input');
    this.ignoreRestrictionsCheckbox.type = 'checkbox';
    this.ignoreRestrictionsCheckbox.checked = false;
    this.ignoreRestrictionsCheckbox.addEventListener('change', () => {
      this.callbacks.onIgnoreRestrictionsToggle(this.ignoreRestrictionsCheckbox.checked);
    });
    this.ignoreRestrictionsRow.appendChild(restrictionsLabel);
    this.ignoreRestrictionsRow.appendChild(this.ignoreRestrictionsCheckbox);
    body.appendChild(this.ignoreRestrictionsRow);

    // Background tiles toggle
    const tilesRow = document.createElement('div');
    tilesRow.className = 'toggle-row';
    const tilesLabel = document.createElement('label');
    tilesLabel.textContent = 'Background tiles';
    this.tilesCheckbox = document.createElement('input');
    this.tilesCheckbox.type = 'checkbox';
    this.tilesCheckbox.checked = true;
    this.tilesCheckbox.addEventListener('change', () => {
      this.callbacks.onTilesToggle(this.tilesCheckbox.checked);
    });
    tilesRow.appendChild(tilesLabel);
    tilesRow.appendChild(this.tilesCheckbox);
    body.appendChild(tilesRow);

    // Theme toggle
    const themeRow = document.createElement('div');
    themeRow.className = 'toggle-row';
    const themeLabel = document.createElement('label');
    themeLabel.textContent = 'Theme';
    const themeBtn = document.createElement('button');
    themeBtn.className = 'toggle-btn';
    themeBtn.textContent = '☀️ / 🌙';
    themeBtn.addEventListener('click', () => {
      this.callbacks.onThemeToggle();
    });
    themeRow.appendChild(themeLabel);
    themeRow.appendChild(themeBtn);
    body.appendChild(themeRow);
  }

  private buildControlGroup(label: string, buildControl: () => HTMLElement): HTMLElement {
    const group = document.createElement('div');
    group.className = 'control-group';
    const lbl = document.createElement('label');
    lbl.textContent = label;
    group.appendChild(lbl);
    group.appendChild(buildControl());
    return group;
  }

  private updateSpeedLabel(speed: number): void {
    this.speedLabel.textContent = String(speed);
  }

  private setupDrag(): void {
    const header = this.container.querySelector('.panel-header') as HTMLElement;
    if (!header) return;

    header.addEventListener('mousedown', (e: MouseEvent) => {
      this.isDragging = true;
      const rect = this.container.getBoundingClientRect();
      this.dragOffsetX = e.clientX - rect.left;
      this.dragOffsetY = e.clientY - rect.top;
      e.preventDefault();
    });

    document.addEventListener('mousemove', (e: MouseEvent) => {
      if (!this.isDragging) return;
      const x = e.clientX - this.dragOffsetX;
      const y = e.clientY - this.dragOffsetY;
      this.container.style.left = `${x}px`;
      this.container.style.top = `${y}px`;
      this.container.style.right = 'auto';
    });

    document.addEventListener('mouseup', () => {
      this.isDragging = false;
    });
  }
}
