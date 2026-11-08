import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/**
 * Public description of a deployment: account ids and code hashes only, no
 * keys. The web page and the README read it, so it is committed.
 */
export interface Deployment {
  readonly network: "testnet";
  readonly rpcUrls: readonly string[];
  readonly scenario: string;
  readonly house: string;
  readonly token: { readonly account: string; readonly symbol: string; readonly decimals: number };
  readonly firms: readonly { readonly id: string; readonly name: string; readonly trade: string; readonly account: string }[];
  readonly solvers: readonly { readonly id: string; readonly strategy: string; readonly account: string }[];
  readonly codeHashes: { readonly house: string; readonly token: string };
  /** Contract obligation id of each scenario obligation, in scenario order, once issued. */
  readonly obligations: readonly string[];
}

export function readDeployment(path: string): Deployment | undefined {
  return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as Deployment) : undefined;
}

export function writeDeployment(path: string, deployment: Deployment): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(deployment, null, 2)}\n`);
}
