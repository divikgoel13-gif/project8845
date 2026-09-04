/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // V1 is website-only (see SRS 1.1). No native app build targets.
  images: {
    remotePatterns: [
      {
        protocol: "https",
        // Supabase Storage public buckets (product images, brand assets).
        // Replace <project-ref> in NEXT_PUBLIC_SUPABASE_URL and this stays in sync automatically
        // via the hostname derived at runtime; kept broad here for local/staging project refs.
        hostname: "*.supabase.co",
      },
    ],
  },
  experimental: {
    serverActions: {
      // Keep default body size limit tight; large uploads (grievance attachments,
      // payout proofs, product images) go through Supabase Storage signed uploads,
      // not through Server Action payloads.
      bodySizeLimit: "2mb",
    },
  },
};

module.exports = nextConfig;
