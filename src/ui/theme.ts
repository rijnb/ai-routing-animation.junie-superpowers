export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'astar-theme';

export function initTheme(): Theme {
  const stored = localStorage.getItem(STORAGE_KEY);
  const theme: Theme = stored === 'dark' ? 'dark' : 'light';
  applyTheme(theme);
  return theme;
}

export function setTheme(theme: Theme): void {
  applyTheme(theme);
  localStorage.setItem(STORAGE_KEY, theme);
}

export function toggleTheme(): Theme {
  const current = document.documentElement.getAttribute('data-theme') as Theme;
  const next: Theme = current === 'dark' ? 'light' : 'dark';
  setTheme(next);
  return next;
}

function applyTheme(theme: Theme): void {
  document.documentElement.setAttribute('data-theme', theme);
}
