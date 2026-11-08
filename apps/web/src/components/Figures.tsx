import { formatAmount } from "@setoff/house-client";

import type { BookTotals } from "../model/book.ts";

interface Props {
  readonly totals: BookTotals;
  readonly decimals: number;
  readonly symbol: string;
}

/** The three amounts that tell the story, side by side, in the order money flows through them. */
export function Figures({ totals, decimals, symbol }: Props) {
  const amount = (value: bigint) => formatAmount(value, decimals);
  return (
    <dl className="figures">
      <div>
        <dt>Owed between the firms</dt>
        <dd>
          {amount(totals.gross)} <span className="unit">{symbol}</span>
        </dd>
      </div>
      <div className="figure-accent">
        <dt>Cancelled, no money moved</dt>
        <dd>
          {amount(totals.cleared)} <span className="unit">{symbol}</span>
        </dd>
        <p className="figure-note">{(totals.clearedPermille / 10).toFixed(1)}% of the debt</p>
      </div>
      <div>
        <dt>Left to pay</dt>
        <dd>
          {amount(totals.toPay)} <span className="unit">{symbol}</span>
        </dd>
        <p className="figure-note">
          at least {amount(totals.floor)} always remains: what the net debtors owe
        </p>
      </div>
    </dl>
  );
}
