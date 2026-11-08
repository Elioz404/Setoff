import { join } from "node:path";

import { parseAmount } from "@setoff/house-client";
import { HouseWriter } from "@setoff/house-client/writer";
import { nearToYocto, type Account, type KeyPairString } from "near-api-js";

import { codeHash, type Chain } from "./chain.ts";
import { readDeployment, writeDeployment, type Deployment } from "./deployment.ts";
import type { DemoEnvironment } from "./environment.ts";
import type { KeyStore } from "./keys.ts";
import { Accounts, type Scenario } from "./scenario.ts";

const NANOS_PER_SECOND = 1_000_000_000n;

export interface SetupContext {
  readonly env: DemoEnvironment;
  readonly chain: Chain;
  readonly keys: KeyStore;
  readonly root: Account;
  readonly rootKey: KeyPairString;
  readonly scenario: Scenario;
  readonly log: (message: string) => void;
}

/**
 * Brings a testnet deployment of the scenario into being, step by step. Every
 * step checks whether it already happened, so a run that stopped half way can
 * simply be started again.
 */
export async function setup(ctx: SetupContext): Promise<Deployment> {
  const { env, chain, keys, root, scenario, log } = ctx;
  const ids = new Accounts(env.rootAccount);
  const houseWasm = join(env.wasmDir, "setoff_clearing_house.wasm");
  const tokenWasm = join(env.wasmDir, "setoff_test_token.wasm");
  const decimals = scenario.token.decimals;
  const writer = (label: string) =>
    new HouseWriter(env.rpcUrl, label, keys.keyFor(label), ids.house(), { storage: near(scenario.funding.storageDepositNear) });

  const accounts: [string, string][] = [
    [ids.house(), scenario.funding.houseNear],
    [ids.token(), scenario.funding.tokenNear],
    ...scenario.firms.map((f): [string, string] => [ids.of(f.id), scenario.funding.firmNear]),
    ...scenario.solvers.map((s): [string, string] => [ids.of(s.id), scenario.funding.solverNear]),
  ];
  for (const [accountId, balance] of accounts) {
    if (await chain.ensureSubAccount(root, accountId, keys.keyFor(accountId), near(balance))) log(`created ${accountId}`);
  }

  const token = chain.account(ids.token(), keys.keyFor(ids.token()));
  if (
    await chain.ensureContract(token, tokenWasm, {
      name: scenario.token.name,
      symbol: scenario.token.symbol,
      decimals,
      faucet_cap: parseAmount(scenario.token.faucetCap, decimals).toString(),
    })
  ) {
    log(`deployed the test token at ${ids.token()}`);
  }

  const house = chain.account(ids.house(), keys.keyFor(ids.house()));
  if (
    await chain.ensureContract(house, houseWasm, {
      owner: env.rootAccount,
      config: {
        round_duration_ns: (BigInt(scenario.house.roundDurationSeconds) * NANOS_PER_SECOND).toString(),
        max_reductions: scenario.house.maxReductions,
        proposal_bond: near(scenario.house.proposalBondNear).toString(),
        reward_bps: scenario.house.rewardBps,
      },
      assets: [ids.token()],
    })
  ) {
    log(`deployed the clearing house at ${ids.house()}`);
  }

  const storageDeposit = near(scenario.funding.storageDepositNear);
  const holders = [env.rootAccount, ids.house(), ...scenario.firms.map((f) => ids.of(f.id)), ...scenario.solvers.map((s) => ids.of(s.id))];
  for (const accountId of holders) {
    const registered = await chain.provider.callFunction({
      contractId: ids.token(),
      method: "storage_balance_of",
      args: { account_id: accountId },
    });
    if (registered) continue;
    await root.callFunction({
      contractId: ids.token(),
      methodName: "storage_deposit",
      args: { account_id: accountId, registration_only: true },
      deposit: storageDeposit,
    });
    log(`registered ${accountId} with the token`);
  }

  const previous = readDeployment(env.deploymentPath);
  let obligations = previous?.house === ids.house() ? [...previous.obligations] : [];
  const deployment = (): Deployment => ({
    network: "testnet",
    rpcUrl: env.rpcUrl,
    scenario: scenario.name,
    house: ids.house(),
    token: { account: ids.token(), symbol: scenario.token.symbol, decimals },
    firms: scenario.firms.map((f) => ({ ...f, account: ids.of(f.id) })),
    solvers: scenario.solvers.map((s) => ({ ...s, account: ids.of(s.id) })),
    codeHashes: { house: codeHash(houseWasm), token: codeHash(tokenWasm) },
    obligations,
  });

  if (obligations.length === 0) {
    await fundFirms(ctx, ids);
    const pool = parseAmount(scenario.house.rewardPool, decimals);
    if (pool > 0n) {
      await mint(root, ids.token(), pool, parseAmount(scenario.token.faucetCap, decimals));
      await new HouseWriter(env.rpcUrl, env.rootAccount, ctx.rootKey, ids.house(), { storage: storageDeposit }).fundRewards(ids.token(), pool);
      log(`funded the solver reward pool with ${scenario.house.rewardPool} ${scenario.token.symbol}`);
    }
  }

  for (let index = obligations.length; index < scenario.obligations.length; index++) {
    const o = scenario.obligations[index]!;
    const id = await writer(ids.of(o.creditor)).issue(ids.of(o.debtor), ids.token(), parseAmount(o.amount, decimals), o.reference);
    await writer(ids.of(o.debtor)).accept(id);
    obligations = [...obligations, id];
    writeDeployment(env.deploymentPath, deployment());
    log(`obligation ${id}: ${o.debtor} owes ${o.creditor} ${o.amount} ${scenario.token.symbol} (${o.reference})`);
  }

  writeDeployment(env.deploymentPath, deployment());
  return deployment();
}

/** Mints each firm what it owes in total, so it can pay whatever set-off leaves. */
async function fundFirms(ctx: SetupContext, ids: Accounts): Promise<void> {
  const { chain, keys, scenario, log } = ctx;
  const decimals = scenario.token.decimals;
  const cap = parseAmount(scenario.token.faucetCap, decimals);
  for (const firm of scenario.firms) {
    const owed = scenario.obligations
      .filter((o) => o.debtor === firm.id)
      .reduce((sum, o) => sum + parseAmount(o.amount, decimals), 0n);
    if (owed === 0n) continue;
    const account = chain.account(ids.of(firm.id), keys.keyFor(ids.of(firm.id)));
    await mint(account, ids.token(), owed, cap);
    log(`minted ${firm.id} what it owes`);
  }
}

async function mint(account: Account, token: string, amount: bigint, cap: bigint): Promise<void> {
  for (let left = amount; left > 0n; left -= left < cap ? left : cap) {
    const chunk = left < cap ? left : cap;
    await account.callFunction({ contractId: token, methodName: "faucet", args: { amount: chunk.toString() } });
  }
}

/** Converts a NEAR amount written in the scenario ("0.5") to yoctoNEAR. */
function near(amount: string): bigint {
  if (!/^\d+(\.\d+)?$/.test(amount)) throw new Error(`not a NEAR amount: ${amount}`);
  return nearToYocto(amount as `${number}`);
}
