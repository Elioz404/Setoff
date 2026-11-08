import { formatAmount } from "@setoff/house-client";

import type { ScenarioData } from "../config.ts";
import type { ScenarioModel } from "../model/scenarioModel.ts";

interface Props {
  readonly scenario: ScenarioData;
  readonly model: ScenarioModel;
}

/** What two solver strategies cancel on the same invoices, against the debt there was. */
export function SolverRace({ scenario, model }: Props) {
  const gross = model.entries.reduce((sum, e) => sum + e.amount, 0n);
  const amount = (value: bigint) => `${formatAmount(value, scenario.decimals)} ${scenario.symbol}`;
  const share = (value: bigint) => (gross === 0n ? 0 : Number((value * 10_000n) / gross) / 100);
  const rows = [
    { name: "Optimal solver", detail: "maximum circulation", value: model.optimal.cleared, kind: "accent" },
    { name: "Greedy solver", detail: "first cycle found, repeated", value: model.greedy.cleared, kind: "ink" },
    { name: "All invoices", detail: "for scale", value: gross, kind: "rule" },
  ] as const;

  return (
    <section className="band" aria-labelledby="race">
      <div className="band-head">
        <h2 id="race">Solvers compete for each round</h2>
        <p>
          The greedy solver locks in a cycle that blocks a better one. The optimal solver outbids it by{" "}
          {amount(model.optimal.cleared - model.greedy.cleared)}, and the contract keeps the larger clearing.
        </p>
      </div>
      <ul className="bars" aria-label="Debt cancelled by each solver">
        {rows.map((row) => (
          <li key={row.name}>
            <span className="bar-label">
              {row.name} <span className="bar-detail">{row.detail}</span>
            </span>
            <span className="bar-track">
              <span className={`bar bar-${row.kind}`} style={{ width: `${share(row.value)}%` }} />
            </span>
            <span className="bar-value">{amount(row.value)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
