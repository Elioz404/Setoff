import { useId, useMemo } from "react";

import { formatAmount } from "@setoff/house-client";

import { netPositions, type Book } from "../model/book.ts";
import { useMediaQuery } from "../hooks/useMediaQuery.ts";
import { circleLayout, curvedEdge, strokeWidth } from "../model/layout.ts";

interface Props {
  readonly book: Book;
  /** Before set-off every invoice shows in full; after it, what was cancelled fades to the accent. */
  readonly cleared: boolean;
  readonly label: (party: string) => string;
  readonly decimals: number;
  readonly symbol: string;
}

const WIDTH = 720;
const NODE = 6;
const LABEL_GAP = 18;
const BOW = 0.14;

/**
 * On a phone the drawing shrinks to under half its size, so it draws a
 * tighter circle and labels each firm by its first word, set larger.
 */
const geometry = {
  wide: { radius: 215, height: 560, nameSize: 14, netSize: 12.5 },
  compact: { radius: 165, height: 480, nameSize: 25, netSize: 22 },
} as const;

/**
 * Invoices as arrows from debtor to creditor, drawn by amount. Each party
 * carries its net position, which set-off never changes, so the numbers stay
 * put while the arrows thin out.
 */
export function DebtGraph({ book, cleared, label, decimals, symbol }: Props) {
  const marker = useId();
  const compact = useMediaQuery("(max-width: 600px)");
  const { radius, height, nameSize, netSize } = geometry[compact ? "compact" : "wide"];
  const center = { x: WIDTH / 2, y: height / 2 };
  const points = useMemo(() => circleLayout(book.parties, center, radius), [book.parties, radius, height]);
  const name = (party: string) => (compact ? label(party).split(" ")[0]! : label(party));
  const net = useMemo(() => netPositions(book, "before"), [book]);
  const largest = book.edges.reduce((max, e) => (e.before > max ? e.before : max), 0n);
  const amount = (value: bigint) => formatAmount(value, decimals);

  return (
    <svg
      className="graph"
      data-cleared={cleared}
      viewBox={`0 0 ${WIDTH} ${height}`}
      role="img"
      aria-label={`${book.edges.length} invoices between ${book.parties.length} firms, ${cleared ? "after" : "before"} set-off. The table below lists them.`}
    >
      <defs>
        <marker id={marker} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="11" markerHeight="11" markerUnits="userSpaceOnUse" orient="auto">
          <path d="M0,1 L10,5 L0,9 z" className="arrowhead" />
        </marker>
      </defs>
      {book.edges.map((edge) => {
        const from = points.get(edge.debtor)!;
        const to = points.get(edge.creditor)!;
        // Bow in proportion to length, so short edges stay off the rim and
        // debts running both ways between two firms separate.
        const path = curvedEdge(from, to, Math.hypot(to.x - from.x, to.y - from.y) * BOW, NODE + 5);
        const description = `${label(edge.debtor)} owes ${label(edge.creditor)} ${amount(cleared ? edge.after : edge.before)} ${symbol}, ${edge.reference}`;
        return (
          <g key={edge.id}>
            <title>{description}</title>
            <path className="edge-full" d={path} strokeWidth={strokeWidth(edge.before, largest)} markerEnd={`url(#${marker})`} />
            <path className="edge-cancelled" d={path} strokeWidth={strokeWidth(edge.before, largest)} />
            {edge.after > 0n ? (
              <path className="edge-left" d={path} strokeWidth={strokeWidth(edge.after, largest)} markerEnd={`url(#${marker})`} />
            ) : null}
          </g>
        );
      })}
      {book.parties.map((party) => {
        const p = points.get(party)!;
        const dx = p.x - center.x;
        const dy = p.y - center.y;
        const distance = Math.hypot(dx, dy) || 1;
        const x = p.x + (dx / distance) * LABEL_GAP;
        const y = p.y + (dy / distance) * LABEL_GAP;
        const anchor = Math.abs(dx) < 20 ? "middle" : dx > 0 ? "start" : "end";
        const position = net.get(party) ?? 0n;
        return (
          <g key={party} className="party">
            <circle cx={p.x} cy={p.y} r={NODE} />
            <text x={x} y={dy < -radius * 0.9 ? y - nameSize : y} textAnchor={anchor} dominantBaseline="middle">
              <tspan className="party-name" fontSize={nameSize}>
                {name(party)}
              </tspan>
              <tspan className="party-net" fontSize={netSize} x={x} dy="1.25em">
                net {position > 0n ? "+" : position < 0n ? "−" : ""}
                {amount(position < 0n ? -position : position)}
              </tspan>
            </text>
          </g>
        );
      })}
    </svg>
  );
}
