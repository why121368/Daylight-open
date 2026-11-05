import path from 'node:path';
import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { frontendInputs } from './scripts/lib/frontend-inputs.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [frontendInputs(root), react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(root, './src'),
    },
  },
});
