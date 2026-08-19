import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const src = fileURLToPath(new URL('./src', import.meta.url))

export default defineConfig({
  resolve: {
    alias: { '@': src },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}'],
    typecheck: {
      enabled: true,
      include: ['src/**/*.test-d.{ts,tsx}'],
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/**/*.test.{ts,tsx}',
        'src/**/*.test-d.{ts,tsx}',
        'src/**/__tests__/**',
        'src/test-fixtures/**',
      ],
    },
  },
})
