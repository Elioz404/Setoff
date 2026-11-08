import { useEffect, useState } from "react";

import { HouseReader, type HouseConfig, type ObligationView, type RoundView, type SolverView } from "@setoff/house-client";

import type { Deployment } from "../config.ts";

const POLL_MS = 10_000;

export interface LiveState {
  readonly config: HouseConfig;
  readonly obligations: readonly ObligationView[];
  readonly round: RoundView;
  readonly solvers: readonly SolverView[];
  readonly rewardPool: bigint;
  readonly readAt: Date;
}

export type Live =
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly state: LiveState; readonly error?: string }
  | { readonly status: "failed"; readonly error: string };

/** Polls the clearing house and keeps the last good reading if a poll fails. */
export function useLiveHouse(deployment: Deployment): Live {
  const [live, setLive] = useState<Live>({ status: "loading" });

  useEffect(() => {
    const reader = new HouseReader(deployment.rpcUrls, deployment.house);
    const asset = deployment.token.account;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const poll = async () => {
      try {
        const [config, obligations, round, solvers, rewardPool] = await Promise.all([
          reader.config(),
          reader.obligations(),
          reader.round(asset),
          reader.solvers(),
          reader.rewardPool(asset),
        ]);
        if (!cancelled) setLive({ status: "ready", state: { config, obligations, round, solvers, rewardPool, readAt: new Date() } });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!cancelled) {
          setLive((previous) => (previous.status === "ready" ? { ...previous, error: message } : { status: "failed", error: message }));
        }
      }
      if (!cancelled) timer = setTimeout(poll, POLL_MS);
    };
    void poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [deployment]);

  return live;
}
