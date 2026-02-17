import { readdirSync, writeFileSync } from 'fs';
import { join } from 'path';

const mapsDir = join(import.meta.dirname, '..', 'public', 'maps');
const files = readdirSync(mapsDir).filter((f) => f.endsWith('.osm.gz')).sort();
const outPath = join(mapsDir, 'index.json');

writeFileSync(outPath, JSON.stringify(files, null, 2) + '\n');
console.log(`Wrote ${outPath}: ${JSON.stringify(files)}`);
