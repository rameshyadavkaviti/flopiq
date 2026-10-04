#![no_std]

mod identity;
mod types;

use flopiq_settlement_types::{CommittedState, Error as SettlementError, Settlement, validation};
use soroban_sdk::{
    Address, BytesN, Env, Executable, contract, contractimpl, contracttype, token, xdr::ToXdr,
};
pub use types::{
    Backing, Deposited, HandStarted, SettlementCommitted, Table, TableCreated, TablePhase,
    TableProposal, VaultError,
};

#[contracttype]
#[derive(Clone)]
enum Key {
    Token,
    Liabilities,
    Table(BytesN<32>),
    Hand(BytesN<32>),
}

#[contract]
pub struct TableVault;

#[contractimpl]
impl TableVault {
    /// Binds this vault instance to one deployed Stellar Asset Contract.
    pub fn __constructor(env: Env, token: Address) -> Result<(), VaultError> {
        if token.executable() != Some(Executable::StellarAsset) {
            return Err(VaultError::InvalidToken);
        }
        env.storage().instance().set(&Key::Token, &token);
        env.storage().persistent().set(&Key::Liabilities, &0_i128);
        Ok(())
    }

    pub fn token(env: Env) -> Result<Address, VaultError> {
        token_address(&env)
    }

    /// Creates an authenticated allocation but does not move funds.
    pub fn create_table(env: Env, proposal: TableProposal) -> Result<BytesN<32>, VaultError> {
        validation::participants(&proposal.participants).map_err(map_settlement_error)?;
        validation::total(&proposal.buy_ins, proposal.participants.len())
            .map_err(map_settlement_error)?;
        let token = token_address(&env)?;
        let vault = env.current_contract_address();
        for (index, participant) in proposal.participants.iter().enumerate() {
            let buy_in = proposal
                .buy_ins
                .get(index as u32)
                .ok_or(VaultError::Participants)?;
            if buy_in <= 0 || participant.player == vault || participant.player == token {
                return Err(VaultError::Amount);
            }
        }
        let table_id = identity::table_id(&env, &token, &proposal);
        let key = Key::Table(table_id.clone());
        if env.storage().persistent().has(&key) {
            return Err(VaultError::TableExists);
        }
        authorize_all(&proposal.participants);

        let mut stacks = soroban_sdk::Vec::new(&env);
        for _ in 0..proposal.participants.len() {
            stacks.push_back(0_i128);
        }
        let table = Table {
            state: CommittedState {
                version: 0,
                participants: proposal.participants.clone(),
                stacks,
            },
            phase: TablePhase::Funding,
            remaining_buy_ins: proposal.buy_ins.clone(),
        };
        env.storage().persistent().set(&key, &table);
        TableCreated {
            table_id: table_id.clone(),
            participants: proposal.participants,
            buy_ins: proposal.buy_ins,
        }
        .publish(&env);
        Ok(table_id)
    }

    /// Deposits exactly the participant's one-time allocation.
    pub fn deposit(
        env: Env,
        table_id: BytesN<32>,
        player: Address,
        amount: i128,
    ) -> Result<(), VaultError> {
        if amount <= 0 {
            return Err(VaultError::Amount);
        }
        let mut table = load_table(&env, &table_id)?;
        if table.phase != TablePhase::Funding {
            return Err(VaultError::Phase);
        }
        let mut player_index = None;
        for (index, participant) in table.state.participants.iter().enumerate() {
            if participant.player == player {
                player_index = Some(index as u32);
                break;
            }
        }
        let index = player_index.ok_or(VaultError::Participants)?;
        let remaining = table
            .remaining_buy_ins
            .get(index)
            .ok_or(VaultError::Storage)?;
        if amount != remaining {
            return Err(VaultError::Amount);
        }

        let before = checked_backing(&env)?;
        let next_liabilities = before
            .liabilities
            .checked_add(amount)
            .ok_or(VaultError::Amount)?;
        let expected_collateral = before
            .collateral
            .checked_add(amount)
            .ok_or(VaultError::Amount)?;

        player.require_auth();
        token::TokenClient::new(&env, &token_address(&env)?).transfer(
            &player,
            env.current_contract_address(),
            &amount,
        );
        let after_collateral = token::TokenClient::new(&env, &token_address(&env)?)
            .balance(&env.current_contract_address());
        if after_collateral != expected_collateral {
            return Err(VaultError::Insolvent);
        }

        table.remaining_buy_ins.set(index, 0_i128);
        table.state.stacks.set(index, amount);
        if table
            .remaining_buy_ins
            .iter()
            .all(|remaining| remaining == 0)
        {
            table.phase = TablePhase::Ready;
            table.remaining_buy_ins = soroban_sdk::Vec::new(&env);
        }
        env.storage()
            .persistent()
            .set(&Key::Table(table_id.clone()), &table);
        env.storage()
            .persistent()
            .set(&Key::Liabilities, &next_liabilities);
        Deposited {
            table_id,
            player,
            amount,
        }
        .publish(&env);
        Ok(())
    }

