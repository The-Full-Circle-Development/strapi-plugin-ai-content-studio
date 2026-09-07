/**
 * The repository's first test runner (FR-055).
 *
 * jest, because it is what Strapi itself runs — `@strapi/strapi` and `@strapi/sdk-plugin` both
 * declare a jest `test:unit` script, verified in the installed packages. ts-jest is the transform,
 * because this project already ships `typescript` and ts-jest's peer range accepts both the
 * installed jest 30 and typescript 5.9.
 *
 * TYPECHECKING IS NOT DONE HERE, deliberately. The root `tsconfig.json` resolves modules the way
 * the bundler does (`moduleResolution: Bundler`), which honours each package's `exports` map. jest
 * needs CommonJS, and `module: CommonJS` cannot be paired with `Bundler` resolution — so a
 * transform that also typechecked would have to resolve `@langchain/*` through a DIFFERENT
 * declaration path than the build does, and report variance errors that do not exist in the real
 * compilation. That is a false failure, and chasing it would mean loosening the descriptor types to
 * satisfy a resolution mode this project never uses.
 *
 * So the two jobs are split at their natural seam:
 *   - `pnpm run typecheck` (tsc, Bundler resolution) typechecks ALL sources INCLUDING these suites.
 *   - jest transpiles and runs them.
 * Both are per-commit gate items, so nothing goes unchecked.
 *
 * STANDING RULE FOR EVERY SUITE (constitution V): no test may call a language model, open a network
 * connection, bootstrap the Strapi runtime, or touch the filesystem outside its own fixtures. Every
 * suite covers a pure function whose determinism is already a stated requirement, so a failure is a
 * real defect and never a flake.
 */
module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/server', '<rootDir>/admin'],
  testMatch: ['**/*.test.ts', '**/*.test.tsx'],
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        diagnostics: false,
        tsconfig: {
          module: 'CommonJS',
          moduleResolution: 'Node',
          esModuleInterop: true,
          allowSyntheticDefaultImports: true,
          skipLibCheck: true,
          target: 'ES2021',
          jsx: 'react-jsx',
          resolveJsonModule: true,
        },
      },
    ],
  },
  // Nothing here reaches a provider, a socket or a host, so a slow test is a bug in the test.
  testTimeout: 10000,
  clearMocks: true,
};
