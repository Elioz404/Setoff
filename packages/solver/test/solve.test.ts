import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { decompose, isBalanced, liquidityNeeded, maximumCirculation, solve, type Debt } from "../src/index.ts";

const debt = (id: number, debtor: string, creditor: string, outstanding: bigint): Debt => ({
  id: String(id),
  debtor,
  creditor,
  outstanding,
});

const limits = { maxReductions: 64 };

/** Small deterministic generator, so failures reproduce. */
function random(seed: number) {
  let state = seed >>> 0;
  return (below: number) => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state % below;
  };
}

function randomBook(seed: number): Debt[] {
  const next = random(seed);
  const parties = 2 + next(7);
  const count = 1 + next(14);
  const debts: Debt[] = [];
  for (let i = 0; i < count; i++) {
    const debtor = next(parties);
    const creditor = (debtor + 1 + next(parties - 1)) % parties;
    debts.push(debt(i, `firm-${debtor}`, `firm-${creditor}`, BigInt(1 + next(1000))));
  }
  return debts;
}

describe("solve", () => {
  it("clears a triangle by its smallest debt", () => {
    const debts = [debt(0, "a", "b", 100n), debt(1, "b", "c", 80n), debt(2, "c", "a", 60n)];
    const solution = solve(debts, limits);
    assert.equal(solution.cleared, 180n);
    assert.deepEqual(solution.reductions.map((r) => r.amount), [60n, 60n, 60n]);
    assert.equal(solution.optimal, true);
  });

  it("clears nothing when debt only flows one way", () => {
    const debts = [debt(0, "a", "b", 100n), debt(1, "b", "c", 80n)];
    const solution = solve(debts, limits);
    assert.equal(solution.cleared, 0n);
    assert.deepEqual(solution.reductions, []);
  });

  it("beats the greedy choice when cycles share a debt", () => {
    // Clearing the short loop a<->b first would leave only 25 clearable.
    const debts = [debt(0, "a", "b", 10n), debt(1, "b", "a", 5n), debt(2, "b", "c", 10n), debt(3, "c", "a", 10n)];
    const solution = solve(debts, limits);
    assert.equal(solution.cleared, 30n);
    assert.ok(isBalanced(debts, solution.reductions));
  });

  it("ignores debts to oneself and debts already paid", () => {
    const debts = [debt(0, "a", "a", 50n), debt(1, "a", "b", 0n), debt(2, "a", "b", 7n), debt(3, "b", "a", 7n)];
    assert.deepEqual(solve(debts, limits).reductions, [
      { obligation: "2", amount: 7n },
      { obligation: "3", amount: 7n },
    ]);
  });

  it("returns only whole cycles when the proposal must be shorter", () => {
    const debts = [
      debt(0, "a", "b", 9n), debt(1, "b", "a", 9n),
      debt(2, "c", "d", 5n), debt(3, "d", "e", 5n), debt(4, "e", "c", 5n),
    ];
    const solution = solve(debts, { maxReductions: 2 });
    assert.equal(solution.cleared, 18n);
    assert.equal(solution.optimal, false);
    assert.ok(isBalanced(debts, solution.reductions));
  });

  it("refuses limits the clearing house would never accept", () => {
    assert.throws(() => solve([], { maxReductions: 1 }), RangeError);
  });

  it("always proposes a balanced clearing that cannot be improved", () => {
    for (let seed = 1; seed <= 300; seed++) {
      const debts = randomBook(seed);
      const solution = solve(debts, limits);
      if (solution.cleared > 0n) assert.ok(isBalanced(debts, solution.reductions), `seed ${seed}`);
      assert.equal(solution.optimal, true, `seed ${seed}`);
      const rest = debts.map((d) => {
        const r = solution.reductions.find((x) => x.obligation === d.id);
        return { ...d, outstanding: d.outstanding - (r?.amount ?? 0n) };
      });
      assert.equal(solve(rest, limits).cleared, 0n, `seed ${seed}: something was left to clear`);
      assert.equal(liquidityNeeded(rest), liquidityNeeded(debts), `seed ${seed}: net positions changed`);
    }
  });
});

describe("decompose", () => {
  it("splits a circulation into cycles that add back up to it", () => {
    for (let seed = 1; seed <= 100; seed++) {
      const debts = randomBook(seed);
      const { flow } = maximumCirculation(debts, 10_000);
      const sum = debts.map(() => 0n);
      for (const cycle of decompose(debts, flow)) {
        cycle.debts.forEach((index, position) => {
          const next = debts[cycle.debts[(position + 1) % cycle.debts.length]!]!;
          assert.equal(debts[index]!.creditor, next.debtor, `seed ${seed}: cycle is broken`);
          sum[index] = sum[index]! + cycle.amount;
        });
      }
      assert.deepEqual(sum, flow, `seed ${seed}`);
    }
  });
});

describe("isBalanced", () => {
  const debts = [debt(0, "a", "b", 10n), debt(1, "b", "a", 10n)];
  it("accepts a set-off", () => assert.ok(isBalanced(debts, [{ obligation: "0", amount: 4n }, { obligation: "1", amount: 4n }])));
  it("refuses one that moves value", () => assert.ok(!isBalanced(debts, [{ obligation: "0", amount: 4n }, { obligation: "1", amount: 3n }])));
  it("refuses one that exceeds a debt", () => assert.ok(!isBalanced(debts, [{ obligation: "0", amount: 11n }, { obligation: "1", amount: 11n }])));
  it("refuses an empty one", () => assert.ok(!isBalanced(debts, [])));
});

describe("liquidityNeeded", () => {
  it("is what net debtors owe", () => {
    assert.equal(liquidityNeeded([debt(0, "a", "b", 100n), debt(1, "b", "c", 80n), debt(2, "c", "a", 60n)]), 40n);
  });
});
