# Setoff

A clearing house for invoices between firms, on NEAR. Firms record what they owe each other; solvers compete to cancel the
debt that runs in cycles; a contract accepts a cancellation only if no firm's net position changes; what is left is paid
in a NEP-141 stablecoin. Built at NEAR HACKATHON (November 2026). Runs on NEAR testnet with a test token that has no value.

Live page: https://elioz404.github.io/Setoff/ (the demo clearing, the solver comparison, and the house on testnet read
from its contract).

## The problem

Small firms extend each other credit all the time: the bakery owes the mill, the mill owes the farm, the farm owes the
haulier, and somewhere along the chain someone owes the bakery. Each of them waits for cash that is stuck in the next
invoice. When debts run in a circle, most of that cash never needed to move: A owes B 100, B owes C 80 and C owes A 60
can be settled by cancelling 60 on each invoice and paying 40 + 20, instead of moving 240.

Doing this across many firms is called multilateral set-off. It exists today, as a public service in Slovenia and in
mutual-credit networks such as Sardex, and Informal Systems' Cycles protocol has worked on the same problem (multilateral
trade-credit set-off, MTCS) with privacy-preserving computation. These systems rely on an operator, or a dedicated
network, to compute and apply the set-off. Setoff puts the rule in a NEAR contract and opens the computation to anyone:
any solver may propose a cancellation, the best one wins the round, and the contract checks it, so members trust the
arithmetic, not whoever ran it.

## How it works

0. **Join.** The owner admits firms as members (`admit`), the way a clearing house admits the firms that sign its
   set-off agreement. The owner can be a DAO. Only members owe or are owed, so nobody can invent debt between accounts
   of their own to clear it and collect the solver reward.
1. **Issue.** A creditor records an obligation: debtor, token, amount, an invoice reference (`issue`).
2. **Accept.** The debtor confirms it (`accept`). Only accepted obligations can be paid or cancelled; the debtor can
   instead `reject` it, and the creditor can `withdraw` it while it is pending.
3. **Propose.** A solver reads the accepted obligations of one token, finds the clearing that cancels the most debt and
   sends it as a list of reductions with a bond (`submit`). The contract accepts it only if:
   - every reduction is positive, targets a distinct accepted obligation in that token and does not exceed what is owed;
   - for every firm, the total it stops owing equals the total it stops being owed;
   - it cancels strictly more than the round's best proposal so far.

   The first accepted proposal opens a round. Until the round closes, a better proposal replaces the best one and the
   replaced solver gets its bond back. While a line is part of the best proposal it cannot be paid: a payment would make
   the proposal stale, and anyone could then block every round by paying one unit.
4. **Close.** After the round's deadline anyone calls `close_round`. The best proposal is checked again and applied. The
   winner's bond comes back, and it earns a share of the asset's reward pool, which members fund.
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

