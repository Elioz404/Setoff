import type { Debt } from "./types.ts";

/**
 * Residual view of the debt graph. Every debt gives two arcs: a forward arc
 * that can still clear `outstanding - flow` at a gain of one per unit, and a
 * backward arc that can undo `flow` at a loss of one per unit. A cycle of
 * arcs with more forward than backward arcs is a way to clear more.
 */
interface Arc {
  readonly from: number;
  readonly to: number;
  readonly debt: number;
  readonly forward: boolean;
}

export interface Circulation {
  /** Amount cleared on each debt, by index into the input. */
  readonly flow: readonly bigint[];
  /** False when the iteration bound stopped the search early. */
  readonly optimal: boolean;
}

/**
 * Finds the largest amount of debt that can be cancelled without changing any
 * party's net position: a maximum-weight circulation, computed by cancelling
 * negative cycles in the residual graph until none is left. When none is
 * left the circulation is optimal, which is what `optimal` reports.
 */
export function maximumCirculation(debts: readonly Debt[], maxIterations: number): Circulation {
  const parties = indexParties(debts);
  const flow = debts.map(() => 0n);
  const arcs: Arc[] = debts.flatMap((debt, index) => {
    const from = parties.get(debt.debtor)!;
    const to = parties.get(debt.creditor)!;
    return [
      { from, to, debt: index, forward: true },
      { from: to, to: from, debt: index, forward: false },
    ];
  });

  for (let iteration = 0; iteration < maxIterations; iteration++) {
    const cycle = findNegativeCycle(parties.size, arcs, (arc) => residual(arc, debts, flow));
    if (cycle === undefined) {
      return { flow, optimal: true };
    }
    const amount = cycle.reduce((min, arc) => {
      const capacity = residual(arc, debts, flow);
      return capacity < min ? capacity : min;
    }, residual(cycle[0]!, debts, flow));
    for (const arc of cycle) {
      flow[arc.debt] = flow[arc.debt]! + (arc.forward ? amount : -amount);
    }
  }
  return { flow, optimal: findNegativeCycle(parties.size, arcs, (arc) => residual(arc, debts, flow)) === undefined };
}

function indexParties(debts: readonly Debt[]): Map<string, number> {
  const parties = new Map<string, number>();
  for (const { debtor, creditor } of debts) {
    for (const party of [debtor, creditor]) {
      if (!parties.has(party)) parties.set(party, parties.size);
    }
  }
  return parties;
}

function residual(arc: Arc, debts: readonly Debt[], flow: readonly bigint[]): bigint {
  const cleared = flow[arc.debt]!;
  return arc.forward ? debts[arc.debt]!.outstanding - cleared : cleared;
}

/**
 * Bellman-Ford from a virtual source joined to every party. Forward arcs cost
 * -1, backward arcs +1, and arcs with no residual capacity are skipped. If a
 * distance still drops after `nodes` passes, walking predecessors from that
 * node reaches a negative cycle, which is returned in traversal order.
 */
function findNegativeCycle(nodes: number, arcs: readonly Arc[], capacity: (arc: Arc) => bigint): Arc[] | undefined {
  const distance = new Array<number>(nodes).fill(0);
  const via = new Array<Arc | undefined>(nodes).fill(undefined);
  let updated = -1;
  for (let pass = 0; pass < nodes; pass++) {
    updated = -1;
    for (const arc of arcs) {
      if (capacity(arc) <= 0n) continue;
      const candidate = distance[arc.from]! + (arc.forward ? -1 : 1);
      if (candidate < distance[arc.to]!) {
        distance[arc.to] = candidate;
        via[arc.to] = arc;
        updated = arc.to;
      }
    }
    if (updated === -1) return undefined;
  }

  let node = updated;
  for (let step = 0; step < nodes; step++) node = via[node]!.from;
  const cycle: Arc[] = [];
  let current = node;
  do {
    const arc = via[current]!;
    cycle.push(arc);
    current = arc.from;
  } while (current !== node);
  return cycle.reverse();
}
