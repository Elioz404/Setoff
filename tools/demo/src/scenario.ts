import { readFileSync } from "node:fs";

import { parseAmount } from "@setoff/house-client";
import type { Debt } from "@setoff/solver";

export interface Scenario {
  readonly name: string;
  readonly token: { readonly name: string; readonly symbol: string; readonly decimals: number; readonly faucetCap: string };
  readonly house: {
    readonly roundDurationSeconds: number;
    readonly maxReductions: number;
    readonly proposalBondNear: string;
    readonly rewardBps: number;
    readonly rewardPool: string;
  };
  readonly funding: {
    readonly houseNear: string;
    readonly tokenNear: string;
    readonly firmNear: string;
    readonly solverNear: string;
    readonly storageDepositNear: string;
  };
  readonly firms: readonly { readonly id: string; readonly name: string; readonly trade: string }[];
  readonly solvers: readonly { readonly id: string; readonly strategy: "optimal" | "greedy" }[];
  readonly obligations: readonly {
    readonly debtor: string;
    readonly creditor: string;
    readonly amount: string;
    readonly reference: string;
  }[];
}

const ACCOUNT_LABEL = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export class ScenarioError extends Error {
  override readonly name = "ScenarioError";
}

export function loadScenario(path: string): Scenario {
  const scenario = JSON.parse(readFileSync(path, "utf8")) as Scenario;
  validateScenario(scenario);
  return scenario;
}

/** Checks the references inside a scenario, so a typo fails before any transaction. */
export function validateScenario(scenario: Scenario): void {
  const firms = new Set(scenario.firms.map((f) => f.id));
  const labels = [...firms, ...scenario.solvers.map((s) => s.id)];
  if (new Set(labels).size !== labels.length) throw new ScenarioError("firm and solver ids must be unique");
  for (const label of labels) {
    if (!ACCOUNT_LABEL.test(label)) throw new ScenarioError(`${label} is not a valid account label`);
  }
  if (scenario.obligations.length === 0) throw new ScenarioError("the scenario has no obligations");
  for (const o of scenario.obligations) {
    if (!firms.has(o.debtor) || !firms.has(o.creditor)) throw new ScenarioError(`unknown firm in ${o.reference}`);
    if (o.debtor === o.creditor) throw new ScenarioError(`${o.reference} has the same debtor and creditor`);
    if (parseAmount(o.amount, scenario.token.decimals) <= 0n) throw new ScenarioError(`${o.reference} has no amount`);
  }
  if (scenario.house.maxReductions < 2) throw new ScenarioError("maxReductions must be at least 2");
}

/** The scenario's obligations as solver debts, with ids in issue order. */
export function scenarioDebts(scenario: Scenario): Debt[] {
  return scenario.obligations.map((o, index) => ({
    id: String(index),
    debtor: o.debtor,
    creditor: o.creditor,
    outstanding: parseAmount(o.amount, scenario.token.decimals),
  }));
}

/** Account ids of a deployment, all sub-accounts of one root account. */
export class Accounts {
  constructor(readonly root: string) {}

  house(): string {
    return `house.${this.root}`;
  }

  token(): string {
    return `tusd.${this.root}`;
  }

  of(label: string): string {
    return `${label}.${this.root}`;
  }
}
