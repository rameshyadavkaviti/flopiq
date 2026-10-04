#![no_std]

use soroban_sdk::{contracterror, contracttype, Address, BytesN, Vec};

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Participant {
    pub seat: u32,
    pub player: Address,
}

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

pub mod validation {
    use super::*;
    pub fn participants(players: &Vec<Participant>) -> Result<(), Error> {
        if !(2..=9).contains(&players.len()) {
            return Err(Error::Participants);
        }
        for (i, p) in players.iter().enumerate() {
            if p.seat > 8 {
                return Err(Error::Participants);
            }
            for earlier in players.iter().take(i) {
                if earlier.seat >= p.seat || earlier.player == p.player {
                    return Err(Error::Participants);
                }
            }
        }
        Ok(())
    }
    pub fn total(stacks: &Vec<i128>, count: u32) -> Result<i128, Error> {
        if stacks.len() != count {
            return Err(Error::Participants);
        }
        let mut sum = 0_i128;
        for amount in stacks.iter() {
            if amount < 0 {
                return Err(Error::Amount);
            }
            sum = sum.checked_add(amount).ok_or(Error::Amount)?;
        }
        Ok(sum)
    }
    pub fn transition(state: &CommittedState, s: &Settlement) -> Result<(), Error> {
        if s.protocol_version != 1 {
            return Err(Error::Protocol);
        }
        if s.previous_state_version != state.version
            || state.version.checked_add(1) != Some(s.next_state_version)
        {
            return Err(Error::Version);
        }
        participants(&s.participants)?;
        let before = total(&s.starting_stacks, s.participants.len())?;
        let after = total(&s.final_stacks, s.participants.len())?;
        if s.rake != 0 {
            return Err(Error::RakeDisabled);
        }
        if s.participants != state.participants || s.starting_stacks != state.stacks {
            return Err(Error::StateMismatch);
        }
        if before != after {
            return Err(Error::Conservation);
        }
        Ok(())
    }
}