Requirements: Node 22 or later and Docker (to build and test the Rust code without a local toolchain). For testnet,
also [near-cli-rs](https://github.com/near/near-cli-rs) to create the root account.

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

You need a testnet account with 10 testnet NEAR and its key in the near-cli format. The faucet gives both:

```sh
near account create-account sponsor-by-faucet-service <you>.testnet autogenerate-new-keypair save-to-legacy-keychain network-config testnet create
```

The tool refuses to run unless the account ends in `.testnet` and no RPC is a mainnet one. `NEAR_RPC_URL` may list
several endpoints, separated by commas; by default it uses FastNEAR and then rpc.testnet.near.org.

1. Build the contracts: `sh scripts/build-contracts.sh`, then `npm run demo -- hashes`. You see each wasm's code hash
   as NEAR reports it (base58 of the SHA-256).
2. Create the scenario: `SETOFF_ROOT_ACCOUNT=<you>.testnet npm run demo -- setup`. You see each account, contract,
   admitted member and obligation being created. Keys of the new accounts go to `~/.near-credentials/testnet` (never
   inside the repository; the tool refuses a key directory inside it). Account ids go to `deployments/testnet.json`.
3. Start two solvers in two terminals, each with the key file the setup created for it:

   ```sh
   NEAR_RPC_URL=https://test.rpc.fastnear.com,https://rpc.testnet.near.org \
   SETOFF_CONTRACT=house.<you>.testnet SETOFF_ASSET=tusd.<you>.testnet \
   SOLVER_ACCOUNT_ID=solver-greedy.<you>.testnet SOLVER_STRATEGY=greedy \
   SOLVER_KEY_FILE=$HOME/.near-credentials/testnet/solver-greedy.<you>.testnet.json npm run agent
   ```

   and the same with `solver-optimal` and `SOLVER_STRATEGY=optimal`. You see the greedy solver submit 38,500 tUSD, the
   optimal one outbid it with 40,900, and, two minutes later, one of them close the round. The solvers are programs,
   not language models: each step reads the round, solves, and submits or closes, so their behaviour is reproducible.
4. Run `npm run web` and open **Live on testnet**: the graph, the round and the solver ranking are read from the
   contract every ten seconds.
5. Pay what is left: `SETOFF_ROOT_ACCOUNT=<you>.testnet npm run demo -- settle`. You see each payment and withdrawal,
   then the totals: 40,900 tUSD cleared by set-off, 22,700 paid, nothing owed.

`npm run demo -- report` prints the totals at any time.

## Deployed on testnet

| What | Account |
| --- | --- |
| Clearing house | [`house.setoff.testnet`](https://testnet.nearblocks.io/address/house.setoff.testnet) |
| Test token (tUSD, no value) | [`tusd.setoff.testnet`](https://testnet.nearblocks.io/address/tusd.setoff.testnet) |
| Members | `molino.setoff.testnet`, `panaderia.setoff.testnet`, `granja.setoff.testnet`, `transportes.setoff.testnet`, `empaques.setoff.testnet`, `imprenta.setoff.testnet`, `cafe.setoff.testnet`, `distribuidora.setoff.testnet` |
| Solvers | `solver-greedy.setoff.testnet` (greedy), `solver-optimal.setoff.testnet` (optimal) |

The code on both contracts is the wasm `scripts/build-contracts.sh` builds. `npm run demo -- hashes` prints
`8Em7Cz496rGSv4LNUcfVzurGuHrJjYempmGL7bEztAZA` for the house and `BJo5QGyLZz2RASjkuP5fhmmMJY7Nz91mPSBiVPaNbE2M` for the token, which is the
`code_hash` NEAR reports for each account (`near account view-account-summary <account> network-config testnet now`).
The full list is in `deployments/testnet.json`, which the page reads.

Both accounts are locked: their full-access keys were deleted with `npm run demo -- lock --confirm`, so nobody, the
deployer included, can replace their code, change their configuration or move their NEAR. Check it with
`near account list-keys house.setoff.testnet network-config testnet now` (and the same for `tusd.setoff.testnet`): no
keys are listed.

## Checking the claims

| Claim | Where it is checked |
| --- | --- |
| A clearing that changes any net position is refused | `crates/setoff-core/src/clearing.rs` tests; `contracts/clearing-house/src/tests.rs` `a_proposal_that_moves_value_is_refused` |
| Any set of debt cycles clears, and shaving or padding any line breaks it | `crates/setoff-core/tests/properties.rs` (property tests) |
| Clearing never changes a net position | `clearing_preserves_every_net_position` in the same file |
| Pending obligations cannot be cleared or paid; tokens the house does not accept are refused | `pending_obligations_cannot_be_cleared`, `pending_obligations_cannot_be_paid`, `payments_in_unknown_tokens_are_refused` |
| Only admitted members owe each other, so nobody can clear invented debt for the reward | `only_members_owe_each_other`, `an_expelled_member_cannot_take_on_new_debt`, `only_the_owner_admits_members` |
| A line under proposal cannot be paid until the round closes, so one-unit payments cannot block rounds | `lines_under_proposal_cannot_be_paid_until_the_round_closes`, `a_payment_waits_for_the_round_and_then_settles_the_rest`; on testnet, tx `2AbxTgkc1DVgba1GfjrhaNHxT5P7XijoG9ACFaZNC92K` was refused and refunded |
| Storage is paid by the caller, the bond covers a full proposal | `issuing_without_paying_for_storage_fails`, `the_bond_must_cover_a_full_proposal` |
| Failed withdrawals restore the balance | `a_failed_withdrawal_restores_the_balance` |
| The solver finds the true maximum | `packages/solver/test/oracle.test.ts`: on 500 small books, an exhaustive search that shares no code with the solver gives the same maximum |
| The solver's clearing always passes the rule and leaves nothing to clear | `packages/solver/test/solve.test.ts` (300 random books) |
| Readers move to the next RPC endpoint when one fails, and do not retry contract errors | `packages/house-client/test/convert.test.ts` |
| Active obligations page per token, every page full until the last | `active_obligations_page_by_asset` |
| The optimal solver beats greedy cycle cancelling where cycles share an invoice | `beats the greedy choice when cycles share a debt` |
| The agent never sends a proposal the contract would refuse | `apps/agent/test/agent.test.ts` |
| The scenario figures quoted above | `tools/demo/test/demo.test.ts` |
| The deployed wasm works end to end: a round with an outbid, a refused payment on a line under proposal, close, payment of the rest and withdrawal; a failed withdrawal that keeps the balance; refusals that name their reason | `contracts/sandbox-tests/tests/clearing_round.rs`, on a local NEAR sandbox |
| The owner's role can move to another account (a DAO), and the old owner loses it | `ownership_moves_to_a_new_account`, `the_previous_owner_loses_its_role` |
| A bond refund that cannot be delivered is recorded | `a_failed_bond_refund_is_on_the_record` |
| The wasm is reproducible | `scripts/build-contracts.sh` then `npm run demo -- hashes`; compare with `codeHashes` in `deployments/testnet.json` and with `code_hash` of the deployed accounts |

Run everything:

```sh
docker run --rm -v "$PWD:/work" -w /work rust:1.99.1 sh -c "cargo fmt --all --check && cargo clippy --all-targets --locked -- -D warnings && cargo test --locked"
```

```sh
npm ci && npm run typecheck && npm test
```

The sandbox tests run the built wasm on a local NEAR node (downloaded on first run):

```sh
sh scripts/build-contracts.sh
docker run --rm -v "$PWD:/work" -w /work -e SETOFF_WASM_DIR=target/wasm32-unknown-unknown/release rust:1.99.1 cargo test -p setoff-sandbox-tests --locked
```

On Windows Git Bash, prefix the `docker` commands with `MSYS_NO_PATHCONV=1` and use `"$(pwd -W)"` for `$PWD`.

## Layout

| Path | What it is | Depends on |
| --- | --- | --- |
| `crates/setoff-core` | The set-off rule and payment arithmetic, with no blockchain code | nothing |
| `contracts/clearing-house` | The NEAR contract: obligations, rounds, payments, withdrawals, events, views | `setoff-core`, near-sdk |
| `contracts/test-token` | NEP-141 token with a capped open faucet, for testnet only | near-sdk |
| `contracts/sandbox-tests` | End-to-end tests of both wasm files on a local NEAR sandbox | near-workspaces |
| `packages/solver` | Maximum-circulation solver (negative-cycle cancelling), a greedy solver, cycle decomposition | nothing |
| `packages/house-client` | Typed views over JSON-RPC (browser and Node) and a signing writer (Node only) | `solver`, near-api-js |
| `apps/agent` | A solver agent: reads, solves, submits or closes the round, in a loop | `house-client`, `solver` |
| `apps/web` | Static page: the demo clearing, the solver comparison and, once deployed, the live house | `house-client`, `solver` |
| `tools/demo` | Creates, settles and locks the testnet scenario; prints code hashes | `house-client`, `solver`, near-api-js |

## Security notes

- **No trusted proposer.** The contract re-checks every proposal when it is submitted and again when the round closes.
- **Members.** Only members admitted by the owner can issue or accept obligations. Without this, two accounts of the
  same person could issue each other any amount and clear it to drain the reward pool and outbid honest clearings.
- **Rounds cannot be blocked.** Lines of the best proposal cannot be paid until `close_round`, so a payment cannot make
  a proposal stale. Rounds last at most one hour, which bounds how long any proposal, honest or not, holds a payment.
- **Bonds.** The proposal bond must cover the storage of a full proposal and of its winner's records, so the contract
  never pays a solver's storage. Every bond refund is followed by a `bond_returned` or `bond_return_failed` event.
- **Readable refusals.** The contracts are built with `--cfg near`, so a refusal reaches the caller as
  `Smart contract panicked: <reason>` instead of a bare wasm trap.
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
- **Configuration.** Round length, proposal size, bond and reward rate are set at deployment; the contract has no
  method to change them. Only replacing the code could, and the deployed accounts have no keys left to do it
  (`npm run demo -- lock --confirm` deleted them). The owner's role can be handed to a DAO with `transfer_ownership`.

## Limits

- Set-off cancels debt that runs in cycles. A chain (A owes B, B owes C) is left as it is: cancelling it would change who
  owes whom. The page shows the floor no clearing can go below, what net debtors owe.
- Obligations and amounts are public on chain. Firms that need their trading relationships private would need the graph
  kept off chain, which this version does not do.
- Set-off between firms needs a legal agreement among the members; the contract enforces the arithmetic, not the law.
- This version clears one token at a time; obligations in different tokens are never netted against each other.
- The owner decides who is a member. That is how clearing houses work, but it is a trusted role; it can be held by a
  DAO.
- When the best clearing touches more invoices than `max_reductions`, the solver keeps whole cycles, largest first, and
  reports the result as not optimal.
- Obligations are kept as history once settled; their storage is not released.
- `list_active` filters every active obligation by token on each call, which is fine for thousands of obligations but
  would need a per-token index at a larger scale.
- A solver can hold up payment of the lines it proposes for at most one round (one hour at most), even with a tiny
  clearing; any better proposal replaces it.
- Every firm needs a NEAR account with a little NEAR for gas. Meta transactions would remove that; this version does
  not have them.
- Testnet only. The test token has an open faucet and must never be deployed to mainnet.

## Other project

The same author also submitted **Undiluted** (https://github.com/Elioz404/Undiluted), a confidential cap table. The two
projects share no code and are independent.

## Credits

Built with near-sdk, near-contract-standards, near-api-js, React and Vite; type is Newsreader and IBM Plex Sans, self-hosted through Fontsource. Written with help from an AI coding assistant.

## License

MIT, see `LICENSE`.
