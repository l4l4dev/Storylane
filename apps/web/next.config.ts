import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // @storylane/core (TASK-68) ships as a TS-source workspace package with no
  // build step — Next must transpile it itself, same as any other local
  // source, rather than treating it as pre-built node_modules code.
  transpilePackages: ["@storylane/core"],
};

export default nextConfig;
