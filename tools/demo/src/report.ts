import { formatAmount, type ObligationView } from "@setoff/house-client";

export interface Totals {
  /** Debt accepted by debtors. */
  readonly accepted: bigint;
  /** Part of it cancelled by set-off, with no money moving. */
  readonly cleared: bigint;
  /** Part of it paid with tokens. */
  readonly paid: bigint;
  /** Part of it still owed. */
  readonly outstanding: bigint;
}

const counted = new Set(["active", "discharged"]);

/** Splits accepted debt into what was cleared, paid and is still owed. */
export function totals(obligations: readonly ObligationView[]): Totals {
  let accepted = 0n;
  let cleared = 0n;
  let outstanding = 0n;
  for (const o of obligations) {
    if (!counted.has(o.status)) continue;
    accepted += BigInt(o.amount);
    cleared += BigInt(o.cleared);
    outstanding += BigInt(o.outstanding);
  }
  return { accepted, cleared, paid: accepted - cleared - outstanding, outstanding };
}

export function describeTotals(t: Totals, decimals: number, symbol: string): string {
  const share = t.accepted === 0n ? 0 : Number((t.cleared * 1000n) / t.accepted) / 10;
  const amount = (value: bigint) => `${formatAmount(value, decimals)} ${symbol}`;
  return [
    `accepted debt      ${amount(t.accepted)}`,
    `cleared by set-off ${amount(t.cleared)} (${share}%, no money moved)`,
    `paid               ${amount(t.paid)}`,
    `still owed         ${amount(t.outstanding)}`,
  ].join("\n");
}
