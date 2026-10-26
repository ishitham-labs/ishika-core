#!/usr/bin/env node
import { execSync } from 'child_process';
import { globSync } from 'fs';

const testFiles = globSync('{packages,apps}/**/*.test.ts');

if (testFiles.length === 0) {
  console.log('No test files found.');
  process.exit(0);
}

let failed = false;

for (const file of testFiles) {
  console.log(`\n\x1b[1m\x1b[36m🧪 Running ${file}\x1b[0m`);
  try {
    execSync(`npx esbuild "${file}" --bundle --platform=node | node -`, { stdio: 'inherit' });
  } catch (err) {
    failed = true;
    console.error(`\x1b[31m✗ Test failed: ${file}\x1b[0m`);
  }
}

if (failed) {
  process.exit(1);
} else {
  console.log('\n\x1b[32m✓ All test suites passed successfully!\x1b[0m');
}
