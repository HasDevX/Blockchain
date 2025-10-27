import { execSync } from "child_process";

let cachedGitSha: string | undefined;

export function getGitSha(): string {
  if (process.env.GIT_SHA) {
    return process.env.GIT_SHA;
  }

  if (cachedGitSha) {
    return cachedGitSha;
  }

  try {
    cachedGitSha = execSync("git rev-parse HEAD", { stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
  } catch (error) {
    cachedGitSha = "unknown";
  }

  return cachedGitSha ?? "unknown";
}
