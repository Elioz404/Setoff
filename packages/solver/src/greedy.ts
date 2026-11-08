import type { Debt, Solution, SolveOptions } from "./types.ts";

/**
 * Cancels the first debt cycle it finds by its smallest debt, and repeats
 * until no cycle is left. Always valid and quick, but it can lock in a poor
 * choice when cycles share a debt, so a better solver can outbid it. It is
 * here to give the market a second, weaker strategy.
 */
export function solveGreedy(debts: readonly Debt[], options: SolveOptions): Solution {
  const usable = debts.filter((d) => d.outstanding > 0n && d.debtor !== d.creditor);
  const remaining = usable.map((d) => d.outstanding);
  const cleared = usable.map(() => 0n);
  const touched = new Set<number>();

  for (let cycle = findCycle(usable, remaining); cycle; cycle = findCycle(usable, remaining)) {
    const added = cycle.filter((index) => !touched.has(index));
    if (touched.size + added.length > options.maxReductions) break;
    added.forEach((index) => touched.add(index));
    const amount = cycle.reduce((min, i) => (remaining[i]! < min ? remaining[i]! : min), remaining[cycle[0]!]!);
    for (const index of cycle) {
      remaining[index] = remaining[index]! - amount;
      cleared[index] = cleared[index]! + amount;
    }
  }

  const reductions = usable
    .map((debt, index) => ({ obligation: debt.id, amount: cleared[index]! }))
    .filter((r) => r.amount > 0n);
  return { reductions, cleared: reductions.reduce((sum, r) => sum + r.amount, 0n), optimal: false };
}

/** Depth-first search for any cycle of debts with something left; returns debt indices in order. */
function findCycle(debts: readonly Debt[], remaining: readonly bigint[]): number[] | undefined {
  const outgoing = new Map<string, number[]>();
  debts.forEach((debt, index) => {
    if (remaining[index]! <= 0n) return;
    outgoing.set(debt.debtor, [...(outgoing.get(debt.debtor) ?? []), index]);
  });
  const done = new Set<string>();
  const onPath = new Map<string, number>();
  const path: number[] = [];

  const visit = (party: string): number[] | undefined => {
    onPath.set(party, path.length);
    for (const index of outgoing.get(party) ?? []) {
      const next = debts[index]!.creditor;
      path.push(index);
      if (onPath.has(next)) return path.slice(onPath.get(next));
      if (!done.has(next)) {
        const found = visit(next);
        if (found) return found;
      }
      path.pop();
    }
    onPath.delete(party);
    done.add(party);
    return undefined;
  };

  for (const party of outgoing.keys()) {
    if (done.has(party)) continue;
    const found = visit(party);
    if (found) return found;
  }
  return undefined;
}
