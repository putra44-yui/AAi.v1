/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true, // Aktifkan mode strict biar kode lebih aman
  typescript: {
    ignoreBuildErrors: false, // Biarkan false agar error TS ketahuan saat build
  },
};

module.exports = nextConfig;