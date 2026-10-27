/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ["rewardrelay-shared"],
  experimental: {
    // Node-only server SDK: load it from node_modules at runtime instead of bundling it.
    serverComponentsExternalPackages: ["firebase-admin"],
  },
  eslint: { dirs: ["app", "components", "lib", "src", "test"] },
};

module.exports = nextConfig;
