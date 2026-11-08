import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { Account, baseEncode, FailoverRpcProvider, JsonRpcProvider, KeyPair, KeyPairSigner, teraToGas, type KeyPairString } from "near-api-js";

/** Code hash NEAR reports for an account with no contract. */
const NO_CODE = "11111111111111111111111111111111";

/** Accounts and contracts on one network, signed with keys handed in by the caller. */
export class Chain {
  readonly provider: FailoverRpcProvider;

  constructor(rpcUrls: readonly string[]) {
    this.provider = new FailoverRpcProvider(rpcUrls.map((url) => new JsonRpcProvider({ url })));
  }

  account(accountId: string, privateKey: KeyPairString): Account {
    return new Account(accountId, this.provider, KeyPairSigner.fromSecretKey(privateKey));
  }

  async exists(accountId: string): Promise<boolean> {
    try {
      await this.provider.viewAccount({ accountId });
      return true;
    } catch (error) {
      if (isMissingAccount(error)) return false;
      throw error;
    }
  }

  async hasCode(accountId: string): Promise<boolean> {
    const view = await this.provider.viewAccount({ accountId });
    return (view as { code_hash?: string }).code_hash !== NO_CODE;
  }

  /** Creates `accountId` under `parent` unless it already exists. */
  async ensureSubAccount(parent: Account, accountId: string, privateKey: KeyPairString, balance: bigint): Promise<boolean> {
    if (await this.exists(accountId)) return false;
    const prefix = accountId.slice(0, accountId.length - parent.accountId.length - 1);
    const publicKey = KeyPair.fromString(privateKey).getPublicKey();
    await parent.createSubAccount({ accountOrPrefix: prefix, publicKey, nearToTransfer: balance });
    return true;
  }

  /** Deploys `wasmPath` and calls its initialiser, unless code is already there. */
  async ensureContract(account: Account, wasmPath: string, init: Record<string, unknown>): Promise<boolean> {
    if (await this.hasCode(account.accountId)) return false;
    await account.deployContract(readFileSync(wasmPath));
    await account.callFunction({ contractId: account.accountId, methodName: "new", args: init, gas: teraToGas(100) });
    return true;
  }
}

/**
 * Whether an RPC error says the account does not exist. The failover provider
 * wraps each endpoint's error in a list, so the answer may sit one level down.
 */
function isMissingAccount(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (error.name === "AccountDoesNotExistError" || /does not exist|UNKNOWN_ACCOUNT/i.test(error.message)) return true;
  const nested = (error as Error & { errors?: unknown[] }).errors ?? [];
  return nested.length > 0 && nested.every(isMissingAccount);
}

/** Base58 SHA-256 of a wasm file, the way NEAR reports code hashes. */
export function codeHash(wasmPath: string): string {
  const digest = createHash("sha256").update(readFileSync(wasmPath)).digest();
  return baseEncode(digest);
}
