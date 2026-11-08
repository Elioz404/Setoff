import { HouseReader } from "@setoff/house-client";

import { join } from "node:path";

import { Chain, codeHash } from "./chain.ts";
import { readDeployment } from "./deployment.ts";
import { defaultWasmDir, loadEnvironment, repositoryRoot } from "./environment.ts";
import { KeyStore, readKeyFile } from "./keys.ts";
import { describeTotals, totals } from "./report.ts";
import { loadScenario } from "./scenario.ts";
import { settle } from "./settle.ts";
import { setup } from "./setup.ts";

const usage = `usage: npm run demo -- <command>

  setup   create the accounts, deploy the token and the house, issue and accept the scenario's obligations
  settle  pay every obligation set-off left, then withdraw every firm's balance
  report  print how much debt was cleared, paid and is still owed
  hashes  print the code hash of each built contract, as NEAR reports it (base58 of the sha256)`;

const log = (message: string) => console.log(message);

async function main(command: string | undefined) {
  if (command === undefined || !["setup", "settle", "report", "hashes"].includes(command)) {
    console.error(usage);
    process.exitCode = 2;
    return;
  }

  if (command === "hashes") {
    const wasmDir = process.env.SETOFF_WASM_DIR?.trim() || defaultWasmDir;
    for (const file of ["setoff_clearing_house.wasm", "setoff_test_token.wasm"]) log(`${codeHash(join(wasmDir, file))}  ${file}`);
    return;
  }

  const env = loadEnvironment(process.env);
  const keys = new KeyStore(env.keyDir, repositoryRoot);

  if (command === "setup") {
    const chain = new Chain(env.rpcUrls);
    const rootKey = readKeyFile(env.rootKeyFile, env.rootAccount);
    const deployment = await setup({
      env,
      chain,
      keys,
      root: chain.account(env.rootAccount, rootKey),
      rootKey,
      scenario: loadScenario(env.scenarioPath),
      log,
    });
    log(`\nhouse ${deployment.house}, token ${deployment.token.account}, ${deployment.obligations.length} obligations`);
    log(`deployment written to ${env.deploymentPath}`);
    return;
  }

  const deployment = readDeployment(env.deploymentPath);
  if (!deployment) throw new Error(`no deployment at ${env.deploymentPath}: run setup first`);

  if (command === "settle") {
    await settle(deployment, keys, log);
  }
  const obligations = await new HouseReader(deployment.rpcUrls, deployment.house).obligations();
  log(describeTotals(totals(obligations), deployment.token.decimals, deployment.token.symbol));
}

await main(process.argv[2]);
