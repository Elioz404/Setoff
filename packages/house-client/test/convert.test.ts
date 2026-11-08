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

  it("reports contract errors", async () => {
    const reader = new HouseReader("http://rpc", "house.testnet", reply({ result: { error: "wasm execution failed" } }));
    await assert.rejects(reader.assets(), RpcError);
  });
});
