import { setTimeout as sleep } from "node:timers/promises";

import { HouseReader, toDebts, toReductionInputs } from "@setoff/house-client";
import { HouseWriter } from "@setoff/house-client/writer";
import { solve, solveGreedy, type Debt, type SolveOptions, type Solution } from "@setoff/solver";

import { loadConfig, type AgentConfig, type Strategy } from "./config.ts";
import { decide } from "./decide.ts";

const strategies: Record<Strategy, (debts: readonly Debt[], options: SolveOptions) => Solution> = {
  optimal: solve,
  greedy: solveGreedy,
};

function log(message: string, fields: Record<string, unknown> = {}) {
  console.log(JSON.stringify({ at: new Date().toISOString(), message, ...fields }));
}

async function step(config: AgentConfig, reader: HouseReader, writer: HouseWriter): Promise<void> {
  const [houseConfig, round, active] = await Promise.all([
    reader.config(),
    reader.round(config.asset),
    reader.active(config.asset),
  ]);
  const debts = toDebts(active);
  const solution = strategies[config.strategy](debts, { maxReductions: houseConfig.max_reductions });
  const nowNs = BigInt(Date.now()) * 1_000_000n;
  const decision = decide(round, nowNs, debts, solution);

  switch (decision.kind) {
    case "close":
      await writer.closeRound(config.asset);
      log("closed round", { round: round.id });
      return;
    case "submit": {
      const cleared = await writer.submit(
        config.asset,
        toReductionInputs(decision.solution.reductions),
        BigInt(houseConfig.proposal_bond),
      );
      log("submitted proposal", { round: round.id, cleared: cleared.toString(), reductions: decision.solution.reductions.length });
      return;
    }
    case "wait":
      log("waiting", { round: round.id, reason: decision.reason });
  }
}

async function main() {
  const config = loadConfig(process.env);
  const reader = new HouseReader(config.rpcUrl, config.contractId);
  const writer = new HouseWriter(config.rpcUrl, config.accountId, config.privateKey, config.contractId, { storage: 0n });
  log("solver started", { solver: config.accountId, strategy: config.strategy, house: config.contractId, asset: config.asset });

  for (;;) {
    try {
      await step(config, reader, writer);
    } catch (error) {
      // A rival may have outbid us or closed the round between our read and
      // our transaction; the next step reads fresh state and decides again.
      log("step failed", { error: error instanceof Error ? error.message : String(error) });
      if (config.once) process.exitCode = 1;
    }
    if (config.once) return;
    await sleep(config.pollMs);
  }
}

await main();
