import { version } from "../../package.json";

// Owner-facing version string, e.g. "v0.1.0 (2209663)". The SHA identifies the
// exact production deploy (release procedure: DEPLOY.md "Versioning").
export function formatAppVersion(pkgVersion: string, commitSha: string | undefined): string {
  const build = commitSha ? commitSha.slice(0, 7) : "dev";
  return `v${pkgVersion} (${build})`;
}

// VERCEL_GIT_COMMIT_SHA is a Vercel system env var (absent in local dev);
// server-side only — client components must receive the result as a prop.
export function appVersion(): string {
  return formatAppVersion(version, process.env.VERCEL_GIT_COMMIT_SHA);
}
