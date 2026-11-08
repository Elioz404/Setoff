import type { Debt } from "./types.ts";

/**
 * The least money that must change hands to settle every debt: what net
 * debtors owe on net. Without set-off the whole gross amount moves. Set-off
 * brings it down towards this bound but reaches it only when no debt merely
 * passes through a party (A owes B, B owes C): cancelling that chain would
 * change who owes whom, which set-off never does.
 */
export function liquidityNeeded(debts: readonly Debt[]): bigint {
  const net = new Map<string, bigint>();
  for (const { debtor, creditor, outstanding } of debts) {
    net.set(debtor, (net.get(debtor) ?? 0n) + outstanding);
    net.set(creditor, (net.get(creditor) ?? 0n) - outstanding);
  }
  return [...net.values()].reduce((sum, value) => (value > 0n ? sum + value : sum), 0n);
}
