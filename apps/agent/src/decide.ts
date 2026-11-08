import { isBalanced, type Debt, type Solution } from "@setoff/solver";
import type { RoundView } from "@setoff/house-client";

export type Decision =
  | { readonly kind: "close" }
  | { readonly kind: "submit"; readonly solution: Solution }
  | { readonly kind: "wait"; readonly reason: string };

/**
 * What a solver should do next, given the round and its own best clearing.
 * A round past its deadline is closed first, since the contract takes no
 * proposals until then. A proposal is sent only if it passes the contract's
 * rule and clears strictly more than the current best; anything else would
 * be refused and waste a transaction.
 */
export function decide(round: RoundView, nowNs: bigint, debts: readonly Debt[], solution: Solution): Decision {
  if (round.best && round.closes_at_ns !== null && BigInt(round.closes_at_ns) <= nowNs) {
    return { kind: "close" };
  }
  if (solution.cleared === 0n) {
    return { kind: "wait", reason: "no debt runs in a cycle" };
  }
  if (!isBalanced(debts, solution.reductions)) {
    return { kind: "wait", reason: "the solution does not pass the set-off rule" };
  }
  const best = round.best ? BigInt(round.best.cleared) : 0n;
  if (solution.cleared <= best) {
    return { kind: "wait", reason: `the best proposal already clears ${best}` };
  }
  return { kind: "submit", solution };
}
