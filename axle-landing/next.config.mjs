/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "export",
  reactStrictMode: true,
  turbopack: { root: import.meta.dirname },
  images: { unoptimized: true },
};

export default nextConfig;
