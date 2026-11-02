import type { NextConfig } from "next";

const config: NextConfig = {
  serverExternalPackages: ["better-sqlite3"],
  poweredByHeader: false,
  outputFileTracingExcludes: { "/*": ["./.local/**/*", "./.env*", "./private-data/**/*"] },
};
export default config;
