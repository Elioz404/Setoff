import assert from "node:assert/strict";
import { join, resolve } from "node:path";
import { describe, it } from "node:test";

import { formatAmount } from "@setoff/house-client";
import { liquidityNeeded, solve, solveGreedy } from "@setoff/solver";

import { loadEnvironment, repositoryRoot } from "../src/environment.ts";
import { isInside } from "../src/keys.ts";
import { describeTotals, totals } from "../src/report.ts";
import { loadScenario, scenarioDebts, validateScenario, type Scenario } from "../src/scenario.ts";

const scenario = loadScenario(join(repositoryRoot, "tools/demo/scenarios/supply-chain.json"));
const decimals = scenario.token.decimals;
const tusd = (amount: bigint) => formatAmount(amount, decimals);

describe("the supply-chain scenario", () => {
  const debts = scenarioDebts(scenario);
  const gross = debts.reduce((sum, d) => sum + d.outstanding, 0n);
  const limits = { maxReductions: scenario.house.maxReductions };

  // These are the figures the README quotes.
  it("has 63,600 tUSD of debt between eight firms", () => {
    assert.equal(tusd(gross), "63,600");
    assert.equal(scenario.firms.length, 8);
  });

  it("clears 40,900 tUSD (64.3%) by set-off at best", () => {
    const solution = solve(debts, limits);
    assert.equal(solution.optimal, true);
    assert.equal(tusd(solution.cleared), "40,900");
    assert.equal(tusd(gross - solution.cleared), "22,700");
  });

  it("gives a greedy solver less to clear, so the optimal one can outbid it", () => {
    assert.equal(tusd(solveGreedy(debts, limits).cleared), "38,500");
  });

  it("can never get below what net debtors owe", () => {
    assert.equal(tusd(liquidityNeeded(debts)), "10,600");
  });

  it("rejects references to firms that do not exist", () => {
    const broken: Scenario = {
      ...scenario,
      obligations: [{ debtor: "nobody", creditor: "molino", amount: "1", reference: "X" }],
    };
    assert.throws(() => validateScenario(broken), /unknown firm/);
  });
});

describe("environment", () => {
  it("refuses anything but testnet", () => {
    assert.throws(() => loadEnvironment({ SETOFF_ROOT_ACCOUNT: "me.near" }), /only runs on testnet/);
    assert.throws(
      () => loadEnvironment({ SETOFF_ROOT_ACCOUNT: "me.testnet", NEAR_RPC_URL: "https://rpc.mainnet.near.org" }),
      /only runs on testnet/,
    );
    assert.equal(loadEnvironment({ SETOFF_ROOT_ACCOUNT: "me.testnet" }).rootAccount, "me.testnet");
  });

  it("knows when a key directory would be inside the repository", () => {
    assert.ok(isInside(resolve(repositoryRoot, "keys"), repositoryRoot));
    assert.ok(isInside(repositoryRoot, repositoryRoot));
    assert.ok(!isInside(resolve(repositoryRoot, "..", "elsewhere"), repositoryRoot));
  });
});

describe("report", () => {
  it("splits accepted debt into cleared, paid and owed", () => {
    const view = (status: "active" | "discharged" | "rejected", amount: string, outstanding: string, cleared: string) => ({
      id: "0", debtor: "a", creditor: "b", asset: "t", reference: "", issued_at_ns: "0", status, amount, outstanding, cleared,
    });
    const t = totals([view("discharged", "100", "0", "60"), view("active", "50", "20", "10"), view("rejected", "999", "999", "0")]);
    assert.deepEqual(t, { accepted: 150n, cleared: 70n, paid: 60n, outstanding: 20n });
    assert.match(describeTotals(t, 0, "tUSD"), /cleared by set-off 70 tUSD \(46.6%/);
  });
});
