import { readFileSync } from "node:fs";

import type { ScenarioData } from "../src/config.ts";

// The page imports the scenario through Vite; tests read the same file directly.
const file = JSON.parse(readFileSync(new URL("../../../tools/demo/scenarios/supply-chain.json", import.meta.url), "utf8"));

export const scenario: ScenarioData = {
  name: file.name,
  symbol: file.token.symbol,
  decimals: file.token.decimals,
  maxReductions: file.house.maxReductions,
  firms: file.firms,
  obligations: file.obligations,
};
