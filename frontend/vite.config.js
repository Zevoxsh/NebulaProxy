import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src')
    }
  },
  build: {
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        manualChunks: {
          // Core React runtime — rarely changes, maximises cache hit
          'react-vendor': ['react', 'react-dom', 'react-router-dom'],
          // Heavy chart library split out so dashboard pages don’t bloat other routes
          'charts': ['recharts'],
          // Form validation stack
          'forms': ['react-hook-form', '@hookform/resolvers', 'zod'],
          // Radix UI primitives (combined to avoid too many small chunks)
          'ui-primitives': [
            '@radix-ui/react-dialog',
            '@radix-ui/react-dropdown-menu',
            '@radix-ui/react-select',
            '@radix-ui/react-tabs',
            '@radix-ui/react-toast',
            '@radix-ui/react-tooltip',
            '@radix-ui/react-accordion',
            '@radix-ui/react-alert-dialog',
            '@radix-ui/react-popover',
            '@radix-ui/react-scroll-area'
          ]
        }
      }
    }
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true
      },
      '/ws': {
        target: 'ws://localhost:3000',
        ws: true,
        changeOrigin: true
      }
    }
  }
});
