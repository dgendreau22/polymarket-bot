import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/lib/strategies/**/*.ts'],
      exclude: [
        'src/lib/strategies/**/*.test.ts',
        'src/lib/strategies/index.ts',
        'src/lib/strategies/registry.ts',
        'src/lib/strategies/StrategyLoader.ts',
        'src/lib/strategies/*-executor.ts',
      ],
    },
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
});
