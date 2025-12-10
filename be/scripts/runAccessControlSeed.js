#!/usr/bin/env node

const shouldSeed = true //process.env.SEED_ACCESS_CONTROL === 'true';

const log = (message) => {
  console.log(`[access-control] ${message}`);
};

if (!shouldSeed) {
  log('Skipping syncAccessControl (set SEED_ACCESS_CONTROL=true to enable).');
  process.exit(0);
}

try {
  log('Running syncAccessControl.js...');
  await import('../dist/scripts/syncAccessControl.js');
  log('Access control synchronization completed.');
} catch (error) {
  console.error('[access-control] Failed to run syncAccessControl.js', error);
  process.exit(1);
}
