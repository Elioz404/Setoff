use near_contract_standards::fungible_token::receiver::FungibleTokenReceiver;
use near_sdk::json_types::{U128, U64};
use near_sdk::test_utils::{get_logs, VMContextBuilder};
use near_sdk::{testing_env, AccountId, NearToken, PromiseResult};

use crate::{ClearingHouse, Config, ObligationStatus, ReductionInput};

const SECOND: u64 = 1_000_000_000;
const ROUND: u64 = 60 * SECOND;
const STORAGE: NearToken = NearToken::from_millinear(100);
const BOND: NearToken = NearToken::from_millinear(500);

/// `"a"` is the account `a.test`; names with a dot are taken as they are.
fn account(name: &str) -> AccountId {
    if name.contains('.') {
        name.parse().unwrap()
    } else {
        format!("{name}.test").parse().unwrap()
    }
}

fn usd() -> AccountId {
    account("usd.test")
}

/// Sets who calls next, with what deposit, at what time.
struct Env {
    now: u64,
}

impl Env {
    fn call(&self, caller: &str, deposit: NearToken) {
        let context = VMContextBuilder::new()
            .current_account_id(account("house.test"))
            .predecessor_account_id(account(caller))
            .signer_account_id(account(caller))
            .attached_deposit(deposit)
            .block_timestamp(self.now)
            .account_balance(NearToken::from_near(100))
            .build();
        testing_env!(context);
    }

    fn callback(&self, result: PromiseResult) {
        let context = VMContextBuilder::new()
            .current_account_id(account("house.test"))
            .predecessor_account_id(account("house.test"))
            .block_timestamp(self.now)
            .build();
        testing_env!(
            context,
            near_sdk::test_vm_config(),
            near_sdk::RuntimeFeesConfig::test(),
            std::collections::HashMap::default(),
            vec![result]
        );
    }
}

fn config() -> Config {
    Config { round_duration_ns: U64(ROUND), max_reductions: 16, proposal_bond: BOND, reward_bps: 50 }
}

/// A house whose members are the firms a, b and c.
fn house(env: &Env) -> ClearingHouse {
    env.call("owner.test", NearToken::from_yoctonear(0));
    let mut house = ClearingHouse::new(account("owner.test"), config(), vec![usd()]);
    env.call("owner.test", STORAGE);
    house.admit(vec![account("a"), account("b"), account("c")]);
    house
}

fn issue(env: &Env, house: &mut ClearingHouse, creditor: &str, debtor: &str, amount: u128) -> U64 {
    env.call(creditor, STORAGE);
    let id = house.issue(account(debtor), usd(), U128(amount), format!("INV-{creditor}-{debtor}"));
    env.call(debtor, STORAGE);
    house.accept(id);
    id
}

fn line(id: U64, amount: u128) -> ReductionInput {
    ReductionInput { obligation: id, amount: U128(amount) }
}

fn outstanding(house: &ClearingHouse, id: U64) -> u128 {
    house.get_obligation(id).unwrap().outstanding.0
}

/// a owes b 100, b owes c 80, c owes a 60.
fn triangle(env: &Env, house: &mut ClearingHouse) -> [U64; 3] {
    [issue(env, house, "b", "a", 100), issue(env, house, "c", "b", 80), issue(env, house, "a", "c", 60)]
}

