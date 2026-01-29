/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',
  trailingSlash: true,
  transpilePackages: ['@outreach/shared'],
  images: {
    unoptimized: true,
  },
};

module.exports = nextConfig;
