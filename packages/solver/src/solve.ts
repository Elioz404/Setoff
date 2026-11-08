import { maximumCirculation } from "./circulation.ts";
import { decompose, selectWithin } from "./cycles.ts";
import type { Debt, Reduction, Solution, SolveOptions } from "./types.ts";

const DEFAULT_MAX_ITERATIONS = 10_000;

/**
 * Finds the clearing that removes the most debt, then trims it to whole
 * cycles if it touches more obligations than one proposal may hold.
 */
export function solve(debts: readonly Debt[], options: SolveOptions): Solution {
  if (!Number.isInteger(options.maxReductions) || options.maxReductions < 2) {
    throw new RangeError("maxReductions must be an integer of at least 2");
  }
  const usable = debts.filter((debt) => debt.outstanding > 0n && debt.debtor !== debt.creditor);
  const { flow, optimal } = maximumCirculation(usable, options.maxIterations ?? DEFAULT_MAX_ITERATIONS);

  const touched = flow.filter((amount) => amount > 0n).length;
  const fits = touched <= options.maxReductions;
  const amounts = fits ? flow : sumCycles(usable.length, selectWithin(decompose(usable, flow), options.maxReductions));

  const reductions: Reduction[] = usable
    .map((debt, index) => ({ obligation: debt.id, amount: amounts[index]! }))
    .filter((reduction) => reduction.amount > 0n)
    .sort((a, b) => compareIds(a.obligation, b.obligation));
  const cleared = reductions.reduce((sum, reduction) => sum + reduction.amount, 0n);
  return { reductions, cleared, optimal: optimal && fits };
}

function sumCycles(size: number, cycles: ReturnType<typeof selectWithin>): bigint[] {
  const amounts = new Array<bigint>(size).fill(0n);
  for (const cycle of cycles) {
    for (const index of cycle.debts) amounts[index] = amounts[index]! + cycle.amount;
  }
  return amounts;
}

function compareIds(a: string, b: string): number {
  const x = BigInt(a);
  const y = BigInt(b);
  return x === y ? 0 : x < y ? -1 : 1;
}

/**
 * The clearing house's acceptance rule, checked before spending a
 * transaction on a proposal: every reduction is positive and within what is
 * owed, no obligation repeats, and every party stops owing exactly as much as
 * it stops being owed. The contract checks the same rule and is the authority.
 */
export function isBalanced(debts: readonly Debt[], reductions: readonly Reduction[]): boolean {
  const byId = new Map(debts.map((debt) => [debt.id, debt]));
  const seen = new Set<string>();
  const net = new Map<string, bigint>();
  for (const { obligation, amount } of reductions) {
    const debt = byId.get(obligation);
    if (debt === undefined || seen.has(obligation) || amount <= 0n || amount > debt.outstanding) return false;
    seen.add(obligation);
    net.set(debt.debtor, (net.get(debt.debtor) ?? 0n) + amount);
    net.set(debt.creditor, (net.get(debt.creditor) ?? 0n) - amount);
  }
  return reductions.length > 0 && [...net.values()].every((value) => value === 0n);
}
