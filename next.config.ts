import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  /* config options here */
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  /* SAOS-DEX — הבורסה הריבונית חיה על 127.0.0.1:3010 עם basePath משלה.
   * ה-rewrite בשרת-האם מעביר את כל התעבורה (chunks/API/terminal) דרך origin
   * אחד חשוף — בלי זה ה-chunks של הטרמינל היו 404 (תוכנן כך בריפו הדקס). */
  async rewrites() {
    return [
      {
        source: "/saos-dex/:path*",
        destination: "http://127.0.0.1:3010/saos-dex/:path*",
      },
    ];
  },
};

export default nextConfig;
