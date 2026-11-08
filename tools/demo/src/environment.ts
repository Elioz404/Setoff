import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const repositoryRoot = resolve(fileURLToPath(new URL("../../..", import.meta.url)));

/** Where `scripts/build-contracts.sh` leaves the wasm files. */
export const defaultWasmDir = join(repositoryRoot, "target/wasm32-unknown-unknown/release");

/** Public testnet RPC endpoints, tried in order. */
export const TESTNET_RPC_URLS = ["https://test.rpc.fastnear.com", "https://rpc.testnet.near.org"] as const;

export interface DemoEnvironment {
  readonly rpcUrls: readonly string[];
  readonly rootAccount: string;
  readonly rootKeyFile: string;
  readonly keyDir: string;
  readonly scenarioPath: string;
  readonly wasmDir: string;
  readonly deploymentPath: string;
}

/**
 * Reads the demo tool's settings. The tool deploys a token with an open
 * faucet, so it refuses to run against anything but testnet.
 */
export function loadEnvironment(env: Readonly<Record<string, string | undefined>>): DemoEnvironment {
  const required = (name: string) => {
    const value = env[name]?.trim();
    if (!value) throw new Error(`${name} is not set`);
    return value;
  };
  const rootAccount = required("SETOFF_ROOT_ACCOUNT");
  const listed = env.NEAR_RPC_URL?.split(",").map((url) => url.trim()).filter(Boolean) ?? [];
  const rpcUrls = listed.length > 0 ? listed : [...TESTNET_RPC_URLS];
  if (!rootAccount.endsWith(".testnet") || rpcUrls.some((url) => /mainnet/i.test(url))) {
    throw new Error("the demo tool only runs on testnet: use a .testnet root account and a testnet RPC");
  }
  return {
    rpcUrls,
    rootAccount,
    rootKeyFile: env.SETOFF_ROOT_KEY_FILE?.trim() || join(homedir(), ".near-credentials", "testnet", `${rootAccount}.json`),
    keyDir: env.SETOFF_KEY_DIR?.trim() || join(homedir(), ".near-credentials", "testnet"),
    scenarioPath: resolve(env.SETOFF_SCENARIO?.trim() || join(repositoryRoot, "tools/demo/scenarios/supply-chain.json")),
    wasmDir: resolve(env.SETOFF_WASM_DIR?.trim() || defaultWasmDir),
    deploymentPath: resolve(env.SETOFF_DEPLOYMENT?.trim() || join(repositoryRoot, "deployments/testnet.json")),
  };
}
