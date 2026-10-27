import { defineConfig } from 'vitest/config';

// Content scripts can't be ES modules and Rollup can't emit several IIFE entries at once,
// so the content script and the popup are built separately (`--mode popup`) into the same dist/.
export default defineConfig(({ mode }) => {
  const popup = mode === 'popup';
  return {
    publicDir: popup ? false : 'public',
    build: {
      outDir: 'dist',
      emptyOutDir: false,
      lib: {
        entry: popup ? 'src/popup.ts' : 'src/content.ts',
        formats: ['iife'],
        name: popup ? 'GithubHunkReviewPopup' : 'GithubHunkReview',
        fileName: () => (popup ? 'popup.js' : 'content.js'),
      },
    },
    test: {
      environment: 'jsdom',
    },
  };
});
