import fs from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const distRoot = path.join(repoRoot, 'dist');

function copyDirectory(sourceDir, targetDir) {
  fs.mkdirSync(targetDir, { recursive: true });

  for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
    const sourcePath = path.join(sourceDir, entry.name);
    const targetPath = path.join(targetDir, entry.name);

    if (entry.isDirectory()) {
      copyDirectory(sourcePath, targetPath);
      continue;
    }

    if (entry.name.endsWith('.ts')) {
      continue;
    }

    if (entry.name.endsWith('.js') && fs.existsSync(path.join(sourceDir, entry.name.replace(/\.js$/u, '.ts')))) {
      continue;
    }

    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.copyFileSync(sourcePath, targetPath);
  }
}

copyDirectory(path.join(repoRoot, 'views'), path.join(distRoot, 'views'));
copyDirectory(path.join(repoRoot, 'public'), path.join(distRoot, 'public'));
