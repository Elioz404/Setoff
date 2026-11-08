# Setoff

A clearing house for invoices between firms, on NEAR. Firms record what they owe each other; solvers compete to cancel the
debt that runs in cycles; a contract accepts a cancellation only if no firm's net position changes; what is left is paid
in a NEP-141 stablecoin. Built at NEAR HACKATHON (November 2026). Runs on NEAR testnet with a test token that has no value.

## The problem

Small firms extend each other credit all the time: the bakery owes the mill, the mill owes the farm, the farm owes the
haulier, and somewhere along the chain someone owes the bakery. Each of them waits for cash that is stuck in the next
invoice. When debts run in a circle, most of that cash never needed to move: A owes B 100, B owes C 80 and C owes A 60
can be settled by cancelling 60 on each invoice and paying 40 + 20, instead of moving 240.

Doing this across many firms is called multilateral set-off. It exists today, for example as a public service in
Slovenia and in mutual-credit networks such as Sardex, but always run by a trusted operator who sees every firm's books
and decides what to cancel. Setoff removes that operator: anyone may propose a cancellation, and the contract checks it.

## How it works

1. **Issue.** A creditor records an obligation: debtor, token, amount, an invoice reference (`issue`).
2. **Accept.** The debtor confirms it (`accept`). Only accepted obligations can be paid or cancelled; the debtor can
   instead `reject` it, and the creditor can `withdraw` it while it is pending.
3. **Propose.** A solver reads the accepted obligations of one token, finds the clearing that cancels the most debt and
   sends it as a list of reductions with a bond (`submit`). The contract accepts it only if:
   - every reduction is positive, targets a distinct accepted obligation in that token and does not exceed what is owed;
   - for every firm, the total it stops owing equals the total it stops being owed;
   - it cancels strictly more than the round's best proposal so far.

   The first accepted proposal opens a round. Until the round closes, a better proposal replaces the best one and the
   replaced solver gets its bond back.
4. **Close.** After the round's deadline anyone calls `close_round`. The best proposal is checked again against the
   current state, since payments may have happened meanwhile, and applied if it still passes; otherwise it is discarded
   and nothing changes. The winner's bond comes back, and it earns a share of the asset's reward pool, which members fund.
5. **Pay the rest.** A debtor pays with `ft_transfer_call` to the house and the message `{"pay":{"obligation":"<id>"}}`.
   Overpayment is returned. The creditor is credited and calls `withdraw_balance` to receive the tokens.

Because the rule in step 3 keeps every net position unchanged, a proposal cannot move value between firms, whoever sends
it. That is what lets solvers be anyone, including automated agents.

### Why NEAR

- The rule is checked in a contract call that costs a fraction of a cent, so a proposal can touch dozens of invoices.
- Firms are named accounts (`panaderia.<root>.testnet`), and every solver is its own sub-account whose record is public.
- Settlement uses NEP-141 tokens and `ft_transfer_call`, so a stablecoin on NEAR works as is; the demo deploys its own
  test token so that nothing costs real money.
- Events follow NEP-297 (`EVENT_JSON:{"standard":"setoff",...}`), so indexers can follow the house without reading state.

## Try it

Requirements: Node 22 or later, Docker (to build and test the Rust code without a local toolchain).

### In the browser, with no account

1. Run `npm ci`, then `npm run web`, and open the address Vite prints.
2. The first screen shows eight firms of one supply chain and 15 accepted invoices worth 63,600 tUSD, with each firm's
   net position.
3. Press **Clear the debts**. The cancelled part of each invoice turns green: 40,900 tUSD (64.3%) is cancelled, 22,700
   tUSD is left to pay, and no net position changes.
4. Scroll to **Solvers compete for each round**: a greedy solver cancels 38,500 tUSD on the same invoices, 2,400 less,
   which is why the optimal solver outbids it on chain. **Every invoice, before and after** lists the clearing line by line.

These figures are asserted by `tools/demo/test/demo.test.ts`.

### On testnet

