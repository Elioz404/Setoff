import { liquidityNeeded, type Debt, type Reduction } from "@setoff/solver";

/** One edge of the debt graph: what `debtor` owes `creditor`, before and after set-off. */
export interface Edge {
  readonly id: string;
  readonly debtor: string;
  readonly creditor: string;
  readonly before: bigint;
  readonly after: bigint;
  readonly reference: string;
}

export interface Book {
  readonly parties: readonly string[];
  readonly edges: readonly Edge[];
}

export interface BookTotals {
  readonly gross: bigint;
  readonly cleared: bigint;
  readonly toPay: bigint;
  /** Least money that must move whatever is cleared: what net debtors owe on net. */
  readonly floor: bigint;
  /** Share of gross debt cleared, in tenths of a percent. */
  readonly clearedPermille: number;
}

export interface Entry {
  readonly id: string;
  readonly debtor: string;
  readonly creditor: string;
  readonly amount: bigint;
  readonly reference: string;
}

/** Builds the graph from entries and the clearing applied to them. */
export function bookFrom(entries: readonly Entry[], reductions: readonly Reduction[]): Book {
  const cleared = new Map(reductions.map((r) => [r.obligation, r.amount]));
  const edges = entries.map((e) => ({
    id: e.id,
    debtor: e.debtor,
    creditor: e.creditor,
    before: e.amount,
    after: e.amount - (cleared.get(e.id) ?? 0n),
    reference: e.reference,
  }));
  if (edges.some((e) => e.after < 0n)) throw new Error("a reduction exceeds its obligation");
  const parties = [...new Set(entries.flatMap((e) => [e.debtor, e.creditor]))];
  return { parties, edges };
}

/** Totals of the book as it stands before set-off, or after it. */
export function totalsOf(book: Book, side: "before" | "after" = "after"): BookTotals {
  const gross = sum(book.edges.map((e) => e.before));
  const toPay = sum(book.edges.map((e) => e[side]));
  const cleared = gross - toPay;
  const debts: Debt[] = book.edges.map((e) => ({ id: e.id, debtor: e.debtor, creditor: e.creditor, outstanding: e.before }));
  return {
    gross,
    cleared,
    toPay,
    floor: liquidityNeeded(debts),
    clearedPermille: gross === 0n ? 0 : Number((cleared * 1000n) / gross),
  };
}

/** Each party's net position: positive if it is owed more than it owes. */
export function netPositions(book: Book, side: "before" | "after"): Map<string, bigint> {
  const net = new Map(book.parties.map((p) => [p, 0n]));
  for (const edge of book.edges) {
    net.set(edge.creditor, net.get(edge.creditor)! + edge[side]);
    net.set(edge.debtor, net.get(edge.debtor)! - edge[side]);
  }
  return net;
}

function sum(values: readonly bigint[]): bigint {
  return values.reduce((a, b) => a + b, 0n);
}
