/// How a payment towards one obligation splits.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct PaymentOutcome {
    /// Part of the payment that reduces the obligation.
    pub applied: u128,
    /// Part of the payment that exceeds what is owed and goes back to the payer.
    pub refund: u128,
    /// Amount still owed afterwards.
    pub remaining: u128,
}

/// Applies `paid` to an obligation with `outstanding` still owed. Overpayment
/// is never kept: it is returned as `refund`.
pub fn apply_payment(outstanding: u128, paid: u128) -> PaymentOutcome {
    let applied = outstanding.min(paid);
    PaymentOutcome { applied, refund: paid - applied, remaining: outstanding - applied }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn partial_payment_leaves_the_rest_owed() {
        assert_eq!(apply_payment(100, 40), PaymentOutcome { applied: 40, refund: 0, remaining: 60 });
    }

    #[test]
    fn overpayment_is_refunded() {
        assert_eq!(apply_payment(100, 130), PaymentOutcome { applied: 100, refund: 30, remaining: 0 });
    }

    #[test]
    fn payment_to_a_discharged_obligation_is_refunded_in_full() {
        assert_eq!(apply_payment(0, 5), PaymentOutcome { applied: 0, refund: 5, remaining: 0 });
    }
}
