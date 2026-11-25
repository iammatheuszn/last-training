import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const root = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  root,
  base: '/admin/',
  plugins: [react()],
  server: { port: 5174, strictPort: true },
  build: {
    outDir: fileURLToPath(new URL('../server/admin/dist', import.meta.url)),
    emptyOutDir: true,
    manifest: true,
    rollupOptions: {
      input: { admin: fileURLToPath(new URL('./index.html', import.meta.url)) }
    }
  }
});
