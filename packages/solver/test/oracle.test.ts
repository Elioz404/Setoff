import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { solve, solveGreedy, type Debt } from "../src/index.ts";

/**
 * The most debt any clearing can cancel, found by trying every integer
 * reduction of every debt and keeping the largest that leaves every party's
 * net position unchanged. Exponential, so only for small books, but it shares
 * no code with the solver: it is the definition, not an algorithm.
 */
function bruteForceMaximum(debts: readonly Debt[]): bigint {
  const amounts = debts.map((d) => Number(d.outstanding));
  const chosen = new Array<number>(debts.length).fill(0);
  let best = 0;
  const visit = (index: number) => {
    if (index === debts.length) {
      const net = new Map<string, number>();
      debts.forEach((d, i) => {
        net.set(d.debtor, (net.get(d.debtor) ?? 0) + chosen[i]!);
        net.set(d.creditor, (net.get(d.creditor) ?? 0) - chosen[i]!);
      });
      if ([...net.values()].every((v) => v === 0)) best = Math.max(best, chosen.reduce((a, b) => a + b, 0));
      return;
    }
    for (let amount = 0; amount <= amounts[index]!; amount++) {
      chosen[index] = amount;
      visit(index + 1);
    }
  };
  visit(0);
  return BigInt(best);
}

function smallBook(seed: number): Debt[] {
  let state = seed >>> 0;
  const next = (below: number) => {
    state = (Math.imul(state, 1103515245) + 12345) >>> 0;
    return (state >>> 8) % below;
  };
  const parties = 2 + next(3);
  const count = 2 + next(5);
  return Array.from({ length: count }, (_, id) => {
    const debtor = next(parties);
    return {
      id: String(id),
      debtor: `p${debtor}`,
      creditor: `p${(debtor + 1 + next(parties - 1)) % parties}`,
      outstanding: BigInt(1 + next(3)),
    };
  });
}

describe("solve against brute force", () => {
  it("finds the true maximum on 500 small books", () => {
    let withCycles = 0;
    for (let seed = 1; seed <= 500; seed++) {
      const debts = smallBook(seed);
      const expected = bruteForceMaximum(debts);
      if (expected > 0n) withCycles++;
      assert.equal(solve(debts, { maxReductions: 64 }).cleared, expected, `seed ${seed}`);
      assert.ok(solveGreedy(debts, { maxReductions: 64 }).cleared <= expected, `seed ${seed}`);
    }
    // Most generated books must contain a cycle, or the comparison proves little.
    assert.ok(withCycles > 250, `only ${withCycles} books had anything to clear`);
  });
});
