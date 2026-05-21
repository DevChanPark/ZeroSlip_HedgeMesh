const apiTarget = process.env.API_PROXY_TARGET || "http://127.0.0.1:3001";

/** @type {import('next').NextConfig} */
const nextConfig = {
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${apiTarget}/api/:path*`
      },
      {
        source: "/health",
        destination: `${apiTarget}/health`
      }
    ];
  }
};

export default nextConfig;