    pub fn start_hand(
        env: Env,
        table_id: BytesN<32>,
        expected_state_version: u64,
    ) -> Result<BytesN<32>, VaultError> {
        let mut table = load_table(&env, &table_id)?;
        if table.phase != TablePhase::Ready {
            return Err(VaultError::Phase);
        }
        if table.state.version != expected_state_version || expected_state_version == u64::MAX {
            return Err(VaultError::Version);
        }
        checked_backing(&env)?;
        authorize_all(&table.state.participants);
        let hand_id = identity::hand_id(&env, &table_id, expected_state_version);
        if env.storage().persistent().has(&Key::Hand(hand_id.clone())) {
            return Err(VaultError::Replay);
        }
        table.phase = TablePhase::Active(hand_id.clone());
        env.storage()
            .persistent()
            .set(&Key::Table(table_id.clone()), &table);
        HandStarted {
            table_id,
            hand_id: hand_id.clone(),
            state_version: expected_state_version,
        }
        .publish(&env);
        Ok(hand_id)
    }

    pub fn commit(env: Env, settlement: Settlement) -> Result<(), VaultError> {
        let mut table = load_table(&env, &settlement.table_id)?;
        let hand_key = Key::Hand(settlement.hand_id.clone());
        if env.storage().persistent().has(&hand_key) {
            return Err(VaultError::Replay);
        }
        if table.phase != TablePhase::Active(settlement.hand_id.clone()) {
            return Err(VaultError::Hand);
        }
        validation::transition(&table.state, &settlement).map_err(map_settlement_error)?;
        checked_backing(&env)?;
        authorize_all(&table.state.participants);

        let settlement_digest = env
            .crypto()
            .sha256(&settlement.clone().to_xdr(&env))
            .to_bytes();
        table.state.version = settlement.next_state_version;
        table.state.stacks = settlement.final_stacks;
        table.phase = TablePhase::Ready;
        env.storage()
            .persistent()
            .set(&Key::Table(settlement.table_id.clone()), &table);
        env.storage().persistent().set(&hand_key, &true);
        SettlementCommitted {
            table_id: settlement.table_id,
            hand_id: settlement.hand_id,
            next_state_version: settlement.next_state_version,
            settlement_digest,
        }
        .publish(&env);
        Ok(())
    }

    pub fn table(env: Env, table_id: BytesN<32>) -> Result<Table, VaultError> {
        load_table(&env, &table_id)
    }

    pub fn backing(env: Env) -> Result<Backing, VaultError> {
        checked_backing(&env)
    }
}

fn token_address(env: &Env) -> Result<Address, VaultError> {
    env.storage()
        .instance()
        .get(&Key::Token)
        .ok_or(VaultError::Storage)
}

fn load_table(env: &Env, table_id: &BytesN<32>) -> Result<Table, VaultError> {
    env.storage()
        .persistent()
        .get(&Key::Table(table_id.clone()))
        .ok_or(VaultError::UnknownTable)
}

fn authorize_all(participants: &soroban_sdk::Vec<flopiq_settlement_types::Participant>) {
    for participant in participants.iter() {
        participant.player.require_auth();
    }
}

fn checked_backing(env: &Env) -> Result<Backing, VaultError> {
    let liabilities: i128 = env
        .storage()
        .persistent()
        .get(&Key::Liabilities)
        .ok_or(VaultError::Storage)?;
    let collateral =
        token::TokenClient::new(env, &token_address(env)?).balance(&env.current_contract_address());
    let surplus = collateral
        .checked_sub(liabilities)
        .ok_or(VaultError::Amount)?;
    if liabilities < 0 || collateral < liabilities {
        return Err(VaultError::Insolvent);
    }
    Ok(Backing {
        collateral,
        liabilities,
        surplus,
    })
}

fn map_settlement_error(error: SettlementError) -> VaultError {
    match error {
        SettlementError::Participants => VaultError::Participants,
        SettlementError::Amount | SettlementError::Conservation => VaultError::Amount,
        SettlementError::Version => VaultError::Version,
        SettlementError::Replay => VaultError::Replay,
        SettlementError::AlreadyExists
        | SettlementError::UnknownTable
        | SettlementError::Protocol
        | SettlementError::RakeDisabled
        | SettlementError::StateMismatch => VaultError::InvalidSettlement,
    }
}

#[cfg(test)]
mod tests;
