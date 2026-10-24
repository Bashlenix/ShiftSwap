// CommonJS on purpose: Jest loads it without trying (and warning about) ESM first.
/** @type {import('jest').Config} */
module.exports = {
  rootDir: '.',
  testMatch: ['<rootDir>/src/**/*.spec.ts'],
  passWithNoTests: true,
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.jest.json' }],
    // Better Auth and its deps are ESM-only; compile them to CJS for Jest.
    '^.+\\.m?js$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.jest.json', diagnostics: false }],
  },
  transformIgnorePatterns: [
    '/node_modules/(?!(better-auth|@better-auth|better-call|jose|nanostores|@noble|kysely|zod|defu|rou3|@standard-schema)/)',
  ],
  // Generated Prisma client imports use .js extensions that resolve to .ts sources.
  moduleNameMapper: { '^(\\.{1,2}/.*)\\.js$': '$1' },
  setupFiles: ['<rootDir>/test/unit-env.ts'],
  testEnvironment: 'node',
};
