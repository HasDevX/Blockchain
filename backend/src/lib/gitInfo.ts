import { execSync } from "child_process";

const SHORT_SHA_REGEX = /^[0-9a-f]{7,12}$/;
const LONG_SHA_REGEX = /^[0-9a-f]{40}$/;
const FALLBACK_SHA = "0000000";

let cachedGitSha: string | undefined;

function normalizeSha(raw?: string | null): string | undefined {
  if (!raw) {
    return undefined;
  }

  const trimmed = raw.trim().toLowerCase();
  if (SHORT_SHA_REGEX.test(trimmed)) {
    return trimmed;
  }

  if (LONG_SHA_REGEX.test(trimmed)) {
    return trimmed.slice(0, 12);
  }

  return undefined;
}

function resolveGitSha(): string {
  const envSha = normalizeSha(process.env.GIT_SHA);
  if (envSha) {
    cachedGitSha = envSha;
    process.env.GIT_SHA = envSha;
    return envSha;
  }

  try {
    const output = execSync("git rev-parse --short=12 HEAD", {
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim();

    const match = normalizeSha(output) ?? output.match(/[0-9a-f]{7,12}/i)?.[0]?.toLowerCase();
    if (match) {
      cachedGitSha = match;
      process.env.GIT_SHA = match;
      return match;
    }
  } catch (error) {
    // ignore and fall through to fallback
  }

  cachedGitSha = FALLBACK_SHA;
  process.env.GIT_SHA = FALLBACK_SHA;
  return FALLBACK_SHA;
}

export function getGitSha(): string {
  if (cachedGitSha) {
    return cachedGitSha;
  }

  return resolveGitSha();
}
