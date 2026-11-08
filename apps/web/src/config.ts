import rootPackage from "../../../package.json";
import scenarioFile from "../../../tools/demo/scenarios/supply-chain.json";

/** Where the source lives, from the root package.json. */
export const repositoryUrl: string = rootPackage.repository.url;

/** What `tools/demo setup` writes to deployments/<network>.json. */
export interface Deployment {
  readonly network: string;
  readonly rpcUrl: string;
  readonly house: string;
  readonly token: { readonly account: string; readonly symbol: string; readonly decimals: number };
  readonly firms: readonly { readonly id: string; readonly name: string; readonly trade: string; readonly account: string }[];
  readonly solvers: readonly { readonly id: string; readonly strategy: string; readonly account: string }[];
  readonly codeHashes: { readonly house: string; readonly token: string };
}

export interface Firm {
  readonly id: string;
  readonly name: string;
  readonly trade: string;
}

export interface ScenarioData {
  readonly name: string;
  readonly symbol: string;
  readonly decimals: number;
  readonly maxReductions: number;
  readonly firms: readonly Firm[];
  readonly obligations: readonly { readonly debtor: string; readonly creditor: string; readonly amount: string; readonly reference: string }[];
}

export const scenario: ScenarioData = {
  name: scenarioFile.name,
  symbol: scenarioFile.token.symbol,
  decimals: scenarioFile.token.decimals,
  maxReductions: scenarioFile.house.maxReductions,
  firms: scenarioFile.firms,
  obligations: scenarioFile.obligations,
};

const deployments = import.meta.glob<Deployment>("../../../deployments/*.json", { eager: true, import: "default" });

/**
 * The deployment the page shows live, chosen by VITE_SETOFF_NETWORK (testnet
 * by default). Without one the page still works as a simulator.
 */
export function liveDeployment(): Deployment | undefined {
  const network = import.meta.env.VITE_SETOFF_NETWORK ?? "testnet";
  const deployment = Object.entries(deployments).find(([path]) => path.endsWith(`/${network}.json`))?.[1];
  if (!deployment) return undefined;
  const rpcUrl = import.meta.env.VITE_NEAR_RPC_URL ?? deployment.rpcUrl;
  return { ...deployment, rpcUrl };
}

export function explorerAccountUrl(network: string, account: string): string {
  return `https://${network === "mainnet" ? "" : "testnet."}nearblocks.io/address/${account}`;
}
