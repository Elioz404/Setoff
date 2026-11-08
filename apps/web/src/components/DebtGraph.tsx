import { useMemo } from "react";

import { formatAmount } from "@setoff/house-client";

import type { Book } from "../model/book.ts";
import { circleLayout, curvedEdge, strokeWidth } from "../model/layout.ts";

interface Props {
  readonly book: Book;
  readonly side: "before" | "after";
  readonly label: (party: string) => string;
  readonly decimals: number;
  readonly symbol: string;
}

const SIZE = 520;
const RADIUS = 190;
const NODE = 30;

/** The debts between parties as arrows from debtor to creditor, thicker for larger amounts. */
export function DebtGraph({ book, side, label, decimals, symbol }: Props) {
  const points = useMemo(() => circleLayout(book.parties, { x: SIZE / 2, y: SIZE / 2 }, RADIUS), [book.parties]);
  const largest = book.edges.reduce((max, e) => (e.before > max ? e.before : max), 0n);

  return (
    <svg className="graph" viewBox={`0 0 ${SIZE} ${SIZE}`} role="img" aria-label={`Debts ${side === "before" ? "before" : "after"} set-off`}>
      <defs>
        <marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z" className="arrowhead" />
        </marker>
      </defs>
      {book.edges.map((edge) => {
        const amount = edge[side];
        const from = points.get(edge.debtor)!;
        const to = points.get(edge.creditor)!;
        const cleared = side === "after" && amount < edge.before;
        return (
          <g key={edge.id} className={amount === 0n ? "edge gone" : cleared ? "edge reduced" : "edge"}>
            <title>{`${label(edge.debtor)} owes ${label(edge.creditor)} ${formatAmount(amount, decimals)} ${symbol}${edge.reference ? ` (${edge.reference})` : ""}`}</title>
            <path
              d={curvedEdge(from, to, 28, NODE + 4)}
              strokeWidth={amount === 0n ? 1 : strokeWidth(amount, largest)}
              markerEnd={amount === 0n ? undefined : "url(#arrow)"}
            />
          </g>
        );
      })}
      {book.parties.map((party) => {
        const p = points.get(party)!;
        const outside = { x: SIZE / 2 + (p.x - SIZE / 2) * 1.24, y: SIZE / 2 + (p.y - SIZE / 2) * 1.2 };
        return (
          <g key={party} className="party">
            <circle cx={p.x} cy={p.y} r={NODE} />
            <text x={p.x} y={p.y} dy="0.35em" textAnchor="middle" className="initials">
              {initials(label(party))}
            </text>
            <text x={outside.x} y={outside.y} dy="0.35em" textAnchor="middle" className="name">
              {label(party)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter((word) => /^[A-Z]/.test(word))
    .slice(0, 2)
    .map((word) => word[0])
    .join("");
}
