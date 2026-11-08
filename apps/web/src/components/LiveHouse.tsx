import { useEffect, useMemo, useState } from "react";

import { formatAmount, type ObligationView } from "@setoff/house-client";

import { explorerAccountUrl, type Deployment } from "../config.ts";
import { useLiveHouse, type LiveState } from "../data/useLiveHouse.ts";
import { bookFrom, totalsOf, type Entry } from "../model/book.ts";
import { DebtGraph } from "./DebtGraph.tsx";
import { Totals } from "./Totals.tsx";

const accepted = new Set(["active", "discharged"]);

/** The clearing house on testnet, as its contract reports it. */
export function LiveHouse({ deployment }: { readonly deployment: Deployment }) {
  const live = useLiveHouse(deployment);
  if (live.status === "loading") return <p className="note">Reading the clearing house on {deployment.network}…</p>;
  if (live.status === "failed") return <p className="error">Could not read {deployment.house}: {live.error}</p>;
  return <LiveView deployment={deployment} state={live.state} {...(live.error ? { error: live.error } : {})} />;
}

function LiveView({ deployment, state, error }: { readonly deployment: Deployment; readonly state: LiveState; readonly error?: string }) {
  const [preview, setPreview] = useState(false);
  const { decimals, symbol } = deployment.token;
  const names = new Map(deployment.firms.map((f) => [f.account, f.name]));
  const label = (account: string) => names.get(account) ?? account;
  const amount = (value: bigint | string) => `${formatAmount(BigInt(value), decimals)} ${symbol}`;

  const obligations = useMemo(
    () => state.obligations.filter((o) => o.asset === deployment.token.account && accepted.has(o.status)),
    [state.obligations, deployment.token.account],
  );
  const settled = useMemo(() => bookFrom(entriesOf(obligations), obligations.map((o) => ({ obligation: o.id, amount: BigInt(o.cleared) }))), [obligations]);
  const best = state.round.best;
  const previewed = useMemo(() => {
    if (!best) return settled;
    const pending = new Map(best.reductions.map((r) => [r.obligation, BigInt(r.amount)]));
    return bookFrom(entriesOf(obligations), obligations.map((o) => ({ obligation: o.id, amount: BigInt(o.cleared) + (pending.get(o.id) ?? 0n) })));
  }, [best, obligations, settled]);
  const book = preview && best ? previewed : settled;

  return (
    <section aria-labelledby="live">
      <h2 id="live">Live on {deployment.network}</h2>
      <p className="lead">
        Read straight from the contract <a href={explorerAccountUrl(deployment.network, deployment.house)}>{deployment.house}</a> every
        few seconds. Amounts are in {symbol}, a test token with no value.
      </p>
      {error ? <p className="error">Last refresh failed: {error}</p> : null}
      <Round state={state} amount={amount} label={label} preview={preview} onPreview={setPreview} />
      <div className="split">
        <DebtGraph book={book} side="after" label={label} decimals={decimals} symbol={symbol} />
        <Totals totals={totalsOf(book)} decimals={decimals} symbol={symbol} />
      </div>
      <ObligationTable obligations={obligations} label={label} decimals={decimals} />
      <p className="note">Last read {state.readAt.toLocaleTimeString()}.</p>
    </section>
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
  const { round, solvers, rewardPool } = state;
  const closesAt = round.closes_at_ns ? Number(BigInt(round.closes_at_ns) / 1_000_000n) : undefined;
  const now = useNow();
  return (
    <div className="round">
      <div>
        <h3>Round {round.id}</h3>
        {round.best ? (
          <p>
            Best proposal: <strong>{label(round.best.solver)}</strong> cancels {amount(round.best.cleared)} over{" "}
            {round.best.reductions.length} invoices.{" "}
            {closesAt !== undefined && closesAt > now ? `Open to better proposals for ${Math.ceil((closesAt - now) / 1000)} s.` : "Closed: the next solver step applies it."}
          </p>
        ) : (
          <p>No proposal yet. Solvers propose as soon as accepted invoices form a cycle.</p>
        )}
        {round.best ? (
          <label className="toggle">
            <input type="checkbox" checked={preview} onChange={(e) => onPreview(e.target.checked)} /> Show the graph as if this proposal were applied
          </label>
        ) : null}
      </div>
      <div>
        <h3>Solvers</h3>
        {solvers.length === 0 ? (
          <p>No round won yet.</p>
        ) : (
          <ul className="solvers">
            {solvers.map((s) => (
              <li key={s.solver}>
                {label(s.solver)}: {s.stats.rounds_won} rounds won, {amount(s.stats.cleared)} cancelled
              </li>
            ))}
          </ul>
        )}
        <p className="note">Reward pool: {amount(rewardPool)}, paid to winners at {state.config.reward_bps / 100}% of what they cancel.</p>
      </div>
    </div>
  );
}

function ObligationTable({ obligations, label, decimals }: { readonly obligations: readonly ObligationView[]; readonly label: (a: string) => string; readonly decimals: number }) {
  const value = (v: string) => formatAmount(BigInt(v), decimals);
  return (
    <details>
      <summary>All {obligations.length} accepted invoices</summary>
      <table>
        <thead>
          <tr>
            <th>#</th>
            <th>Invoice</th>
            <th>Debtor</th>
            <th>Creditor</th>
            <th className="num">Amount</th>
            <th className="num">Cancelled</th>
            <th className="num">Paid</th>
            <th className="num">Owed</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {obligations.map((o) => (
            <tr key={o.id}>
              <td>{o.id}</td>
              <td>{o.reference}</td>
              <td>{label(o.debtor)}</td>
              <td>{label(o.creditor)}</td>
              <td className="num">{value(o.amount)}</td>
              <td className="num">{value(o.cleared)}</td>
              <td className="num">{value((BigInt(o.amount) - BigInt(o.cleared) - BigInt(o.outstanding)).toString())}</td>
              <td className="num">{value(o.outstanding)}</td>
              <td>{o.status}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
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
