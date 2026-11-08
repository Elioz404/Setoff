//! The contracts as deployed, on a local NEAR sandbox: real cross-contract
//! calls, real refunds, real block time. The wasm files come from
//! `scripts/build-contracts.sh` (or `SETOFF_WASM_DIR`).

use std::path::PathBuf;

use near_workspaces::network::Sandbox;
use near_workspaces::result::ExecutionFinalResult;
use near_workspaces::types::{Gas, NearToken};
use near_workspaces::{Account, Contract, Worker};
use serde_json::{json, Value};

const STORAGE: NearToken = NearToken::from_millinear(50);
const BOND: NearToken = NearToken::from_millinear(100);
const ONE_YOCTO: NearToken = NearToken::from_yoctonear(1);
const GAS: Gas = Gas::from_tgas(100);

fn wasm(name: &str) -> Vec<u8> {
    let dir = std::env::var("SETOFF_WASM_DIR").map_or_else(
        |_| PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../target/wasm32-unknown-unknown/release"),
        PathBuf::from,
    );
    let path = dir.join(name);
    std::fs::read(&path)
        .unwrap_or_else(|_| panic!("{} is missing: run scripts/build-contracts.sh first", path.display()))
}

struct Setup {
    worker: Worker<Sandbox>,
    token: Contract,
    house: Contract,
    owner: Account,
    firms: [Account; 3],
}

/// A house with one token and three member firms, a, b and c, each holding
/// 1,000 units. Rounds last one second.
async fn setup() -> anyhow::Result<Setup> {
    let worker = near_workspaces::sandbox().await?;
    let token = worker.dev_deploy(&wasm("setoff_test_token.wasm")).await?;
    let house = worker.dev_deploy(&wasm("setoff_clearing_house.wasm")).await?;
    let owner = worker.dev_create_account().await?;
    let firms = [
        worker.dev_create_account().await?,
        worker.dev_create_account().await?,
        worker.dev_create_account().await?,
    ];

    token
        .call("new")
        .args_json(json!({ "name": "Test Dollar", "symbol": "tUSD", "decimals": 0, "faucet_cap": "1000" }))
        .transact()
        .await?
        .into_result()?;
    house
        .call("new")
        .args_json(json!({
            "owner": owner.id(),
            "config": { "round_duration_ns": "1000000000", "max_reductions": 16, "proposal_bond": BOND, "reward_bps": 0 },
            "assets": [token.id()],
        }))
        .transact()
        .await?
        .into_result()?;
    owner
        .call(house.id(), "admit")
        .args_json(json!({ "accounts": firms.iter().map(Account::id).collect::<Vec<_>>() }))
        .deposit(STORAGE)
        .transact()
        .await?
        .into_result()?;

    register(&owner, &token, house.id().as_str()).await?;
    for firm in &firms {
        register(&owner, &token, firm.id().as_str()).await?;
        firm.call(token.id(), "faucet")
            .args_json(json!({ "amount": "1000" }))
            .transact()
            .await?
            .into_result()?;
    }
    Ok(Setup { worker, token, house, owner, firms })
}

async fn register(payer: &Account, token: &Contract, account: &str) -> anyhow::Result<()> {
    payer
        .call(token.id(), "storage_deposit")
        .args_json(json!({ "account_id": account, "registration_only": true }))
        .deposit(STORAGE)
        .transact()
        .await?
        .into_result()?;
    Ok(())
}

/// `creditor` issues an obligation on `debtor`, who accepts it; returns its id.
async fn owe(s: &Setup, debtor: usize, creditor: usize, amount: u64) -> anyhow::Result<String> {
    let id: String = s.firms[creditor]
        .call(s.house.id(), "issue")
        .args_json(json!({ "debtor": s.firms[debtor].id(), "asset": s.token.id(), "amount": amount.to_string(), "reference": "" }))
        .deposit(STORAGE)
        .transact()
        .await?
        .json()?;
    s.firms[debtor]
        .call(s.house.id(), "accept")
        .args_json(json!({ "id": id }))
        .deposit(STORAGE)
        .transact()
        .await?
        .into_result()?;
    Ok(id)
}

async fn pay(s: &Setup, payer: usize, obligation: &str, amount: u64) -> anyhow::Result<ExecutionFinalResult> {
    Ok(s.firms[payer]
        .call(s.token.id(), "ft_transfer_call")
        .args_json(json!({
            "receiver_id": s.house.id(),
            "amount": amount.to_string(),
            "msg": json!({ "pay": { "obligation": obligation } }).to_string(),
        }))
        .deposit(ONE_YOCTO)
        .gas(GAS)
        .transact()
        .await?)
}

async fn token_balance(s: &Setup, account: &Account) -> anyhow::Result<u64> {
    let balance: String =
        s.token.view("ft_balance_of").args_json(json!({ "account_id": account.id() })).await?.json()?;
    Ok(balance.parse()?)
}

async fn outstanding(s: &Setup, id: &str) -> anyhow::Result<u64> {
    let view: Value = s.house.view("get_obligation").args_json(json!({ "id": id })).await?.json()?;
    Ok(view["outstanding"].as_str().unwrap_or_default().parse()?)
}

fn reductions(lines: &[(&str, u64)]) -> Value {
    Value::Array(
        lines.iter().map(|(id, amount)| json!({ "obligation": id, "amount": amount.to_string() })).collect(),
    )
}

