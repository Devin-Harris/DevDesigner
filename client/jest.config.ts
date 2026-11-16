import type { Config } from 'jest';
import { createCjsPreset } from 'jest-preset-angular/presets/index.js';

// Client unit tests: Jest + jest-preset-angular, zoneless (docs/audits/03-code-cleanliness.md A14).
const config: Config = {
   ...createCjsPreset({
      tsconfig: '<rootDir>/tsconfig.spec.json',
      testEnvironment: 'jest-preset-angular/environments/jest-jsdom-env',
   }),
   displayName: 'client',
   setupFilesAfterEnv: ['<rootDir>/setup-jest.ts'],
   testMatch: ['<rootDir>/src/**/*.spec.ts'],
   moduleNameMapper: {
      // Test against the shared sources, not a possibly stale shared/dist build.
      '^@devdesigner/shared$': '<rootDir>/../shared/src/index.ts',
      '^@devdesigner/shared/(.*)$': '<rootDir>/../shared/src/$1',
   },
   collectCoverageFrom: ['src/app/**/*.ts', '!src/app/**/*.spec.ts'],
};

export default config;
