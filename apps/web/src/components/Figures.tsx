import { formatAmount } from "@setoff/house-client";

import type { BookTotals } from "../model/book.ts";

interface Props {
  readonly totals: BookTotals;
  readonly decimals: number;
  readonly symbol: string;
  /** Tokens already paid towards what set-off left, when the figures describe a live house. */
  readonly paid?: bigint;
}

/** The amounts that tell the story, in the order money flows through them. */
export function Figures({ totals, decimals, symbol, paid }: Props) {
  const amount = (value: bigint) => formatAmount(value, decimals);
  const figure = (value: bigint) => (
    <dd>
      {amount(value)} <span className="unit">{symbol}</span>
    </dd>
  );
  return (
    <dl className="figures">
      <div>
        <dt>Owed between the firms</dt>
        {figure(totals.gross)}
      </div>
      <div className="figure-accent">
        <dt>Cancelled, no money moved</dt>
        {figure(totals.cleared)}
        <p className="figure-note">{(totals.clearedPermille / 10).toFixed(1)}% of the debt</p>
      </div>
      {paid === undefined ? (
        <div>
          <dt>Left to pay</dt>
          {figure(totals.toPay)}
          <p className="figure-note">at least {amount(totals.floor)} always remains: what the net debtors owe</p>
        </div>
      ) : (
        <>
          <div>
            <dt>Paid in {symbol}</dt>
            {figure(paid)}
          </div>
          <div>
            <dt>Still owed</dt>
            {figure(totals.toPay - paid)}
          </div>
        </>
      )}
    </dl>
  );
}
