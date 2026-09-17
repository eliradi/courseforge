import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // `next dev` and `next build` both default to `.next`, so building while the
  // dev server runs deletes the chunks it is serving — pages then fail with
  // ChunkLoadError until the server is restarted. Local production builds go to
  // their own directory instead. Vercel keeps the default it expects.
  distDir:
    process.env.NODE_ENV === 'production' && !process.env.VERCEL ? '.next-build' : '.next',
};

export default nextConfig;
