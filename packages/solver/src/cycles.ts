import type { Debt } from "./types.ts";

/** A debt cycle: each debt's creditor is the next debt's debtor. */
export interface Cycle {
  /** Indices into the debt list, in order around the cycle. */
  readonly debts: readonly number[];
  /** Amount the cycle clears on each of its debts. */
  readonly amount: bigint;
}

/**
 * Splits a circulation into simple cycles. Each step follows debts with flow
 * left from party to party until it returns to a party already visited, and
 * takes the smallest flow along that loop off every debt in it, so every step
 * empties at least one debt and the split ends after at most one cycle per debt.
 */
export function decompose(debts: readonly Debt[], circulation: readonly bigint[]): Cycle[] {
  const remaining = [...circulation];
  const outgoing = new Map<string, number[]>();
  debts.forEach((debt, index) => {
    const list = outgoing.get(debt.debtor) ?? [];
    list.push(index);
    outgoing.set(debt.debtor, list);
  });
  const nextWithFlow = (party: string) => outgoing.get(party)?.find((index) => remaining[index]! > 0n);

  const cycles: Cycle[] = [];
  for (let start = 0; start < debts.length; start++) {
    while (remaining[start]! > 0n) {
      const path: number[] = [];
      const seenAt = new Map<string, number>();
      let edge: number | undefined = start;
      let party = debts[start]!.debtor;
      while (edge !== undefined && !seenAt.has(party)) {
        seenAt.set(party, path.length);
        path.push(edge);
        party = debts[edge]!.creditor;
        edge = seenAt.has(party) ? undefined : nextWithFlow(party);
      }
      if (!seenAt.has(party)) {
        throw new Error("flow is not a circulation: a debt with flow leads to a party with no flow out");
      }
      const loop = path.slice(seenAt.get(party));
      const amount = loop.reduce((min, index) => (remaining[index]! < min ? remaining[index]! : min), remaining[loop[0]!]!);
      for (const index of loop) remaining[index] = remaining[index]! - amount;
      cycles.push({ debts: loop, amount });
    }
  }
  return cycles;
}

/**
 * Keeps whole cycles, largest first, while the debts they touch fit within
 * `maxDebts`. A sum of cycles is still a circulation, so the result is always
 * a valid clearing, just possibly a smaller one.
 */
export function selectWithin(cycles: readonly Cycle[], maxDebts: number): Cycle[] {
  const byValue = [...cycles].sort((a, b) => {
    const va = a.amount * BigInt(a.debts.length);
    const vb = b.amount * BigInt(b.debts.length);
    return va === vb ? 0 : va > vb ? -1 : 1;
  });
  const touched = new Set<number>();
  const chosen: Cycle[] = [];
  for (const cycle of byValue) {
    const added = cycle.debts.filter((index) => !touched.has(index));
    if (touched.size + added.length > maxDebts) continue;
    added.forEach((index) => touched.add(index));
    chosen.push(cycle);
  }
  return chosen;
}
