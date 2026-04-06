const fs = require('fs');
const path = require('path');

const targetPath = path.join(__dirname, '..', 'node_modules', 'xlsx', 'types', 'tsconfig.json');

function main() {
  if (!fs.existsSync(targetPath)) {
    console.log('[fix-xlsx-tsconfig] Skipped: xlsx tsconfig not found.');
    return;
  }

  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(targetPath, 'utf8'));
  } catch (error) {
    console.warn('[fix-xlsx-tsconfig] Skipped: failed to parse tsconfig.', error.message);
    return;
  }

  if (!parsed || typeof parsed !== 'object') {
    console.warn('[fix-xlsx-tsconfig] Skipped: invalid tsconfig payload.');
    return;
  }

  if (!parsed.compilerOptions || typeof parsed.compilerOptions !== 'object') {
    parsed.compilerOptions = {};
  }

  let changed = false;

  if (Object.prototype.hasOwnProperty.call(parsed.compilerOptions, 'baseUrl')) {
    delete parsed.compilerOptions.baseUrl;
    changed = true;
  }

  if (Object.prototype.hasOwnProperty.call(parsed.compilerOptions, 'paths')) {
    delete parsed.compilerOptions.paths;
    changed = true;
  }

  if (parsed.compilerOptions.ignoreDeprecations !== '6.0') {
    parsed.compilerOptions.ignoreDeprecations = '6.0';
    changed = true;
  }

  if (!changed) {
    console.log('[fix-xlsx-tsconfig] Already patched.');
    return;
  }

  fs.writeFileSync(targetPath, `${JSON.stringify(parsed, null, 4)}\n`, 'utf8');
  console.log('[fix-xlsx-tsconfig] Removed deprecated baseUrl/paths and added ignoreDeprecations=6.0');
}

main();