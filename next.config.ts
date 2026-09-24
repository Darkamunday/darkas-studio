import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // `next dev` blocks its JS/HMR assets for hosts other than localhost, which
  // leaves pages un-hydrated (no buttons work). Allow the public domain and
  // the container's LAN IP.
  allowedDevOrigins: ["music.darka-ai.co.uk", "192.168.0.24"],
};

export default nextConfig;
