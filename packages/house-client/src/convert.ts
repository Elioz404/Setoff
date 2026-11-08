import type { Debt, Reduction } from "@setoff/solver";

import type { ObligationView, ReductionInput } from "./types.ts";

/** Obligations as the solver works on them. */
export function toDebts(obligations: readonly ObligationView[]): Debt[] {
  return obligations.map((o) => ({
    id: o.id,
    debtor: o.debtor,
    creditor: o.creditor,
    outstanding: BigInt(o.outstanding),
  }));
}

/** A solver's reductions in the JSON form `submit` takes. */
export function toReductionInputs(reductions: readonly Reduction[]): ReductionInput[] {
  return reductions.map((r) => ({ obligation: r.obligation, amount: r.amount.toString() }));
}

/** Formats an amount in the asset's smallest unit with `decimals` places. */
export function formatAmount(amount: bigint, decimals: number): string {
  const negative = amount < 0n;
  const digits = (negative ? -amount : amount).toString().padStart(decimals + 1, "0");
  const whole = digits.slice(0, digits.length - decimals);
  const fraction = digits.slice(digits.length - decimals).replace(/0+$/, "");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${negative ? "-" : ""}${grouped}${fraction ? `.${fraction}` : ""}`;
}

/** Parses a decimal amount ("1250.5") into the asset's smallest unit. */
export function parseAmount(text: string, decimals: number): bigint {
  const match = /^(\d+)(?:\.(\d+))?$/.exec(text.trim());
  if (!match) throw new Error(`not an amount: ${text}`);
  const fraction = match[2] ?? "";
  if (fraction.length > decimals) throw new Error(`${text} has more than ${decimals} decimals`);
  return BigInt(match[1]! + fraction.padEnd(decimals, "0"));
}
