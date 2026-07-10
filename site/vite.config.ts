import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// The public product page is path-mounted at mivehchi.app/battcal (apex rewrite ->
// this project's /battcal path, see site/vercel.json), so assets must resolve
// under that base both through the proxy and on the project's own domain.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: '/battcal/',
});
