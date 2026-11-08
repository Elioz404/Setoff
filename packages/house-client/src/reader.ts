import type { HouseConfig, ObligationView, RoundView, SolverView } from "./types.ts";

/** Page size the contract allows for list views. */
const PAGE = 100;

export class RpcError extends Error {
  override readonly name = "RpcError";
}

/** The endpoint, not the contract, failed: worth trying another one. */
class EndpointError extends Error {
  override readonly name = "EndpointError";
}

/**
 * Read-only access to a clearing house through NEAR JSON-RPC view calls.
 * It needs nothing but `fetch`, so it runs the same in a browser and in Node.
 *
 * Public RPC endpoints rate-limit and go down, so it takes several and moves
 * to the next one when an endpoint fails to answer. An error from the
 * contract itself is the same on every endpoint and is reported at once.
 */
export class HouseReader {
  private readonly rpcUrls: readonly string[];
  private current = 0;

  constructor(
    rpcUrls: string | readonly string[],
    readonly contractId: string,
    private readonly fetcher: typeof fetch = globalThis.fetch.bind(globalThis),
  ) {
    this.rpcUrls = typeof rpcUrls === "string" ? [rpcUrls] : rpcUrls;
    if (this.rpcUrls.length === 0) throw new RangeError("at least one RPC URL is needed");
  }

  config(): Promise<HouseConfig> {
    return this.view("get_config", {});
  }

  assets(): Promise<string[]> {
    return this.view("get_assets", {});
  }

  obligation(id: string): Promise<ObligationView | null> {
    return this.view("get_obligation", { id });
  }

  round(asset: string): Promise<RoundView> {
    return this.view("get_round", { asset });
  }

  async balance(account: string, asset: string): Promise<bigint> {
    return BigInt(await this.view<string>("get_balance", { account, asset }));
  }

  async rewardPool(asset: string): Promise<bigint> {
    return BigInt(await this.view<string>("get_reward_pool", { asset }));
  }

  /** Every obligation ever issued, oldest first. */
  obligations(): Promise<ObligationView[]> {
    return this.pages((from_index) => this.view("list_obligations", { from_index, limit: PAGE }));
  }

  /** Accepted obligations in `asset` with something outstanding: the graph to clear. */
  active(asset: string): Promise<ObligationView[]> {
    return this.pages((from_index) => this.view("list_active", { asset, from_index, limit: PAGE }));
  }

  solvers(): Promise<SolverView[]> {
    return this.pages((from_index) => this.view("list_solvers", { from_index, limit: PAGE }));
  }

  /** Calls a view method of the contract and decodes its JSON result. */
  async view<T>(method: string, args: Record<string, unknown>): Promise<T> {
    const failures: string[] = [];
    for (let attempt = 0; attempt < this.rpcUrls.length; attempt++) {
      const url = this.rpcUrls[this.current]!;
      try {
        return await this.viewAt<T>(url, method, args);
      } catch (error) {
        if (!(error instanceof EndpointError)) throw error;
        failures.push(`${url}: ${error.message}`);
        this.current = (this.current + 1) % this.rpcUrls.length;
      }
    }
    throw new RpcError(`${method}: no RPC endpoint answered (${failures.join("; ")})`);
  }

  private async viewAt<T>(url: string, method: string, args: Record<string, unknown>): Promise<T> {
    const response = await this.fetcher(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: method,
        method: "query",
        params: {
          request_type: "call_function",
          finality: "final",
          account_id: this.contractId,
          method_name: method,
          args_base64: toBase64(JSON.stringify(args)),
        },
      }),
    }).catch((error: unknown) => {
      throw new EndpointError(error instanceof Error ? error.message : String(error));
    });
    if (!response.ok) throw new EndpointError(`HTTP ${response.status}`);
    const body = (await response.json()) as { result?: { result?: number[]; error?: string }; error?: { message?: string; data?: unknown } };
    if (body.error) throw new RpcError(`${method}: ${body.error.message ?? "RPC error"} ${JSON.stringify(body.error.data ?? "")}`);
    if (body.result?.error) throw new RpcError(`${method}: ${body.result.error}`);
    if (!body.result?.result) throw new RpcError(`${method}: empty result`);
    return JSON.parse(new TextDecoder().decode(Uint8Array.from(body.result.result))) as T;
  }

  private async pages<T>(fetchPage: (from: string) => Promise<T[]>): Promise<T[]> {
    const result: T[] = [];
    for (let from = 0; ; from += PAGE) {
      const page = await fetchPage(String(from));
      result.push(...page);
      if (page.length < PAGE) return result;
    }
  }
}

function toBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
