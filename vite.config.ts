import { defineConfig } from 'vitest/config';
import preact from '@preact/preset-vite';

export default defineConfig({
  plugins: [preact()],
  test: {
    include: ['tests/unit/**/*.test.{ts,tsx}'],
    environment: 'node',
  },
});
