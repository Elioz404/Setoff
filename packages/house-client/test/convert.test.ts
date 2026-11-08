import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { formatAmount, HouseReader, parseAmount, RpcError, toDebts, toReductionInputs } from "../src/index.ts";

describe("amounts", () => {
  it("round-trips through text", () => {
    assert.equal(parseAmount("1250.5", 6), 1_250_500_000n);
    assert.equal(formatAmount(1_250_500_000n, 6), "1,250.5");
    assert.equal(formatAmount(7n, 6), "0.000007");
    assert.equal(formatAmount(0n, 6), "0");
  });

  it("refuses text that is not an amount", () => {
    assert.throws(() => parseAmount("-1", 6));
    assert.throws(() => parseAmount("1.1234567", 6));
    assert.throws(() => parseAmount("1e6", 6));
  });
});

describe("conversion", () => {
  it("turns views into debts and reductions into JSON", () => {
    const debts = toDebts([
      { id: "4", debtor: "a.testnet", creditor: "b.testnet", asset: "usd.testnet", amount: "10", outstanding: "7", cleared: "0", status: "active", reference: "", issued_at_ns: "0" },
    ]);
    assert.deepEqual(debts, [{ id: "4", debtor: "a.testnet", creditor: "b.testnet", outstanding: 7n }]);
    assert.deepEqual(toReductionInputs([{ obligation: "4", amount: 7n }]), [{ obligation: "4", amount: "7" }]);
  });
});

describe("HouseReader", () => {
  const reply = (body: unknown): typeof fetch => async () => new Response(JSON.stringify(body), { status: 200 });

  it("decodes a view result", async () => {
    const bytes = [...new TextEncoder().encode(JSON.stringify(["usd.testnet"]))];
    const reader = new HouseReader("http://rpc", "house.testnet", reply({ result: { result: bytes } }));
    assert.deepEqual(await reader.assets(), ["usd.testnet"]);
  });

  it("moves to the next endpoint when one fails to answer", async () => {
    const bytes = [...new TextEncoder().encode(JSON.stringify(["usd.testnet"]))];
    const asked: string[] = [];
    const fetcher: typeof fetch = async (url) => {
      asked.push(String(url));
      return String(url).includes("busy")
        ? new Response("Too Many Requests", { status: 429 })
        : new Response(JSON.stringify({ result: { result: bytes } }), { status: 200 });
    };
    const reader = new HouseReader(["http://busy", "http://spare"], "house.testnet", fetcher);
    assert.deepEqual(await reader.assets(), ["usd.testnet"]);
    assert.deepEqual(await reader.assets(), ["usd.testnet"]);
    assert.deepEqual(asked, ["http://busy", "http://spare", "http://spare"]);
  });

  it("names every endpoint when none answers", async () => {
    const down: typeof fetch = async () => new Response("", { status: 503 });
    const reader = new HouseReader(["http://one", "http://two"], "house.testnet", down);
    await assert.rejects(reader.assets(), /no RPC endpoint answered \(http:\/\/one: HTTP 503; http:\/\/two: HTTP 503\)/);
  });

  it("does not retry an error from the contract itself", async () => {
    let calls = 0;
    const failing: typeof fetch = async () => {
      calls++;
      return new Response(JSON.stringify({ result: { error: "wasm execution failed" } }), { status: 200 });
    };
    await assert.rejects(new HouseReader(["http://one", "http://two"], "house.testnet", failing).assets(), RpcError);
    assert.equal(calls, 1);
  });

  it("reports contract errors", async () => {
    const reader = new HouseReader("http://rpc", "house.testnet", reply({ result: { error: "wasm execution failed" } }));
    await assert.rejects(reader.assets(), RpcError);
  });
});
