import type { Config } from 'jest';

const config: Config = {
  rootDir: '.',
  testMatch: ['<rootDir>/src/**/*.spec.ts'],
  passWithNoTests: true,
  transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json' }] },
  // Generated Prisma client imports use .js extensions that resolve to .ts sources.
  moduleNameMapper: { '^(\\.{1,2}/.*)\\.js$': '$1' },
  testEnvironment: 'node',
};

export default config;
