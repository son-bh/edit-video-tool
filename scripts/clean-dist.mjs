import fs from 'node:fs';
import path from 'node:path';

const distRoot = path.join(process.cwd(), 'dist');

fs.rmSync(distRoot, { recursive: true, force: true });
