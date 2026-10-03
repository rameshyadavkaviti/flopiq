#![no_std]

mod types;
mod validation;
use soroban_sdk::{contract, contractevent, contractimpl, contracttype, BytesN, Env, Vec};
pub use types::{CommittedState, Error, Participant, Settlement};

#[contracttype]
#[derive(Clone)]
enum Key {
    Table(BytesN<32>),
    // Contract-wide hand identity: cannot reuse a hand even at another table.
    Hand(BytesN<32>),
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct StateCommitted {
    #[topic]
    pub table_id: BytesN<32>,
    pub version: u64,
    /// Hash of the complete canonical settlement ScVal XDR (not poker proof).
    pub settlement_digest: BytesN<32>,
}

/// Non-custodial Phase 2A foundation. Holds no tokens and exposes no fund movement.
/// Unanimous participant consent is a local development boundary, not Phase 6 auth.
#[contract]
pub struct TableState;

#[contractimpl]
impl TableState {
    pub fn initialize(
        env: Env,
        table_id: BytesN<32>,
        participants: Vec<Participant>,
        stacks: Vec<i128>,
    ) -> Result<(), Error> {
        let key = Key::Table(table_id);
        if env.storage().persistent().has(&key) {
            return Err(Error::AlreadyExists);
        }
        validation::participants(&participants)?;
        validation::total(&stacks, participants.len())?;
        // require_auth binds this contract/function and ALL invocation arguments.
        for participant in participants.iter() {
            participant.player.require_auth();
        }
        env.storage().persistent().set(
            &key,
            &CommittedState {
                version: 0,
                participants,
                stacks,
            },
        );
        Ok(())
    }

    pub fn state(env: Env, table_id: BytesN<32>) -> Result<CommittedState, Error> {
        env.storage()
            .persistent()
            .get(&Key::Table(table_id))
            .ok_or(Error::UnknownTable)
    }

    pub fn commit(env: Env, settlement: Settlement) -> Result<(), Error> {
        use soroban_sdk::xdr::ToXdr;
        if settlement.protocol_version != 1 {
            return Err(Error::Protocol);
        }
        let state = Self::state(env.clone(), settlement.table_id.clone())?;
        let hand_key = Key::Hand(settlement.hand_id.clone());
        if env.storage().persistent().has(&hand_key) {
            return Err(Error::Replay);
        }
        if settlement.previous_state_version != state.version
            || state.version.checked_add(1) != Some(settlement.next_state_version)
        {
            return Err(Error::Version);
        }
        validation::participants(&settlement.participants)?;
        let starting =
            validation::total(&settlement.starting_stacks, settlement.participants.len())?;
        let ending = validation::total(&settlement.final_stacks, settlement.participants.len())?;
        if settlement.rake != 0 {
            return Err(Error::RakeDisabled);
        }
        if settlement.participants != state.participants
            || settlement.starting_stacks != state.stacks
        {
            return Err(Error::StateMismatch);
        }
        if starting != ending {
            return Err(Error::Conservation);
        }
        for participant in state.participants.iter() {
            participant.player.require_auth();
        }
        // All validation/auth precedes writes. Soroban also rolls back failed invocations.
        let digest = env
            .crypto()
            .sha256(&settlement.clone().to_xdr(&env))
            .to_bytes();
        env.storage().persistent().set(
            &Key::Table(settlement.table_id.clone()),
            &CommittedState {
                version: settlement.next_state_version,
                participants: state.participants,
                stacks: settlement.final_stacks,
            },
        );
        // Persistent (never temporary): expiry must not allow replay/reinitialization.
        env.storage().persistent().set(&hand_key, &true);
        StateCommitted {
            table_id: settlement.table_id,
            version: settlement.next_state_version,
            settlement_digest: digest,
        }
        .publish(&env);
        Ok(())
    }
}

#[cfg(test)]
mod tests;