You need a funded testnet account (10 testnet NEAR is enough; `near account create-account sponsor-by-faucet-service` creates one) and its key in the near-cli format, usually
`~/.near-credentials/testnet/<account>.json`. The tool refuses to run unless the account ends in `.testnet` and the RPC is
not mainnet.

1. Build the contracts: `sh scripts/build-contracts.sh`. You see the sha256 of both wasm files.
2. Create the scenario: `SETOFF_ROOT_ACCOUNT=<you>.testnet npm run demo -- setup`. You see each account, contract and
   obligation being created. Keys of the new accounts go to `~/.near-credentials/testnet` (never inside the repository;
   the tool refuses a key directory inside it). Account ids are written to `deployments/testnet.json`.
3. Start two solvers in two terminals, each with the key the setup created for it:

   ```sh
   NEAR_RPC_URL=https://test.rpc.fastnear.com SETOFF_CONTRACT=house.<you>.testnet SETOFF_ASSET=tusd.<you>.testnet \
   SOLVER_ACCOUNT_ID=solver-greedy.<you>.testnet SOLVER_PRIVATE_KEY=<its key> SOLVER_STRATEGY=greedy npm run agent
   ```

   and the same with `solver-optimal` and `SOLVER_STRATEGY=optimal`. You see the greedy solver submit 38,500 tUSD, the
   optimal one outbid it with 40,900, and, two minutes later, one of them close the round.
4. Run `npm run web` and open **Live on testnet**: the graph, the round and the solver ranking are read from the
   contract every five seconds.
5. Pay what is left: `SETOFF_ROOT_ACCOUNT=<you>.testnet npm run demo -- settle`. You see each payment and withdrawal,
   then the totals: 40,900 tUSD cleared by set-off, 22,700 paid, nothing owed.

`npm run demo -- report` prints the totals at any time.

## Deployed on testnet

