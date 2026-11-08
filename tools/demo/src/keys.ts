import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";

import { KeyPairEd25519, type KeyPairString } from "near-api-js";

/** A key file in the format near-cli writes to ~/.near-credentials/<network>/. */
interface KeyFile {
  readonly account_id: string;
  readonly public_key: string;
  readonly private_key: KeyPairString;
}

/**
 * Keys of the accounts the demo creates, one near-cli style file per
 * account. The directory must be outside the repository, so a key can never
 * be committed by accident.
 */
export class KeyStore {
  private readonly dir: string;

  constructor(dir: string, repositoryRoot: string) {
    this.dir = resolve(dir);
    if (isInside(this.dir, resolve(repositoryRoot))) {
      throw new Error(`refusing to keep keys inside the repository (${this.dir})`);
    }
    mkdirSync(this.dir, { recursive: true });
  }

  /** The key for `accountId`, created and saved first if there is none yet. */
  keyFor(accountId: string): KeyPairString {
    const existing = this.read(accountId);
    if (existing) return existing;
    const pair = KeyPairEd25519.fromRandom();
    const file: KeyFile = { account_id: accountId, public_key: pair.getPublicKey().toString(), private_key: pair.toString() };
    writeFileSync(this.path(accountId), JSON.stringify(file), { mode: 0o600 });
    return file.private_key;
  }

  read(accountId: string): KeyPairString | undefined {
    const path = this.path(accountId);
    if (!existsSync(path)) return undefined;
    const file = JSON.parse(readFileSync(path, "utf8")) as KeyFile;
    if (file.account_id !== accountId) throw new Error(`${path} holds the key of ${file.account_id}`);
    return file.private_key;
  }

  private path(accountId: string): string {
    return join(this.dir, `${accountId}.json`);
  }
}

export function isInside(path: string, dir: string): boolean {
  const rel = relative(dir, path);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

/** Reads the private key from a near-cli key file. */
export function readKeyFile(path: string, accountId: string): KeyPairString {
  const file = JSON.parse(readFileSync(path, "utf8")) as KeyFile;
  if (file.account_id !== accountId) throw new Error(`${path} is the key of ${file.account_id}, not ${accountId}`);
  return file.private_key;
}
