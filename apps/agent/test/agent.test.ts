import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { RoundView } from "@setoff/house-client";
import { solve, type Debt } from "@setoff/solver";

import { ConfigError, loadConfig } from "../src/config.ts";
import { decide } from "../src/decide.ts";

const debts: Debt[] = [
  { id: "0", debtor: "a", creditor: "b", outstanding: 100n },
  { id: "1", debtor: "b", creditor: "c", outstanding: 80n },
  { id: "2", debtor: "c", creditor: "a", outstanding: 60n },
];
const solution = solve(debts, { maxReductions: 16 });
const open: RoundView = { asset: "usd", id: "1", closes_at_ns: null, best: null };
const withBest = (cleared: string, closesAt: string): RoundView => ({
  ...open,
  closes_at_ns: closesAt,
  best: { solver: "rival", cleared, reductions: [], bond: "1" },
});

describe("decide", () => {
  it("proposes when nobody has", () => {
    assert.equal(decide(open, 0n, debts, solution).kind, "submit");
  });

  it("outbids a weaker proposal", () => {
    assert.equal(decide(withBest("150", "100"), 50n, debts, solution).kind, "submit");
  });

  it("does not resend what is already the best", () => {
    assert.equal(decide(withBest("180", "100"), 50n, debts, solution).kind, "wait");
  });

  it("closes a round whose time is up before anything else", () => {
    assert.equal(decide(withBest("180", "100"), 100n, debts, solution).kind, "close");
  });

  it("waits when there is nothing to clear", () => {
    const decision = decide(open, 0n, debts, { reductions: [], cleared: 0n, optimal: true });
    assert.deepEqual(decision, { kind: "wait", reason: "no debt runs in a cycle" });
  });

  it("never sends a clearing the contract would refuse", () => {
    const forged = { reductions: [{ obligation: "0", amount: 60n }], cleared: 60n, optimal: false };
    assert.equal(decide(open, 0n, debts, forged).kind, "wait");
  });
});

describe("loadConfig", () => {
  const env = {
    NEAR_RPC_URL: "https://rpc.example",
    SETOFF_CONTRACT: "house.testnet",
    SETOFF_ASSET: "usd.testnet",
    SOLVER_ACCOUNT_ID: "solver.testnet",
    // Shape of a key only; not a key to any account.
    SOLVER_PRIVATE_KEY: `ed25519:${"1".repeat(64)}`,
  };

  it("reads a complete environment", () => {
    const config = loadConfig(env);
    assert.equal(config.strategy, "optimal");
    assert.equal(config.pollMs, 10_000);
  });

  it("names the missing setting", () => {
    assert.throws(() => loadConfig({ ...env, SETOFF_CONTRACT: "" }), new ConfigError("SETOFF_CONTRACT is not set"));
  });

  it("reads the key from a near-cli key file for the same account", () => {
    const { SOLVER_PRIVATE_KEY: key, ...rest } = env;
    const file = JSON.stringify({ account_id: "solver.testnet", private_key: key });
    assert.equal(loadConfig({ ...rest, SOLVER_KEY_FILE: "k.json" }, () => file).privateKey, key);
    const other = JSON.stringify({ account_id: "someone.testnet", private_key: key });
    assert.throws(() => loadConfig({ ...rest, SOLVER_KEY_FILE: "k.json" }, () => other), /not the key of solver.testnet/);
    assert.throws(() => loadConfig(rest), new ConfigError("set SOLVER_KEY_FILE or SOLVER_PRIVATE_KEY"));
  });

  it("refuses a malformed key and unknown strategies", () => {
    assert.throws(() => loadConfig({ ...env, SOLVER_PRIVATE_KEY: "hunter2" }), ConfigError);
    assert.throws(() => loadConfig({ ...env, SOLVER_STRATEGY: "random" }), ConfigError);
  });
});
