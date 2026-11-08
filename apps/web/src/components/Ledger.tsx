import { formatAmount } from "@setoff/house-client";

import type { Book } from "../model/book.ts";

interface Props {
  readonly book: Book;
  readonly label: (party: string) => string;
  readonly decimals: number;
  readonly caption: string;
}

/** Every invoice with what set-off cancelled and what is left: the graph as a table. */
export function Ledger({ book, label, decimals, caption }: Props) {
  const amount = (value: bigint) => formatAmount(value, decimals);
  return (
    <div className="ledger">
      <table>
        <caption>{caption}</caption>
        <thead>
          <tr>
            <th scope="col">Invoice</th>
            <th scope="col">Debtor</th>
            <th scope="col">Creditor</th>
            <th scope="col" className="num">
              Owed
            </th>
            <th scope="col" className="num">
              Cancelled
            </th>
            <th scope="col" className="num">
              Left to pay
            </th>
          </tr>
        </thead>
        <tbody>
          {book.edges.map((edge) => (
            <tr key={edge.id}>
              <td>{edge.reference}</td>
              <td>{label(edge.debtor)}</td>
              <td>{label(edge.creditor)}</td>
              <td className="num">{amount(edge.before)}</td>
              <td className="num">{edge.before === edge.after ? "" : amount(edge.before - edge.after)}</td>
              <td className="num">{amount(edge.after)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
