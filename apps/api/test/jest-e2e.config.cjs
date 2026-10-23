// CommonJS on purpose: Jest loads it without trying (and warning about) ESM first.
const base = require('../jest.config.cjs');

/** @type {import('jest').Config} */
module.exports = {
  ...base,
  rootDir: '..',
  testMatch: ['<rootDir>/test/**/*.e2e-spec.ts'],
  passWithNoTests: false,
  globalSetup: '<rootDir>/test/setup-db.ts',
};
