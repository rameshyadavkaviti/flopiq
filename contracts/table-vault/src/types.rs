use flopiq_settlement_types::{CommittedState, Participant};
use soroban_sdk::{Address, BytesN, Vec, contracterror, contractevent, contracttype};

/// A table proposal is immutable identity material. Amounts are test SAC base
/// units; no Poker Core CHIP-to-token conversion is implied.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TableProposal {
    pub nonce: BytesN<32>,
    pub config_digest: BytesN<32>,
    pub participants: Vec<Participant>,
    pub buy_ins: Vec<i128>,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum TablePhase {
    Funding,
    Ready,
    Active(BytesN<32>),
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Table {
    pub state: CommittedState,
    pub phase: TablePhase,
    /// Exact deposits still required, parallel to `state.participants`.
    pub remaining_buy_ins: Vec<i128>,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Backing {
    pub collateral: i128,
    pub liabilities: i128,
    pub surplus: i128,
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum VaultError {
    InvalidToken = 1,
    TableExists = 2,
    UnknownTable = 3,
    Participants = 4,
    Amount = 5,
    Phase = 6,
    Version = 7,
    Hand = 8,
    Replay = 9,
    InvalidSettlement = 10,
    Insolvent = 11,
    Storage = 12,
    NoLiability = 13,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Exited {
    #[topic]
    pub table_id: BytesN<32>,
    #[topic]
    pub player: Address,
    pub amount: i128,
    pub next_state_version: u64,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TableCreated {
    #[topic]
    pub table_id: BytesN<32>,
    pub participants: Vec<Participant>,
    pub buy_ins: Vec<i128>,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Deposited {
    #[topic]
    pub table_id: BytesN<32>,
    #[topic]
    pub player: Address,
    pub amount: i128,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct HandStarted {
    #[topic]
    pub table_id: BytesN<32>,
    #[topic]
    pub hand_id: BytesN<32>,
    pub state_version: u64,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SettlementCommitted {
    #[topic]
    pub table_id: BytesN<32>,
    #[topic]
    pub hand_id: BytesN<32>,
    pub next_state_version: u64,
    pub settlement_digest: BytesN<32>,
}
