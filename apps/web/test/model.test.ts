import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { solve } from "@setoff/solver";

import { bookFrom, netPositions, totalsOf, type Entry } from "../src/model/book.ts";
import { circleLayout, curvedEdge, strokeWidth } from "../src/model/layout.ts";
import { scenarioModel } from "../src/model/scenarioModel.ts";
import { scenario } from "./scenario.fixture.ts";

const entries: Entry[] = [
  { id: "0", debtor: "a", creditor: "b", amount: 100n, reference: "" },
  { id: "1", debtor: "b", creditor: "c", amount: 80n, reference: "" },
  { id: "2", debtor: "c", creditor: "a", amount: 60n, reference: "" },
];

describe("book", () => {
  const debts = entries.map((e) => ({ id: e.id, debtor: e.debtor, creditor: e.creditor, outstanding: e.amount }));
  const book = bookFrom(entries, solve(debts, { maxReductions: 16 }).reductions);

  it("shows what is left after set-off", () => {
    assert.deepEqual(book.edges.map((e) => e.after), [40n, 20n, 0n]);
    assert.deepEqual(totalsOf(book), { gross: 240n, cleared: 180n, toPay: 60n, floor: 40n, clearedPermille: 750 });
  });

  it("never changes a net position", () => {
    assert.deepEqual(netPositions(book, "after"), netPositions(book, "before"));
  });

  it("refuses a reduction larger than its obligation", () => {
    assert.throws(() => bookFrom(entries, [{ obligation: "2", amount: 61n }]));
  });
});

describe("layout", () => {
  it("puts the first party at the top of the circle", () => {
    const points = circleLayout(["a", "b", "c", "d"], { x: 100, y: 100 }, 50);
    assert.deepEqual(points.get("a"), { x: 100, y: 50 });
    assert.ok(Math.abs(points.get("b")!.x - 150) < 1e-9);
  });

  it("draws an edge as one quadratic curve", () => {
    assert.match(curvedEdge({ x: 0, y: 0 }, { x: 100, y: 0 }, 20, 10), /^M10,0 Q50,-20 90,0$/);
  });

  it("scales strokes by area and hides empty edges", () => {
    assert.equal(strokeWidth(0n, 100n), 0);
    assert.equal(strokeWidth(100n, 100n), 12);
    assert.ok(strokeWidth(25n, 100n) < strokeWidth(100n, 100n) / 2 + 1.5);
  });
});

describe("scenario model", () => {
  it("clears the demo scenario as the README says", () => {
    const model = scenarioModel(scenario);
    const totals = totalsOf(model.book);
    assert.equal(totals.gross, 63_600_000_000n);
    assert.equal(totals.cleared, 40_900_000_000n);
    assert.equal(model.greedy.cleared, 38_500_000_000n);
    assert.deepEqual(netPositions(model.book, "after"), netPositions(model.book, "before"));
  });
});