fn pay(env: &Env, house: &mut ClearingHouse, payer: &str, id: U64, amount: u128) -> u128 {
    env.call("usd.test", NearToken::from_yoctonear(1));
    let msg = format!(r#"{{"pay":{{"obligation":"{}"}}}}"#, id.0);
    match house.ft_on_transfer(account(payer), U128(amount), msg) {
        near_sdk::PromiseOrValue::Value(unused) => unused.0,
        near_sdk::PromiseOrValue::Promise(_) => panic!("payments never return a promise"),
    }
}

#[test]
fn an_obligation_waits_for_its_debtor() {
    let env = Env { now: 0 };
    let mut house = house(&env);
    env.call("b", STORAGE);
    let id = house.issue(account("a"), usd(), U128(100), "INV-1".into());
    assert_eq!(house.get_obligation(id).unwrap().status, ObligationStatus::Pending);
    assert_eq!(house.active_count(), U64(0));

    env.call("a", STORAGE);
    house.accept(id);
    assert_eq!(house.get_obligation(id).unwrap().status, ObligationStatus::Active);
    assert_eq!(house.list_active(usd(), None, None).len(), 1);
}

#[test]
#[should_panic(expected = "only the debtor can accept an obligation")]
fn only_the_debtor_accepts() {
    let env = Env { now: 0 };
    let mut house = house(&env);
    env.call("b", STORAGE);
    let id = house.issue(account("a"), usd(), U128(100), String::new());
    env.call("b", STORAGE);
    house.accept(id);
}

#[test]
#[should_panic(expected = "obligation is no longer pending")]
fn a_withdrawn_obligation_cannot_be_accepted() {
    let env = Env { now: 0 };
    let mut house = house(&env);
    env.call("b", STORAGE);
    let id = house.issue(account("a"), usd(), U128(100), String::new());
    house.withdraw(id);
    env.call("a", STORAGE);
    house.accept(id);
}

#[test]
#[should_panic(expected = "attach at least")]
fn issuing_without_paying_for_storage_fails() {
    let env = Env { now: 0 };
    let mut house = house(&env);
    env.call("b", NearToken::from_yoctonear(0));
    house.issue(account("a"), usd(), U128(100), String::new());
}

#[test]
#[should_panic(expected = "asset is not accepted")]
fn obligations_need_an_accepted_asset() {
    let env = Env { now: 0 };
    let mut house = house(&env);
    env.call("b", STORAGE);
    house.issue(account("a"), account("other.test"), U128(100), String::new());
}

#[test]
#[should_panic(expected = "an obligation needs two different parties")]
fn nobody_owes_themselves() {
    let env = Env { now: 0 };
    let mut house = house(&env);
    env.call("a", STORAGE);
    house.issue(account("a"), usd(), U128(100), String::new());
}

#[test]
fn the_best_proposal_of_a_round_clears_the_cycle() {
    let mut env = Env { now: 0 };
    let mut house = house(&env);
    let [ab, bc, ca] = triangle(&env, &mut house);

    env.call("solver-1", BOND);
    let first = house.submit(usd(), vec![line(ab, 10), line(bc, 10), line(ca, 10)]);
    assert_eq!(first, U128(30));

    env.call("solver-2", BOND);
    house.submit(usd(), vec![line(ab, 60), line(bc, 60), line(ca, 60)]);
    assert_eq!(house.get_round(usd()).best.unwrap().solver, account("solver-2"));

    env.now = ROUND;
    env.call("anyone", NearToken::from_yoctonear(0));
    house.close_round(usd());

    assert_eq!(outstanding(&house, ab), 40);
    assert_eq!(outstanding(&house, bc), 20);
    assert_eq!(outstanding(&house, ca), 0);
    assert_eq!(house.get_obligation(ca).unwrap().status, ObligationStatus::Discharged);
    assert_eq!(house.get_obligation(ab).unwrap().cleared, U128(60));
    assert_eq!(house.active_count(), U64(2));
    assert_eq!(house.get_round(usd()).id, U64(2));
    let solvers = house.list_solvers(None, None);
    assert_eq!(solvers.len(), 1);
    assert_eq!(solvers[0].solver, account("solver-2"));
    assert_eq!(solvers[0].stats.cleared, U128(180));
    assert!(get_logs().iter().any(|l| l.contains(r#""event":"clearing_applied""#)));
}

#[test]
#[should_panic(expected = "does not clear more than the current best")]
fn an_equal_proposal_does_not_replace_the_best() {
    let env = Env { now: 0 };
    let mut house = house(&env);
    let [ab, bc, ca] = triangle(&env, &mut house);
    let proposal = vec![line(ab, 60), line(bc, 60), line(ca, 60)];
    env.call("solver-1", BOND);
    house.submit(usd(), proposal.clone());
    env.call("solver-2", BOND);
    house.submit(usd(), proposal);
}

#[test]
#[should_panic(expected = "clearing refused: the clearing changes the net position")]
fn a_proposal_that_moves_value_is_refused() {
    let env = Env { now: 0 };
    let mut house = house(&env);
    let [ab, bc, _] = triangle(&env, &mut house);
    env.call("solver-1", BOND);
    house.submit(usd(), vec![line(ab, 50), line(bc, 50)]);
}

#[test]
#[should_panic(expected = "clearing refused: obligation 0 does not exist or cannot be cleared")]
fn pending_obligations_cannot_be_cleared() {
    let env = Env { now: 0 };
    let mut house = house(&env);
    env.call("b", STORAGE);
    let ab = house.issue(account("a"), usd(), U128(100), String::new());
    env.call("a", STORAGE);
    let ba = house.issue(account("b"), usd(), U128(100), String::new());
    env.call("b", STORAGE);
    house.accept(ba);
    env.call("solver-1", BOND);
    house.submit(usd(), vec![line(ab, 100), line(ba, 100)]);
}

#[test]
#[should_panic(expected = "attach at least")]
fn a_proposal_needs_its_bond() {
    let env = Env { now: 0 };
    let mut house = house(&env);
    let [ab, bc, ca] = triangle(&env, &mut house);
    env.call("solver-1", NearToken::from_millinear(1));
    house.submit(usd(), vec![line(ab, 60), line(bc, 60), line(ca, 60)]);
}

#[test]
#[should_panic(expected = "the round is still open")]
fn a_round_cannot_close_early() {
    let env = Env { now: 0 };
    let mut house = house(&env);
    let [ab, bc, ca] = triangle(&env, &mut house);
    env.call("solver-1", BOND);
    house.submit(usd(), vec![line(ab, 60), line(bc, 60), line(ca, 60)]);
    house.close_round(usd());
}

#[test]
#[should_panic(expected = "the round is over: call close_round first")]
fn a_round_takes_no_proposal_after_its_deadline() {
    let mut env = Env { now: 0 };
    let mut house = house(&env);
    let [ab, bc, ca] = triangle(&env, &mut house);
    env.call("solver-1", BOND);
    house.submit(usd(), vec![line(ab, 10), line(bc, 10), line(ca, 10)]);
    env.now = ROUND;
    env.call("solver-2", BOND);
    house.submit(usd(), vec![line(ab, 60), line(bc, 60), line(ca, 60)]);
}

#[test]
#[should_panic(expected = "obligation is part of the open round's best proposal: pay after close_round")]
fn lines_under_proposal_cannot_be_paid_until_the_round_closes() {
    let env = Env { now: 0 };
    let mut house = house(&env);
    let [ab, bc, ca] = triangle(&env, &mut house);
    env.call("solver-1", BOND);
    house.submit(usd(), vec![line(ab, 60), line(bc, 60), line(ca, 60)]);
    // Paying one unit used to make the proposal stale and get it discarded.
    pay(&env, &mut house, "c", ca, 1);
}

#[test]
fn a_payment_waits_for_the_round_and_then_settles_the_rest() {
    let mut env = Env { now: 0 };
    let mut house = house(&env);
    let [ab, bc, ca] = triangle(&env, &mut house);
    env.call("solver-1", BOND);
    house.submit(usd(), vec![line(ab, 60), line(bc, 60), line(ca, 60)]);
    env.now = ROUND;
    env.call("anyone", NearToken::from_yoctonear(0));
    house.close_round(usd());

    assert_eq!(pay(&env, &mut house, "a", ab, 50), 10);
    assert_eq!(outstanding(&house, ab), 0);
    assert_eq!(house.get_balance(account("b"), usd()), U128(40));
}

#[test]
#[should_panic(expected = "d.test is not a member of this clearing house")]
fn only_members_owe_each_other() {
    let env = Env { now: 0 };
    let mut house = house(&env);
    env.call("a", STORAGE);
    house.issue(account("d"), usd(), U128(100), String::new());
}

#[test]
#[should_panic(expected = "a.test is not a member of this clearing house")]
fn an_expelled_member_cannot_take_on_new_debt() {
    let env = Env { now: 0 };
    let mut house = house(&env);
    env.call("owner.test", NearToken::from_yoctonear(0));
    house.expel(account("a"));
    env.call("b", STORAGE);
    house.issue(account("a"), usd(), U128(100), String::new());
}

#[test]
fn debt_owed_before_expulsion_can_still_be_cleared() {
    let mut env = Env { now: 0 };
    let mut house = house(&env);
    let [ab, bc, ca] = triangle(&env, &mut house);
    env.call("owner.test", NearToken::from_yoctonear(0));
    house.expel(account("a"));
    env.call("solver-1", BOND);
    house.submit(usd(), vec![line(ab, 60), line(bc, 60), line(ca, 60)]);
    env.now = ROUND;
    env.call("anyone", NearToken::from_yoctonear(0));
    house.close_round(usd());
    assert_eq!(outstanding(&house, ca), 0);
    assert!(!house.is_member(account("a")));
}

#[test]
#[should_panic(expected = "only the owner can do this")]
fn only_the_owner_admits_members() {
    let env = Env { now: 0 };
    let mut house = house(&env);
    env.call("a", STORAGE);
    house.admit(vec![account("d")]);
}

#[test]
fn payments_credit_the_creditor_and_return_any_excess() {
    let env = Env { now: 0 };
    let mut house = house(&env);
    let id = issue(&env, &mut house, "b", "a", 100);
    assert_eq!(pay(&env, &mut house, "a", id, 30), 0);
    assert_eq!(pay(&env, &mut house, "a", id, 100), 30);
    assert_eq!(house.get_balance(account("b"), usd()), U128(100));
    assert_eq!(house.get_obligation(id).unwrap().status, ObligationStatus::Discharged);
    assert_eq!(house.get_obligation(id).unwrap().cleared, U128(0));
}

#[test]
#[should_panic(expected = "asset is not accepted")]
fn payments_in_unknown_tokens_are_refused() {
    let env = Env { now: 0 };
    let mut house = house(&env);
    let id = issue(&env, &mut house, "b", "a", 100);
    env.call("fake-usd.test", NearToken::from_yoctonear(1));
    let _ =
        house.ft_on_transfer(account("a"), U128(100), format!(r#"{{"pay":{{"obligation":"{}"}}}}"#, id.0));
}

#[test]
#[should_panic(expected = "unreadable transfer message")]
fn transfers_without_a_purpose_are_refused() {
    let env = Env { now: 0 };
    let mut house = house(&env);
    env.call("usd.test", NearToken::from_yoctonear(1));
    let _ = house.ft_on_transfer(account("a"), U128(100), "thanks".into());
}

#[test]
#[should_panic(expected = "obligation is not active")]
fn pending_obligations_cannot_be_paid() {
    let env = Env { now: 0 };
    let mut house = house(&env);
    env.call("b", STORAGE);
    let id = house.issue(account("a"), usd(), U128(100), String::new());
    pay(&env, &mut house, "a", id, 100);
}

#[test]
fn the_winning_solver_is_paid_from_the_reward_pool() {
    let mut env = Env { now: 0 };
    let mut house = house(&env);
    let [ab, bc, ca] = triangle(&env, &mut house);
    env.call("usd.test", NearToken::from_yoctonear(1));
    let _ = house.ft_on_transfer(account("a"), U128(1), r#""fund_rewards""#.into());

    env.call("solver-1", BOND);
    house.submit(usd(), vec![line(ab, 60), line(bc, 60), line(ca, 60)]);
    env.now = ROUND;
    env.call("anyone", NearToken::from_yoctonear(0));
    house.close_round(usd());

    // 0.5% of 180 is 0.9, rounded down to 0: the pool of 1 stays.
    assert_eq!(house.get_balance(account("solver-1"), usd()), U128(0));
    assert_eq!(house.get_reward_pool(usd()), U128(1));
}

#[test]
fn rewards_are_capped_by_the_pool() {
    let mut env = Env { now: 0 };
    let mut house = house(&env);
    let ab = issue(&env, &mut house, "b", "a", 1_000_000);
    let ba = issue(&env, &mut house, "a", "b", 1_000_000);
    env.call("usd.test", NearToken::from_yoctonear(1));
    let _ = house.ft_on_transfer(account("a"), U128(7_000), r#""fund_rewards""#.into());

    env.call("solver-1", BOND);
    house.submit(usd(), vec![line(ab, 1_000_000), line(ba, 1_000_000)]);
    env.now = ROUND;
    env.call("anyone", NearToken::from_yoctonear(0));
    house.close_round(usd());

    // 0.5% of 2,000,000 is 10,000, but the pool only holds 7,000.
    assert_eq!(house.get_balance(account("solver-1"), usd()), U128(7_000));
    assert_eq!(house.get_reward_pool(usd()), U128(0));
}

#[test]
fn a_failed_withdrawal_restores_the_balance() {
    let env = Env { now: 0 };
    let mut house = house(&env);
    let id = issue(&env, &mut house, "b", "a", 100);
    pay(&env, &mut house, "a", id, 100);

    env.call("b", NearToken::from_yoctonear(1));
    house.withdraw_balance(usd(), None);
    assert_eq!(house.get_balance(account("b"), usd()), U128(0));

    env.callback(PromiseResult::Failed);
    house.on_withdraw(account("b"), usd(), U128(100), Err(near_sdk::PromiseError::Failed));
    assert_eq!(house.get_balance(account("b"), usd()), U128(100));
}

#[test]
#[should_panic(expected = "attach exactly 1 yoctoNEAR")]
fn withdrawing_needs_a_full_access_confirmation() {
    let env = Env { now: 0 };
    let mut house = house(&env);
    env.call("b", NearToken::from_yoctonear(0));
    house.withdraw_balance(usd(), None);
}

#[test]
#[should_panic(expected = "amount exceeds the balance")]
fn nobody_withdraws_more_than_they_have() {
    let env = Env { now: 0 };
    let mut house = house(&env);
    env.call("b", NearToken::from_yoctonear(1));
    house.withdraw_balance(usd(), Some(U128(1)));
}

#[test]
#[should_panic(expected = "proposal bond does not cover the storage of a full proposal and its winnings")]
fn the_bond_must_cover_a_full_proposal() {
    let env = Env { now: 0 };
    env.call("owner.test", NearToken::from_yoctonear(0));
    let config = Config { proposal_bond: NearToken::from_yoctonear(1), ..config() };
    let _ = ClearingHouse::new(account("owner.test"), config, vec![usd()]);
}

#[test]
#[should_panic(expected = "only the owner can do this")]
fn only_the_owner_adds_assets() {
    let env = Env { now: 0 };
    let mut house = house(&env);
    env.call("a", STORAGE);
    house.add_asset(account("eur.test"));
}

#[test]
#[should_panic(expected = "round duration must be positive and at most one hour")]
fn rounds_cannot_last_forever() {
    let env = Env { now: 0 };
    env.call("owner.test", NearToken::from_yoctonear(0));
    let config = Config { round_duration_ns: U64(u64::MAX), ..config() };
    let _ = ClearingHouse::new(account("owner.test"), config, vec![usd()]);
}

#[test]
fn active_obligations_page_by_asset() {
    let env = Env { now: 0 };
    let mut house = house(&env);
    env.call("owner.test", STORAGE);
    house.add_asset(account("eur.test"));
    let first = issue(&env, &mut house, "b", "a", 10);
    env.call("b", STORAGE);
    let euros = house.issue(account("a"), account("eur.test"), U128(5), String::new());
    env.call("a", STORAGE);
    house.accept(euros);
    let second = issue(&env, &mut house, "c", "a", 20);

    let page = |from: u64| house.list_active(usd(), Some(U64(from)), Some(1));
    assert_eq!(page(0)[0].id, first);
    assert_eq!(page(1)[0].id, second);
    assert_eq!(page(2), vec![]);
}

#[test]
fn ownership_moves_to_a_new_account() {
    let env = Env { now: 0 };
    let mut house = house(&env);
    env.call("owner.test", NearToken::from_yoctonear(1));
    house.transfer_ownership(account("dao.test"));
    assert_eq!(house.get_owner(), account("dao.test"));
    assert!(get_logs().iter().any(|l| l.contains(r#""event":"ownership_transferred""#)));
}

#[test]
#[should_panic(expected = "only the owner can do this")]
fn the_previous_owner_loses_its_role() {
    let env = Env { now: 0 };
    let mut house = house(&env);
    env.call("owner.test", NearToken::from_yoctonear(1));
    house.transfer_ownership(account("dao.test"));
    env.call("owner.test", STORAGE);
    house.admit(vec![account("d")]);
}

#[test]
#[should_panic(expected = "attach exactly 1 yoctoNEAR")]
fn ownership_needs_a_full_access_confirmation() {
    let env = Env { now: 0 };
    let mut house = house(&env);
    env.call("owner.test", NearToken::from_yoctonear(0));
    house.transfer_ownership(account("dao.test"));
}

#[test]
fn a_failed_bond_refund_is_on_the_record() {
    let env = Env { now: 0 };
    let mut house = house(&env);
    env.callback(PromiseResult::Failed);
    house.on_bond_returned(account("solver-1"), BOND, Err(near_sdk::PromiseError::Failed));
    assert!(get_logs().iter().any(|l| l.contains(r#""event":"bond_return_failed""#)));
}
