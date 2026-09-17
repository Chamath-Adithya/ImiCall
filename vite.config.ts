import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

export default defineConfig({
  plugins: [react(), {
    name: 'imicall-offline-shell',
    generateBundle(_options, bundle) {
      const entry = Object.values(bundle).find(item => item.type === 'chunk' && item.isEntry);
      const files = new Set<string>();
      const visit = (name: string) => {
        if (files.has(name)) return;
        files.add(name);
        const chunk = bundle[name];
        if (chunk?.type === 'chunk') chunk.imports.forEach(visit);
      };
      if (entry) visit(entry.fileName);
      Object.values(bundle).filter(item => item.fileName.endsWith('.css')).forEach(item => files.add(item.fileName));
      const id = createHash('sha256').update(Object.keys(bundle).sort().join()).digest('hex').slice(0, 12);
      const optional = Object.keys(bundle).filter(name => name.endsWith('.js') && !files.has(name)).map(name => '/' + name);
      const core = ['/', '/icon.svg', '/favicon.svg', '/manifest.json', '/voice-worklet.js', ...Array.from(files, name => '/' + name)];
      const source = readFileSync('public/sw.js', 'utf8').replace('__BUILD_ID__', id).replace("/*__PRECACHE__*/ ['/', '/icon.svg', '/manifest.json']", JSON.stringify(core)).replace('/*__OPTIONAL__*/ []', JSON.stringify(optional));
      this.emitFile({ type: 'asset', fileName: 'offline-worker.js', source });
    },
    closeBundle() {
      writeFileSync('dist/sw.js', readFileSync('dist/offline-worker.js'));
    },
  }],
  resolve: { alias: [
    { find: /^react-dom\/client$/, replacement: 'preact/compat/client' },
    { find: /^react-dom$/, replacement: 'preact/compat' },
    { find: /^react\/jsx-runtime$/, replacement: 'preact/jsx-runtime' },
    { find: /^react$/, replacement: 'preact/compat' },
  ] },
  build: {
    target: 'es2020',
    cssMinify: true,
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/qrcode')) {
            return 'qrcode-lib';
          }
          if (id.includes('node_modules/lucide-react')) {
            return 'icons';
          }
          if (id.includes('node_modules/preact') || id.includes('node_modules/react') || id.includes('node_modules/react-dom') || id.includes('node_modules/scheduler')) {
            return 'vendor';
          }
        },
      },
    },
  },
  server: {
    port: 3000,
    host: true,
    proxy: { '/api': 'http://localhost:8080', '/ws': { target: 'ws://localhost:8080', ws: true } },
  },
});
