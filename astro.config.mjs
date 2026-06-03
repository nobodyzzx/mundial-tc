import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';
import vercel from '@astrojs/vercel';

// En `astro dev` detrás del proxy Caddy (que termina TLS), el navegador manda
// Origin `https://polla.localhost` pero el dev server ve `http://…`, así que el
// checkOrigin de Astro daría 403 en todos los forms. Producción (Vercel) no
// tiene ese desajuste, por eso solo lo desactivamos en el dev server.
const isDev = process.argv.includes('dev');

export default defineConfig({
  server: {
    port: Number(process.env.PORT) || 47308,
    host: true,
  },
  prefetch: {
    prefetchAll: true,
    defaultStrategy: 'hover',
  },
  output: 'server',
  adapter: vercel(),
  security: {
    checkOrigin: !isDev,
  },
  vite: {
    plugins: [tailwindcss()],
  },
});
