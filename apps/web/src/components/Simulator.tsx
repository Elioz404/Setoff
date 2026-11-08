import { useMemo, useState } from "react";

import { formatAmount, parseAmount } from "@setoff/house-client";
import { solve, solveGreedy, type Debt } from "@setoff/solver";

import type { ScenarioData } from "../config.ts";
import { bookFrom, totalsOf, type Entry } from "../model/book.ts";
import { DebtGraph } from "./DebtGraph.tsx";
import { Totals } from "./Totals.tsx";

const strategies = {
  optimal: { solve, title: "Optimal solver", note: "maximum circulation: no clearing removes more" },
  greedy: { solve: solveGreedy, title: "Greedy solver", note: "cancels cycles in the order it finds them" },
} as const;

type StrategyName = keyof typeof strategies;

/** Runs the same solver the agents use on the demo scenario, in the browser. */
export function Simulator({ scenario }: { readonly scenario: ScenarioData }) {
  const [strategy, setStrategy] = useState<StrategyName>("optimal");
  const [side, setSide] = useState<"before" | "after">("before");

  const entries: Entry[] = useMemo(
    () =>
      scenario.obligations.map((o, index) => ({
        id: String(index),
        debtor: o.debtor,
        creditor: o.creditor,
        amount: parseAmount(o.amount, scenario.decimals),
        reference: o.reference,
      })),
    [scenario],
  );
  const solutions = useMemo(() => {
    const debts: Debt[] = entries.map((e) => ({ id: e.id, debtor: e.debtor, creditor: e.creditor, outstanding: e.amount }));
    const limits = { maxReductions: scenario.maxReductions };
    return { optimal: strategies.optimal.solve(debts, limits), greedy: strategies.greedy.solve(debts, limits) };
  }, [entries, scenario.maxReductions]);

  const solution = solutions[strategy];
  const book = useMemo(() => bookFrom(entries, solution.reductions), [entries, solution]);
  const names = new Map(scenario.firms.map((f) => [f.id, f.name]));
  const label = (party: string) => names.get(party) ?? party;
  const amount = (value: bigint) => `${formatAmount(value, scenario.decimals)} ${scenario.symbol}`;

  return (
    <section aria-labelledby="simulator">
      <h2 id="simulator">Try it: {scenario.name.toLowerCase()}</h2>
      <p className="lead">
        Each arrow is an invoice the debtor has accepted. Press <em>Clear</em> to run a solver: it cancels debt that runs in a
        circle, by the same amount on every invoice in the circle, so no firm ends up owing more or less on net.
      </p>
      <div className="controls">
        <div role="group" aria-label="Solver">
          {(Object.keys(strategies) as StrategyName[]).map((name) => (
            <button key={name} type="button" aria-pressed={strategy === name} onClick={() => setStrategy(name)}>
              {strategies[name].title}
            </button>
          ))}
        </div>
        <button type="button" className="primary" onClick={() => setSide(side === "before" ? "after" : "before")}>
          {side === "before" ? "Clear" : "Show the debts again"}
        </button>
      </div>
      <p className="note">
        {strategies[strategy].title}: {strategies[strategy].note}. It clears {amount(solution.cleared)}
        {strategy === "greedy" ? `, ${amount(solutions.optimal.cleared - solution.cleared)} less than the optimal solver, which would outbid it.` : "."}
      </p>
      <div className="split">
        <DebtGraph book={book} side={side} label={label} decimals={scenario.decimals} symbol={scenario.symbol} />
        <Totals totals={totalsOf(book, side)} decimals={scenario.decimals} symbol={scenario.symbol} />
      </div>
      <details>
        <summary>The {solution.reductions.length} reductions this solver proposes</summary>
        <table>
          <thead>
            <tr>
              <th>Invoice</th>
              <th>Debtor</th>
              <th>Creditor</th>
              <th className="num">Owed</th>
              <th className="num">Cancelled</th>
            </tr>
          </thead>
          <tbody>
            {solution.reductions.map((r) => {
              const entry = entries[Number(r.obligation)]!;
              return (
                <tr key={r.obligation}>
                  <td>{entry.reference}</td>
                  <td>{label(entry.debtor)}</td>
                  <td>{label(entry.creditor)}</td>
                  <td className="num">{formatAmount(entry.amount, scenario.decimals)}</td>
                  <td className="num">{formatAmount(r.amount, scenario.decimals)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </details>
    </section>
  );
}
