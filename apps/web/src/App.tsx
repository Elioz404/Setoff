import { useState } from "react";

import { LiveHouse } from "./components/LiveHouse.tsx";
import { Simulator } from "./components/Simulator.tsx";
import { liveDeployment, repositoryUrl, scenario } from "./config.ts";

const deployment = liveDeployment();
type View = "live" | "simulator";

export function App() {
  const [view, setView] = useState<View>(deployment ? "live" : "simulator");

  return (
    <>
      <header>
        <p className="eyebrow">Setoff · a clearing house on NEAR</p>
        <h1>Firms that owe each other in circles should not need cash to pay each other.</h1>
        <p className="lead">
          A bakery owes the mill, the mill owes the farm, the farm owes the haulier, and somewhere down the line someone owes the
          bakery. Each invoice waits for cash that is stuck in the next one. Setoff records invoices the debtor has accepted,
          lets solvers compete to cancel the debt that runs in cycles, and leaves only the rest to be paid. A NEAR contract
          accepts a cancellation only if no firm's net position changes, so nobody has to trust the solver.
        </p>
      </header>
      <nav aria-label="View">
        {deployment ? (
          <button type="button" aria-pressed={view === "live"} onClick={() => setView("live")}>
            Live on {deployment.network}
          </button>
        ) : null}
        <button type="button" aria-pressed={view === "simulator"} onClick={() => setView("simulator")}>
          Simulator
        </button>
      </nav>
      <main>{view === "live" && deployment ? <LiveHouse deployment={deployment} /> : <Simulator scenario={scenario} />}</main>
      <footer>
        <p>
          Testnet only; the token has no value. Source, tests and how to check every number on this page:{" "}
          <a href={repositoryUrl}>{repositoryUrl.replace(/^https:\/\//, "")}</a>.
        </p>
      </footer>
    </>
  );
}
