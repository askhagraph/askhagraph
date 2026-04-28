import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    include: ['packages/*/src/**/*.test.ts'],
    exclude: ['packages/native/**', 'node_modules/**'],
    coverage: {
      provider: 'v8',
      include: ['packages/*/src/**/*.ts'],
      exclude: ['packages/native/**', '**/*.test.ts', '**/*.d.ts'],
    },
  },
});
