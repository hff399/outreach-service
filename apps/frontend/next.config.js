/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@outreach/shared'],
  experimental: {
    serverComponentsExternalPackages: ['@supabase/ssr'],
  },
};

module.exports = nextConfig;
