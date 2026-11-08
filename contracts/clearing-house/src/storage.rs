use near_sdk::{env, AccountId, NearToken, Promise};

/// Takes `required` out of the attached deposit and refunds the rest to `payer`.
pub fn collect(payer: &AccountId, required: NearToken) {
    let attached = env::attached_deposit();
    if attached < required {
        env::panic_str(&format!("attach at least {} yoctoNEAR", required.as_yoctonear()));
    }
    let refund = attached.saturating_sub(required);
    if !refund.is_zero() {
        Promise::new(payer.clone()).transfer(refund).detach();
    }
}

/// Charges `payer` for the storage that grew from `before` to `after` bytes,
/// out of the attached deposit, and refunds the rest.
pub fn charge(before: u64, after: u64, payer: &AccountId) {
    collect(payer, cost(before, after));
}

/// Cost of storage growing from `before` to `after` bytes; nothing if it shrank.
pub fn cost(before: u64, after: u64) -> NearToken {
    env::storage_byte_cost().saturating_mul(u128::from(after.saturating_sub(before)))
}
