import { KeyPair } from "near-api-js";

import type { Chain } from "./chain.ts";
import type { Deployment } from "./deployment.ts";
import type { KeyStore } from "./keys.ts";

/**
 * Deletes every full-access key of the house and the token, so that nobody,
 * the deployer included, can replace their code or move their NEAR again. The
 * configuration the contract enforces then really is fixed. This cannot be
 * undone; without `confirmed` it only reports what it would delete.
 */
export async function lock(
  deployment: Deployment,
  chain: Chain,
  keys: KeyStore,
  confirmed: boolean,
  log: (message: string) => void,
): Promise<void> {
  for (const accountId of [deployment.house, deployment.token.account]) {
    const { keys: accessKeys } = await chain.provider.viewAccessKeyList({ accountId });
    const fullAccess = accessKeys.filter((k) => String(k.access_key.permission) === "FullAccess").map((k) => k.public_key);
    if (fullAccess.length === 0) {
      log(`${accountId} has no full-access key left: already locked`);
      continue;
    }
    if (!confirmed) {
      log(`${accountId}: would delete ${fullAccess.length} full-access key(s): ${fullAccess.join(", ")}`);
      continue;
    }
    const privateKey = keys.read(accountId);
    if (!privateKey) throw new Error(`no key for ${accountId} in the key directory`);
    const signing = KeyPair.fromString(privateKey).getPublicKey().toString();
    const account = chain.account(accountId, privateKey);
    // The key that signs the deletions goes last, or the next one could not be signed.
    for (const publicKey of [...fullAccess.filter((k) => k !== signing), ...fullAccess.filter((k) => k === signing)]) {
      await account.deleteKey(publicKey);
      log(`${accountId}: deleted ${publicKey}`);
    }
  }
  if (!confirmed) log("nothing deleted: run `npm run demo -- lock --confirm` to lock the contracts for good");
}
