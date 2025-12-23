// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

// https://astro.build/config
export default defineConfig({
  site: 'https://tuxnet.dev',
  // Only use base path in production (GitHub Pages)
  base: '/',
  integrations: [sitemap()],
  markdown: {
    shikiConfig: {
      theme: 'css-variables',
      langs: [],
      wrap: true,
    },
  },
  redirects: {
    '/post/[...slug]': '/posts/[...slug]',
    '/blog/[...slug]': '/posts/[...slug]',
    '/post/20240712_central-logs-postgres': '/posts/central-logs-postgres', // https://news.ycombinator.com/item?id=40961947
  },
});
