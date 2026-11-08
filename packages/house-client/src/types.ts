/** JSON shapes the clearing house contract returns. Large numbers are decimal strings. */

export type ObligationStatus = "pending" | "active" | "discharged" | "rejected" | "withdrawn";

export interface ObligationView {
  readonly id: string;
  readonly debtor: string;
  readonly creditor: string;
  readonly asset: string;
  readonly amount: string;
  readonly outstanding: string;
  readonly cleared: string;
  readonly status: ObligationStatus;
  readonly reference: string;
  readonly issued_at_ns: string;
}

export interface ReductionInput {
  readonly obligation: string;
  readonly amount: string;
}

export interface ProposalView {
  readonly solver: string;
  readonly cleared: string;
  readonly reductions: readonly ReductionInput[];
  readonly bond: string;
}

export interface RoundView {
  readonly asset: string;
  readonly id: string;
  readonly closes_at_ns: string | null;
  readonly best: ProposalView | null;
}

export interface HouseConfig {
  readonly round_duration_ns: string;
  readonly max_reductions: number;
  readonly proposal_bond: string;
  readonly reward_bps: number;
}

export interface SolverView {
  readonly solver: string;
  readonly stats: { readonly rounds_won: number; readonly cleared: string };
}
