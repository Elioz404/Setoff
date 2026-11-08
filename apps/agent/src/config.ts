import type { KeyPairString } from "near-api-js";

export type Strategy = "optimal" | "greedy";

export interface AgentConfig {
  readonly rpcUrl: string;
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
 */
export function loadConfig(env: Readonly<Record<string, string | undefined>>): AgentConfig {
  const required = (name: string) => {
    const value = env[name]?.trim();
    if (!value) throw new ConfigError(`${name} is not set`);
    return value;
  };

  const privateKey = required("SOLVER_PRIVATE_KEY");
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
    rpcUrl: required("NEAR_RPC_URL"),
    contractId: required("SETOFF_CONTRACT"),
    asset: required("SETOFF_ASSET"),
    accountId: required("SOLVER_ACCOUNT_ID"),
    privateKey: privateKey as KeyPairString,
    strategy,
    pollMs: pollSeconds * 1000,
    once: env.SOLVER_ONCE === "1",
  };
}
