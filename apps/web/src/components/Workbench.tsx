import { useState } from "react";

import type { ScenarioData } from "../config.ts";
import { totalsOf } from "../model/book.ts";
import type { ScenarioModel } from "../model/scenarioModel.ts";
import { DebtGraph } from "./DebtGraph.tsx";
import { Figures } from "./Figures.tsx";

interface Props {
  readonly scenario: ScenarioData;
  readonly model: ScenarioModel;
  readonly label: (party: string) => string;
}

/** The first screen: the claim, and the invoices it is about, cleared on request. */
export function Workbench({ scenario, model, label }: Props) {
  const [cleared, setCleared] = useState(false);
  const side = cleared ? "after" : "before";

  return (
    <section className="workbench" aria-labelledby="claim">
      <div className="claim">
        <h1 id="claim">Cancel the debt that runs in circles.</h1>
        <p className="claim-line">Firms that owe each other in a loop pay only what is left.</p>
        <div className="actions">
          <button type="button" className="button-primary" aria-pressed={cleared} onClick={() => setCleared(!cleared)}>
            {cleared ? "Show the invoices again" : "Clear the debts"}
          </button>
          <a className="button-quiet" href="#how">
            How it works
          </a>
        </div>
      </div>
      <figure className="stage">
        <DebtGraph book={model.book} cleared={cleared} label={label} decimals={scenario.decimals} symbol={scenario.symbol} />
        <figcaption>
          Demo: eight firms, {model.entries.length} accepted invoices in {scenario.symbol}, a test token. Arrows run from debtor to
          creditor; net positions never change.
        </figcaption>
      </figure>
      <Figures totals={totalsOf(model.book, side)} decimals={scenario.decimals} symbol={scenario.symbol} />
    </section>
  );
}
