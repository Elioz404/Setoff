/** An accepted obligation as the solver sees it: an edge from debtor to creditor. */
export interface Debt {
  /** Obligation id, as the contract reports it (a decimal string). */
  readonly id: string;
  readonly debtor: string;
  readonly creditor: string;
  /** Amount still owed, in the asset's smallest unit. */
  readonly outstanding: bigint;
}

/** Reduce one obligation by `amount` as part of a clearing. */
export interface Reduction {
  readonly obligation: string;
  readonly amount: bigint;
}

export interface Solution {
  /** Reductions sorted by obligation id. Empty when no debt runs in a cycle. */
  readonly reductions: readonly Reduction[];
  /** Total debt removed: the sum of all reductions. */
  readonly cleared: bigint;
  /** True when no clearing of these debts within the limits removes more. */
  readonly optimal: boolean;
}

export interface SolveOptions {
  /** Most reductions the clearing house accepts in one proposal. */
  readonly maxReductions: number;
  /** Bound on improvement steps, so the solver always returns in time. */
  readonly maxIterations?: number;
}
