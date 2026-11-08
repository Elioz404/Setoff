import { formatAmount } from "@setoff/house-client";

import type { BookTotals } from "../model/book.ts";

interface Props {
  readonly totals: BookTotals;
  readonly decimals: number;
  readonly symbol: string;
}

export function Totals({ totals, decimals, symbol }: Props) {
  const amount = (value: bigint) => `${formatAmount(value, decimals)} ${symbol}`;
  return (
    <dl className="totals">
      <div>
        <dt>Debt between the firms</dt>
        <dd>{amount(totals.gross)}</dd>
      </div>
      <div className="highlight">
        <dt>Cancelled by set-off</dt>
        <dd>
          {amount(totals.cleared)} <small>{(totals.clearedPermille / 10).toFixed(1)}%, no money moved</small>
        </dd>
      </div>
      <div>
        <dt>Left to pay</dt>
        <dd>{amount(totals.toPay)}</dd>
      </div>
      <div>
        <dt>Owed on net</dt>
        <dd>
          {amount(totals.floor)} <small>set-off never goes below this</small>
        </dd>
      </div>
    </dl>
  );
}
