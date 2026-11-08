import { HouseReader } from "@setoff/house-client";
import { HouseWriter } from "@setoff/house-client/writer";

import type { Deployment } from "./deployment.ts";
import type { KeyStore } from "./keys.ts";

/**
 * Pays what set-off left: every debtor pays each of its remaining obligations
 * in full, then every firm withdraws what it was credited.
 */
export async function settle(deployment: Deployment, keys: KeyStore, log: (message: string) => void): Promise<void> {
  const reader = new HouseReader(deployment.rpcUrls, deployment.house);
  const asset = deployment.token.account;
  const writer = (account: string) => new HouseWriter(deployment.rpcUrls, account, keys.keyFor(account), deployment.house, { storage: 0n });

  for (const obligation of await reader.active(asset)) {
    await writer(obligation.debtor).pay(asset, obligation.id, BigInt(obligation.outstanding));
    log(`${obligation.debtor} paid obligation ${obligation.id}: ${obligation.outstanding}`);
  }
  for (const firm of deployment.firms) {
    if ((await reader.balance(firm.account, asset)) > 0n) {
      await writer(firm.account).withdrawBalance(asset);
      log(`${firm.account} withdrew its balance`);
    }
  }
}
