/** @type {import('next').NextConfig} */
const nextConfig = {
  // Static export: produces plain HTML/CSS/JS files that Cloudflare Pages
  // can serve directly, no Node.js server needed. Fine for now since the
  // site is fully static — we'll revisit this once real backend routes
  // (checkout capture, zap listener) get added.
  output: "export",
  images: {
    // Static export can't use Next's server-side image optimizer.
    unoptimized: true,
  },
};

export default nextConfig;
