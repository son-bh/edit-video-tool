const fs = require('node:fs');
const path = require('node:path');

function expandEnvValue(value) {
  return String(value).replace(/%([A-Z0-9_]+)%|\$\{([A-Z0-9_]+)\}/gi, (_, percentName, braceName) => {
    const variableName = percentName || braceName;
    return process.env[variableName] || '';
  });
}

function parseEnvFileContents(contents) {
  const parsed = {};
  const lines = contents.split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const separatorIndex = trimmed.indexOf('=');
    if (separatorIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    let value = trimmed.slice(separatorIndex + 1).trim();

    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    parsed[key] = expandEnvValue(value);
  }

  return parsed;
}

function loadEnvFile(filePath = path.resolve(process.cwd(), '.env')) {
  if (!fs.existsSync(filePath)) {
    return {};
  }

  const parsed = parseEnvFileContents(fs.readFileSync(filePath, 'utf8'));

  for (const [key, value] of Object.entries(parsed)) {
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }

  return parsed;
}

module.exports = {
  expandEnvValue,
  parseEnvFileContents,
  loadEnvFile
};
