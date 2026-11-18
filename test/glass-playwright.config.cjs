// Optional local QA against an already-running preview. Avoids Windows server
// teardown hanging; never targets production or changes the normal test config.
const base = require('../playwright.config.cjs');
const path = require('node:path');
module.exports = { ...base, testDir: path.join(__dirname,'e2e'), webServer: undefined, outputDir: path.join(__dirname,'../test-results/glass-check'), use: { ...base.use, serviceWorkers: 'block' } };
