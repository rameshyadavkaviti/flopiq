use soroban_sdk::{contracterror, contracttype, Address, BytesN, Vec};

/// Seat order, not address encoding order, is canonical. Seats are 0..=8.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Participant {
    pub seat: u32,
    pub player: Address,
}

/// Phase 2A test accounting units only. No CHIP/SAC conversion is implied.
/// Soroban contracttype values serialize as canonical ScVal XDR.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Settlement {
    pub protocol_version: u32,
    pub table_id: BytesN<32>,
    pub hand_id: BytesN<32>,
    pub previous_state_version: u64,
    pub next_state_version: u64,
    pub participants: Vec<Participant>,
    pub starting_stacks: Vec<i128>,
    pub final_stacks: Vec<i128>,
    pub rake: i128,
    pub action_transcript_digest: BytesN<32>,
    /// Opaque commitment, NOT proof of fairness.
    pub fairness_digest: BytesN<32>,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CommittedState {
    pub version: u64,
    pub participants: Vec<Participant>,
    pub stacks: Vec<i128>,
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum Error {
    AlreadyExists = 1,
    UnknownTable = 2,
    Protocol = 3,
    Participants = 4,
    Amount = 5,
    RakeDisabled = 6,
    StateMismatch = 7,
    Conservation = 8,
    Version = 9,
    Replay = 10,
}
