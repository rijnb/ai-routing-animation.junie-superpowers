export async function loadMapFileList(): Promise<string[]> {
  console.debug('[loadMapFileList] Fetching /maps/index.json...');
  const res = await fetch('/maps/index.json');
  console.debug(`[loadMapFileList] Response: status=${res.status}, ok=${res.ok}`);
  if (!res.ok) return [];
  const files = await res.json();
  console.debug(`[loadMapFileList] Parsed ${files.length} map files`);
  return files;
}
