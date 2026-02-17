export async function loadMapFileList(): Promise<string[]> {
  const res = await fetch('/maps/index.json');
  if (!res.ok) return [];
  return res.json();
}
