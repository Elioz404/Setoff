import { Account, FailoverRpcProvider, JsonRpcProvider, KeyPairSigner, teraToGas, type KeyPairString } from "near-api-js";

import type { ReductionInput } from "./types.ts";

/** Gas for plain contract calls. */
const CALL_GAS = teraToGas(30);
/** Gas for calls that start other calls: proposals, round closing, token transfers with a callback. */
const CHAINED_GAS = teraToGas(100);
const ONE_YOCTO = 1n;

export interface Deposits {
  /** NEAR attached to calls that add storage; any excess is refunded by the contract. */
  readonly storage: bigint;
}

/**
 * Signs and sends clearing house calls as one account. Holds a private key,
 * so it is for Node processes (the solver agent, the demo tool), never for a
 * browser page.
 */
export class HouseWriter {
  private readonly account: Account;

  constructor(
    rpcUrls: readonly string[],
    readonly accountId: string,
    privateKey: KeyPairString,
    readonly contractId: string,
    private readonly deposits: Deposits,
  ) {
    const provider = new FailoverRpcProvider(rpcUrls.map((url) => new JsonRpcProvider({ url })));
    this.account = new Account(accountId, provider, KeyPairSigner.fromSecretKey(privateKey));
  }

  /** Records that `debtor` owes this account `amount` of `asset`. Returns the obligation id. */
  async issue(debtor: string, asset: string, amount: bigint, reference: string): Promise<string> {
    return this.call<string>("issue", { debtor, asset, amount: amount.toString(), reference }, this.deposits.storage);
  }

  /**
   * Admits firms as members; only the house's owner may call it. Attaches the
   * storage deposit once per account, and the contract refunds what is left.
   */
  async admit(accounts: readonly string[]): Promise<void> {
    await this.call("admit", { accounts }, this.deposits.storage * BigInt(accounts.length));
  }

  async accept(id: string): Promise<void> {
    await this.call("accept", { id }, this.deposits.storage);
  }

  async submit(asset: string, reductions: readonly ReductionInput[], bond: bigint): Promise<bigint> {
    return BigInt(await this.call<string>("submit", { asset, reductions }, bond, CHAINED_GAS));
  }

  async closeRound(asset: string): Promise<void> {
    await this.call("close_round", { asset }, 0n, CHAINED_GAS);
  }

  async withdrawBalance(asset: string): Promise<void> {
    await this.call("withdraw_balance", { asset }, ONE_YOCTO, CHAINED_GAS);
  }

  /** Pays towards an obligation with a NEP-141 transfer to the house. */
  async pay(asset: string, obligation: string, amount: bigint): Promise<void> {
    await this.transferToHouse(asset, amount, JSON.stringify({ pay: { obligation } }));
  }

  async fundRewards(asset: string, amount: bigint): Promise<void> {
    await this.transferToHouse(asset, amount, JSON.stringify("fund_rewards"));
  }

  /** Calls any method of any contract; used for token setup (registration, faucet). */
  async callContract<T>(contractId: string, methodName: string, args: Record<string, unknown>, deposit = 0n): Promise<T> {
    return this.account.callFunction<T & {}>({ contractId, methodName, args, deposit, gas: CALL_GAS }) as Promise<T>;
  }

  private transferToHouse(asset: string, amount: bigint, msg: string): Promise<unknown> {
    return this.account.callFunction({
      contractId: asset,
      methodName: "ft_transfer_call",
      args: { receiver_id: this.contractId, amount: amount.toString(), msg },
      deposit: ONE_YOCTO,
      gas: CHAINED_GAS,
    });
  }

  private call<T>(methodName: string, args: Record<string, unknown>, deposit: bigint, gas = CALL_GAS): Promise<T> {
    return this.account.callFunction<T & {}>({ contractId: this.contractId, methodName, args, deposit, gas }) as Promise<T>;
  }
}
