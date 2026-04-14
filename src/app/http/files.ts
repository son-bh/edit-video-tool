import fs from 'node:fs';
import path from 'node:path';

export function moveFile(sourcePath: string, targetPath: string): string {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.renameSync(sourcePath, targetPath);
  return targetPath;
}

export function unlinkIfPresent(filePath?: string | null): void {
  if (filePath && fs.existsSync(filePath)) {
    fs.rmSync(filePath, { force: true });
  }
}

export function getAssetVersion(repoRoot: string): string {
  return String(fs.statSync(path.join(repoRoot, 'public', 'app.js')).mtimeMs);
}
