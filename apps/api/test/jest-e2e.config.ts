import type { Config } from 'jest';

const config: Config = {
  rootDir: '..',
  testMatch: ['<rootDir>/test/**/*.e2e-spec.ts'],
  globalSetup: '<rootDir>/test/setup-db.ts',
  transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json' }] },
  // Generated Prisma client imports use .js extensions that resolve to .ts sources.
  moduleNameMapper: { '^(\\.{1,2}/.*)\\.js$': '$1' },
  testEnvironment: 'node',
};

export default config;
