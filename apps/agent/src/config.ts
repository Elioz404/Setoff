import { readFileSync } from "node:fs";
import { basename } from "node:path";

import type { KeyPairString } from "near-api-js";

export type Strategy = "optimal" | "greedy";

export interface AgentConfig {
  /** Tried in order; NEAR_RPC_URL may list several, separated by commas. */
  readonly rpcUrls: readonly string[];
  readonly contractId: string;
  readonly asset: string;
  readonly accountId: string;
  readonly privateKey: KeyPairString;
  readonly strategy: Strategy;
  readonly pollMs: number;
  /** Stop after one decision instead of looping; for scripts and CI. */
  readonly once: boolean;
}

export class ConfigError extends Error {
  override readonly name = "ConfigError";
}

/**
 * Reads the agent's settings from the environment. Every value that names an
 * account or holds a key is required: nothing falls back to a built-in account.
 * The key comes from SOLVER_PRIVATE_KEY or, preferably, from SOLVER_KEY_FILE, a
 * near-cli key file, so it never has to appear on a command line.
 */
export function loadConfig(
  env: Readonly<Record<string, string | undefined>>,
  readFile: (path: string) => string = (path) => readFileSync(path, "utf8"),
): AgentConfig {
  const required = (name: string) => {
    const value = env[name]?.trim();
    if (!value) throw new ConfigError(`${name} is not set`);
    return value;
  };

  const accountId = required("SOLVER_ACCOUNT_ID");
  const privateKey = env.SOLVER_PRIVATE_KEY?.trim() || keyFromFile(env.SOLVER_KEY_FILE?.trim(), accountId, readFile);
  if (!/^(ed25519|secp256k1):[1-9A-HJ-NP-Za-km-z]+$/.test(privateKey)) {
    throw new ConfigError("SOLVER_PRIVATE_KEY must look like ed25519:<base58>");
  }
  const strategy = env.SOLVER_STRATEGY?.trim() || "optimal";
  if (strategy !== "optimal" && strategy !== "greedy") {
    throw new ConfigError("SOLVER_STRATEGY must be optimal or greedy");
  }
  const pollSeconds = Number(env.SOLVER_POLL_SECONDS ?? "10");
  if (!Number.isFinite(pollSeconds) || pollSeconds < 1) {
    throw new ConfigError("SOLVER_POLL_SECONDS must be a number of at least 1");
  }

  return {
    rpcUrls: required("NEAR_RPC_URL").split(",").map((url) => url.trim()).filter(Boolean),
    contractId: required("SETOFF_CONTRACT"),
    asset: required("SETOFF_ASSET"),
    accountId,
    privateKey: privateKey as KeyPairString,
    strategy,
    pollMs: pollSeconds * 1000,
    once: env.SOLVER_ONCE === "1",
  };
}

function keyFromFile(path: string | undefined, accountId: string, readFile: (path: string) => string): string {
  if (!path) throw new ConfigError("set SOLVER_KEY_FILE or SOLVER_PRIVATE_KEY");
  const file = JSON.parse(readFile(path)) as { account_id?: string; private_key?: string };
  // near-cli-rs leaves out account_id and names the file after the account.
  const owner = file.account_id ?? (basename(path) === `${accountId}.json` ? accountId : undefined);
  if (owner !== accountId) throw new ConfigError(`${path} is not the key of ${accountId}`);
  if (!file.private_key) throw new ConfigError(`${path} has no private_key`);
  return file.private_key;
}
