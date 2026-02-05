/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@outreach/shared'],
  images: {
    unoptimized: true,
  },
  // Enable server-side features
  experimental: {
    serverComponentsExternalPackages: ['telegram', 'big-integer'],
  },
};

module.exports = nextConfig;
