import { useMemo } from "react";

import { Ledger } from "./components/Ledger.tsx";
import { LiveHouse } from "./components/LiveHouse.tsx";
import { SolverRace } from "./components/SolverRace.tsx";
import { Steps } from "./components/Steps.tsx";
import { Workbench } from "./components/Workbench.tsx";
import { liveDeployment, repositoryUrl, scenario } from "./config.ts";
import { scenarioModel } from "./model/scenarioModel.ts";

const deployment = liveDeployment();

export function App() {
  const model = useMemo(() => scenarioModel(scenario), []);
  const names = useMemo(() => new Map(scenario.firms.map((f) => [f.id, f.name])), []);
  const label = (party: string) => names.get(party) ?? party;

  return (
    <>
      <header className="masthead">
        <a className="wordmark" href="#top" aria-label="Setoff, back to the top">
          Setoff
        </a>
        <nav aria-label="Sections">
          <a href="#how">How it works</a>
          <a href="#race">Solvers</a>
          <a href="#invoices">Invoices</a>
          {deployment ? <a href="#live">Live on {deployment.network}</a> : null}
          <a href={repositoryUrl}>Source</a>
        </nav>
      </header>
      <main id="top">
        <Workbench scenario={scenario} model={model} label={label} />
        <Steps />
        <SolverRace scenario={scenario} model={model} />
        <section className="band" aria-labelledby="invoices">
          <div className="band-head">
            <h2 id="invoices">Every invoice, before and after</h2>
            <p>The same clearing as the graph above, line by line. Each loop is cancelled by the same amount on every invoice in it.</p>
          </div>
          <Ledger book={model.book} label={label} decimals={scenario.decimals} caption={`Demo scenario, amounts in ${scenario.symbol}`} />
        </section>
        {deployment ? <LiveHouse deployment={deployment} /> : null}
      </main>
      <footer className="colophon">
        <p className="wordmark">Setoff</p>
        <p>
          A clearing house contract on NEAR testnet, built at NEAR HACKATHON. The {scenario.symbol} token has no value. Code, tests
          and how to check every figure: <a href={repositoryUrl}>{repositoryUrl.replace(/^https:\/\//, "")}</a>.
        </p>
      </footer>
    </>
  );
}