| What | Account |
| --- | --- |
| Clearing house | [`house.setoff-demo.testnet`](https://testnet.nearblocks.io/address/house.setoff-demo.testnet) |
| Test token (tUSD, no value) | [`tusd.setoff-demo.testnet`](https://testnet.nearblocks.io/address/tusd.setoff-demo.testnet) |
| Firms | `molino.setoff-demo.testnet`, `panaderia.setoff-demo.testnet`, `granja.setoff-demo.testnet`, `transportes.setoff-demo.testnet`, `empaques.setoff-demo.testnet`, `imprenta.setoff-demo.testnet`, `cafe.setoff-demo.testnet`, `distribuidora.setoff-demo.testnet` |
| Solvers | `solver-greedy.setoff-demo.testnet` (greedy), `solver-optimal.setoff-demo.testnet` (optimal) |

The code on both contracts is the wasm `scripts/build-contracts.sh` builds: its base58 SHA-256 is
`6iKSEgVwfn5kBoL1mgLpZFLppg9k7RnTe7WYmSjaKb7X` for the house and `88umVdbGU34WL6K6TmwWPXhrVoDrQbrsaDouugqzp2qn` for the token, which is what
`near account view-account-summary <account> network-config testnet now` reports as the code hash. The full list is in
`deployments/testnet.json`, which the page reads.

## Checking the claims

| Claim | Where it is checked |
| --- | --- |
| A clearing that changes any net position is refused | `crates/setoff-core/src/clearing.rs` tests; `contracts/clearing-house/src/tests.rs` `a_proposal_that_moves_value_is_refused` |
| Any set of debt cycles clears, and shaving or padding any line breaks it | `crates/setoff-core/tests/properties.rs` (property tests) |
| Clearing never changes a net position | `clearing_preserves_every_net_position` in the same file |
| Pending obligations cannot be cleared or paid; tokens the house does not accept are refused | `pending_obligations_cannot_be_cleared`, `pending_obligations_cannot_be_paid`, `payments_in_unknown_tokens_are_refused` |
| Proposals made stale by payments are discarded, not applied | `a_proposal_made_stale_by_a_payment_is_discarded` |
| Storage is paid by the caller, the bond covers a full proposal | `issuing_without_paying_for_storage_fails`, `the_bond_must_cover_a_full_proposal` |
| Failed withdrawals restore the balance | `a_failed_withdrawal_restores_the_balance` |
| The solver's clearing is optimal (no residual cycle can clear more) and always passes the rule | `packages/solver/test/solve.test.ts` (300 random books) |
| The optimal solver beats greedy cycle cancelling where cycles share an invoice | `beats the greedy choice when cycles share a debt` |
| The agent never sends a proposal the contract would refuse | `apps/agent/test/agent.test.ts` |
| The scenario figures quoted above | `tools/demo/test/demo.test.ts` |
| The wasm is reproducible | `scripts/build-contracts.sh` prints the hashes; compare with `codeHashes` in `deployments/testnet.json` and with `code_hash` of the deployed accounts |

Run everything:

```sh
docker run --rm -v "$PWD:/work" -w /work rust:1.99.1 sh -c "cargo fmt --check && cargo clippy --all-targets --locked -- -D warnings && cargo test --locked"
```

```sh
npm ci && npm run typecheck && npm test
```

## Layout

| Path | What it is | Depends on |
| --- | --- | --- |
| `crates/setoff-core` | The set-off rule and payment arithmetic, with no blockchain code | nothing |
| `contracts/clearing-house` | The NEAR contract: obligations, rounds, payments, withdrawals, events, views | `setoff-core`, near-sdk |
| `contracts/test-token` | NEP-141 token with a capped open faucet, for testnet only | near-sdk |
| `packages/solver` | Maximum-circulation solver (negative-cycle cancelling), a greedy solver, cycle decomposition | nothing |
| `packages/house-client` | Typed views over JSON-RPC (browser and Node) and a signing writer (Node only) | `solver`, near-api-js |
| `apps/agent` | A solver agent: reads, solves, submits or closes the round, in a loop | `house-client`, `solver` |
| `apps/web` | Static page: the demo clearing, the solver comparison and, once deployed, the live house | `house-client`, `solver` |
| `tools/demo` | Creates and settles the testnet scenario | `house-client`, `solver`, near-api-js |

## Security notes

- **No trusted proposer.** The contract re-checks every proposal when it is submitted and again when the round closes.
- **Consent.** Only the debtor can accept an obligation; accepting it is consent to its being paid or set off.
- **Storage.** Every call that adds state charges the caller for exactly the bytes added and refunds the rest.
  Collections are flushed before measuring, so lazily written entries are counted.
- **Bounded work.** A proposal has at most `max_reductions` lines (128 at most), so checking and applying it always fits
  in one call. List views return at most 100 entries.
- **Arithmetic.** Sums use checked `u128` arithmetic; overflow refuses the proposal instead of wrapping.
- **Tokens.** Only tokens added by the owner are accepted; a transfer with an unreadable message or for the wrong
  obligation panics, so the token contract returns it. Withdrawals debit first and restore the balance if the transfer
  fails, and need a 1 yoctoNEAR deposit, so a function-call key alone cannot trigger them.
- **Keys.** The agent and the demo tool read keys from the environment or from key files outside the repository.
- **Configuration is fixed.** Round length, proposal size, bond and reward rate are set at deployment and cannot change.

## Limits

- Set-off cancels debt that runs in cycles. A chain (A owes B, B owes C) is left as it is: cancelling it would change who
  owes whom. The page shows the floor no clearing can go below, what net debtors owe.
- Obligations and amounts are public on chain. Firms that need their trading relationships private would need the graph
  kept off chain, which this version does not do.
- Set-off between firms needs a legal agreement among the members; the contract enforces the arithmetic, not the law.
- This version clears one token at a time; obligations in different tokens are never netted against each other.
- Testnet only. The test token has an open faucet and must never be deployed to mainnet.

## Other project

The same author also submitted **Undiluted** (https://github.com/Elioz404/Undiluted), a confidential cap table. The two
projects share no code and are independent.

## Credits

Built with near-sdk, near-contract-standards, near-api-js, React and Vite; type is Newsreader and IBM Plex Sans, self-hosted through Fontsource. Written with help from an AI coding assistant.

## License

MIT, see `LICENSE`.
