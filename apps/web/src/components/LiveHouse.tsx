import { useEffect, useMemo, useState } from "react";

import { formatAmount, type ObligationView } from "@setoff/house-client";

import { explorerAccountUrl, type Deployment } from "../config.ts";
import { useLiveHouse, type LiveState } from "../data/useLiveHouse.ts";
import { bookFrom, totalsOf, type Entry } from "../model/book.ts";
import { DebtGraph } from "./DebtGraph.tsx";
import { Figures } from "./Figures.tsx";
import { Ledger } from "./Ledger.tsx";

const accepted = new Set(["active", "discharged"]);

/** The clearing house on chain, read from its contract every few seconds. */
export function LiveHouse({ deployment }: { readonly deployment: Deployment }) {
  const live = useLiveHouse(deployment);
  return (
    <section className="band" aria-labelledby="live">
      <div className="band-head">
        <h2 id="live">Live on {deployment.network}</h2>
        <p>
          Read from <a href={explorerAccountUrl(deployment.network, deployment.house)}>{deployment.house}</a> every five seconds.
          Amounts are in {deployment.token.symbol}, a test token with no value.
        </p>
      </div>
      {live.status === "loading" ? <p className="status">Reading the contract…</p> : null}
      {live.status === "failed" ? (
        <p className="status status-error" role="alert">
          Could not read the contract: {live.error}. The page tries again in five seconds.
        </p>
      ) : null}
      {live.status === "ready" ? <LiveView deployment={deployment} state={live.state} {...(live.error ? { error: live.error } : {})} /> : null}
    </section>
  );
}

function LiveView({ deployment, state, error }: { readonly deployment: Deployment; readonly state: LiveState; readonly error?: string }) {
  const [preview, setPreview] = useState(false);
  const { decimals, symbol } = deployment.token;
  const names = useMemo(() => new Map(deployment.firms.map((f) => [f.account, f.name])), [deployment.firms]);
  const label = (account: string) => names.get(account) ?? account;
  const amount = (value: bigint | string) => `${formatAmount(BigInt(value), decimals)} ${symbol}`;

  const obligations = useMemo(
    () => state.obligations.filter((o) => o.asset === deployment.token.account && accepted.has(o.status)),
    [state.obligations, deployment.token.account],
  );
  const best = state.round.best;
  const book = useMemo(() => {
    const pending = new Map(preview && best ? best.reductions.map((r) => [r.obligation, BigInt(r.amount)]) : []);
    return bookFrom(
      entriesOf(obligations),
      obligations.map((o) => ({ obligation: o.id, amount: BigInt(o.cleared) + (pending.get(o.id) ?? 0n) })),
    );
  }, [obligations, best, preview]);

  return (
    <>
      {error ? (
        <p className="status status-error" role="alert">
          The last refresh failed ({error}); showing the reading from {state.readAt.toLocaleTimeString()}.
        </p>
      ) : null}
      <Round state={state} amount={amount} label={label} preview={preview} onPreview={setPreview} />
      <div className="live-grid">
        <figure className="stage">
          <DebtGraph book={book} cleared label={label} decimals={decimals} symbol={symbol} />
        </figure>
        <Figures totals={totalsOf(book)} decimals={decimals} symbol={symbol} />
      </div>
      <Ledger book={book} label={label} decimals={decimals} caption={`${obligations.length} accepted invoices on ${deployment.network}`} />
    </>
  );
}

function entriesOf(obligations: readonly ObligationView[]): Entry[] {
  return obligations.map((o) => ({ id: o.id, debtor: o.debtor, creditor: o.creditor, amount: BigInt(o.amount), reference: o.reference }));
}

interface RoundProps {
  readonly state: LiveState;
  readonly amount: (value: bigint | string) => string;
  readonly label: (account: string) => string;
  readonly preview: boolean;
  readonly onPreview: (preview: boolean) => void;
}

function Round({ state, amount, label, preview, onPreview }: RoundProps) {
  const { round, solvers, rewardPool, config } = state;
  const now = useNow();
  const closesAt = round.closes_at_ns ? Number(BigInt(round.closes_at_ns) / 1_000_000n) : undefined;
  const secondsLeft = closesAt === undefined ? undefined : Math.max(0, Math.ceil((closesAt - now) / 1000));

  return (
    <div className="round">
      <div>
        <h3>Round {round.id}</h3>
        {round.best ? (
          <p>
            {label(round.best.solver)} leads, cancelling {amount(round.best.cleared)} across {round.best.reductions.length} invoices.{" "}
            {secondsLeft ? `Open to better proposals for ${secondsLeft} s.` : "Closed; the next solver step applies it."}
          </p>
        ) : (
          <p>No proposal yet. Solvers propose as soon as accepted invoices form a cycle.</p>
        )}
        {round.best ? (
          <label className="check">
            <input type="checkbox" checked={preview} onChange={(e) => onPreview(e.target.checked)} />
            Draw the graph as if this proposal were applied
          </label>
        ) : null}
      </div>
      <div>
        <h3>Solvers</h3>
        {solvers.length === 0 ? (
          <p>No round won yet.</p>
        ) : (
          <ul className="plain">
            {solvers.map((s) => (
              <li key={s.solver}>
                {label(s.solver)}: {s.stats.rounds_won} won, {amount(s.stats.cleared)} cancelled
              </li>
            ))}
          </ul>
        )}
        <p className="muted">
          Reward pool {amount(rewardPool)}; winners earn {config.reward_bps / 100}% of what they cancel.
        </p>
      </div>
    </div>
  );
}

function useNow(): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return now;
}
