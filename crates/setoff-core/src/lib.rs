//! Rules for multilateral set-off.
//!
//! A set of accepted obligations forms a directed graph: each obligation is an
//! edge from its debtor to its creditor, weighted by what is still owed. A
//! *clearing* reduces some of those edges at once without moving money. It is
//! acceptable only if it leaves every party's net position unchanged: for each
//! party, the total it stops owing equals the total it stops being owed. Such
//! a reduction is a circulation in the graph, so debt that runs in cycles
//! cancels out and only the net remains to be paid.
//!
//! This crate holds those rules and nothing else. It knows no blockchain, no
//! storage and no account format: parties and assets are any ordered types,
//! and obligations come from whatever implements [`ObligationSource`].

mod clearing;
mod error;
mod obligation;
mod payment;

pub use clearing::{validate_clearing, ClearingLimits, Reduction, ValidatedClearing};
pub use error::ClearingError;
pub use obligation::{Obligation, ObligationId, ObligationSource};
pub use payment::{apply_payment, PaymentOutcome};
