import type { Config } from 'jest';

const config: Config = {
  rootDir: '..',
  testMatch: ['<rootDir>/test/**/*.e2e-spec.ts'],
  globalSetup: '<rootDir>/test/setup-db.ts',
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json' }],
    // Better Auth and its deps are ESM-only; compile them to CJS for Jest.
    '^.+\\.m?js$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json', diagnostics: false }],
  },
  transformIgnorePatterns: [
    '/node_modules/(?!(better-auth|@better-auth|better-call|jose|nanostores|@noble|kysely|zod|defu|rou3|@standard-schema)/)',
  ],
  // Generated Prisma client imports use .js extensions that resolve to .ts sources.
  moduleNameMapper: { '^(\\.{1,2}/.*)\\.js$': '$1' },
  testEnvironment: 'node',
};

export default config;
