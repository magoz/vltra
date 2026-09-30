import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

const integrationGlob = '**/*.integration.test.ts'

const sharedExclude = ['**/node_modules/**', '**/.next/**', '**/tools/oxlint/anti-slop/**']

export default defineConfig({
  plugins: [react()],
  resolve: {
    tsconfigPaths: true
  },
  test: {
    environment: 'jsdom',
    exclude: sharedExclude,
    testTimeout: 30000,
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          environment: 'jsdom',
          exclude: [...sharedExclude, integrationGlob],
          testTimeout: 30000
        }
      },
      {
        extends: true,
        test: {
          name: 'integration',
          environment: 'node',
          include: [integrationGlob],
          exclude: sharedExclude,
          testTimeout: 120000,
          hookTimeout: 120000,
          fileParallelism: false
        }
      }
    ]
  }
})
