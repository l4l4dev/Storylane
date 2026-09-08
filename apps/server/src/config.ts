export class ConfigError extends Error {}

export interface Config {
  port: number;
  dataDir: string;
  baseUrl: URL | null;
  trustProxy: boolean;
  gitSha: string;
}

function parseBool(name: string, raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined || raw === "") return fallback;
  if (raw === "true") return true;
  if (raw === "false") return false;
  throw new ConfigError(`${name} must be "true" or "false", got "${raw}"`);
}

export function loadConfig(env: Record<string, string | undefined>): Config {
  const portRaw = env.STORYLANE_PORT ?? "3000";
  const port = Number(portRaw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new ConfigError(`STORYLANE_PORT must be an integer 1-65535, got "${portRaw}"`);
  }
  const dataDir = env.STORYLANE_DATA_DIR && env.STORYLANE_DATA_DIR !== "" ? env.STORYLANE_DATA_DIR : "/data";
  let baseUrl: URL | null = null;
  if (env.STORYLANE_BASE_URL && env.STORYLANE_BASE_URL !== "") {
    let parsed: URL;
    try {
      parsed = new URL(env.STORYLANE_BASE_URL);
    } catch {
      throw new ConfigError(`STORYLANE_BASE_URL must be an absolute URL, got "${env.STORYLANE_BASE_URL}"`);
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new ConfigError(`STORYLANE_BASE_URL must be http(s), got "${parsed.protocol}"`);
    }
    baseUrl = parsed;
  }
  const gitSha = env.STORYLANE_GIT_SHA && env.STORYLANE_GIT_SHA !== "" ? env.STORYLANE_GIT_SHA : "dev";
  return {
    port,
    dataDir,
    baseUrl,
    trustProxy: parseBool("STORYLANE_TRUST_PROXY", env.STORYLANE_TRUST_PROXY, false),
    gitSha,
  };
}