fn logs_contain(result: &ExecutionFinalResult, needle: &str) -> bool {
    result.logs().iter().any(|line| line.contains(needle))
}

#[tokio::test]
async fn a_round_clears_the_cycle_and_the_rest_is_paid_in_tokens() -> anyhow::Result<()> {
    let s = setup().await?;
    // a owes b 100, b owes c 80, c owes a 60.
    let ab = owe(&s, 0, 1, 100).await?;
    let bc = owe(&s, 1, 2, 80).await?;
    let ca = owe(&s, 2, 0, 60).await?;
    let [weak, strong] = [s.worker.dev_create_account().await?, s.worker.dev_create_account().await?];

    weak.call(s.house.id(), "submit")
        .args_json(
            json!({ "asset": s.token.id(), "reductions": reductions(&[(&ab, 10), (&bc, 10), (&ca, 10)]) }),
        )
        .deposit(BOND)
        .gas(GAS)
        .transact()
        .await?
        .into_result()?;
    let outbid = strong
        .call(s.house.id(), "submit")
        .args_json(
            json!({ "asset": s.token.id(), "reductions": reductions(&[(&ab, 60), (&bc, 60), (&ca, 60)]) }),
        )
        .deposit(BOND)
        .gas(GAS)
        .transact()
        .await?;
    assert!(outbid.is_success(), "{outbid:?}");
    assert!(logs_contain(&outbid, r#""event":"bond_returned""#), "the outbid solver's bond comes back");

    // A line under proposal cannot be paid: the house refuses, the token refunds.
    let before = token_balance(&s, &s.firms[2]).await?;
    let locked = pay(&s, 2, &ca, 1).await?;
    assert!(
        locked.receipt_failures().iter().any(|f| format!("{f:?}").contains("best proposal")),
        "{locked:?}"
    );
    assert_eq!(token_balance(&s, &s.firms[2]).await?, before);

    s.worker.fast_forward(5).await?;
    s.owner
        .call(s.house.id(), "close_round")
        .args_json(json!({ "asset": s.token.id() }))
        .gas(GAS)
        .transact()
        .await?
        .into_result()?;
    assert_eq!(
        [outstanding(&s, &ab).await?, outstanding(&s, &bc).await?, outstanding(&s, &ca).await?],
        [40, 20, 0]
    );

    assert!(pay(&s, 0, &ab, 50).await?.is_success());
    assert!(pay(&s, 1, &bc, 20).await?.is_success());
    for creditor in [1, 2] {
        s.firms[creditor]
            .call(s.house.id(), "withdraw_balance")
            .args_json(json!({ "asset": s.token.id() }))
            .deposit(ONE_YOCTO)
            .gas(GAS)
            .transact()
            .await?
            .into_result()?;
    }

    // 240 of debt settled with 60 tokens moving; a's overpayment of 10 came back.
    assert_eq!(token_balance(&s, &s.firms[0]).await?, 1000 - 40);
    assert_eq!(token_balance(&s, &s.firms[1]).await?, 1000 + 40 - 20);
    assert_eq!(token_balance(&s, &s.firms[2]).await?, 1000 + 20);
    Ok(())
}

#[tokio::test]
async fn a_failed_withdrawal_leaves_the_balance_in_the_house() -> anyhow::Result<()> {
    let s = setup().await?;
    let outsider = s.worker.dev_create_account().await?;
    s.owner
        .call(s.house.id(), "admit")
        .args_json(json!({ "accounts": [outsider.id()] }))
        .deposit(STORAGE)
        .transact()
        .await?
        .into_result()?;
    // The outsider is a member but not registered with the token.
    let id: String = outsider
        .call(s.house.id(), "issue")
        .args_json(
            json!({ "debtor": s.firms[0].id(), "asset": s.token.id(), "amount": "30", "reference": "" }),
        )
        .deposit(STORAGE)
        .transact()
        .await?
        .json()?;
    s.firms[0]
        .call(s.house.id(), "accept")
        .args_json(json!({ "id": id }))
        .deposit(STORAGE)
        .transact()
        .await?
        .into_result()?;
    assert!(pay(&s, 0, &id, 30).await?.is_success());

    let withdrawal = outsider
        .call(s.house.id(), "withdraw_balance")
        .args_json(json!({ "asset": s.token.id() }))
        .deposit(ONE_YOCTO)
        .gas(GAS)
        .transact()
        .await?;
    assert!(logs_contain(&withdrawal, r#""event":"withdrawal_failed""#), "{withdrawal:?}");
    let balance: String = s
        .house
        .view("get_balance")
        .args_json(json!({ "account": outsider.id(), "asset": s.token.id() }))
        .await?
        .json()?;
    assert_eq!(balance, "30");
    Ok(())
}

#[tokio::test]
async fn refusals_reach_the_caller_with_their_reason() -> anyhow::Result<()> {
    let s = setup().await?;
    let stranger = s.worker.dev_create_account().await?;
    let refused = stranger
        .call(s.house.id(), "issue")
        .args_json(
            json!({ "debtor": s.firms[0].id(), "asset": s.token.id(), "amount": "1", "reference": "" }),
        )
        .deposit(STORAGE)
        .transact()
        .await?;
    assert!(refused.is_failure());
    assert!(format!("{refused:?}").contains("is not a member of this clearing house"), "{refused:?}");
    Ok(())
}
