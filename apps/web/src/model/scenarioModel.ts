import { parseAmount } from "@setoff/house-client";
import { solve, solveGreedy, type Debt, type Solution } from "@setoff/solver";

import type { ScenarioData } from "../config.ts";
import { bookFrom, type Book, type Entry } from "./book.ts";

export interface ScenarioModel {
  readonly entries: readonly Entry[];
  readonly optimal: Solution;
  readonly greedy: Solution;
  /** The book after the optimal clearing. */
  readonly book: Book;
}

/** Runs both solvers on the scenario's invoices, the way the agents would on chain. */
export function scenarioModel(scenario: ScenarioData): ScenarioModel {
  const entries: Entry[] = scenario.obligations.map((o, index) => ({
    id: String(index),
    debtor: o.debtor,
    creditor: o.creditor,
    amount: parseAmount(o.amount, scenario.decimals),
    reference: o.reference,
  }));
  const debts: Debt[] = entries.map((e) => ({ id: e.id, debtor: e.debtor, creditor: e.creditor, outstanding: e.amount }));
  const limits = { maxReductions: scenario.maxReductions };
  const optimal = solve(debts, limits);
  return { entries, optimal, greedy: solveGreedy(debts, limits), book: bookFrom(entries, optimal.reductions) };
}
