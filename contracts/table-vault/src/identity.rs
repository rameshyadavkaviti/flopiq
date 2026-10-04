use crate::types::TableProposal;
use soroban_sdk::{Address, BytesN, Env, IntoVal, Symbol, Val, xdr::ToXdr};

pub(crate) fn table_id(env: &Env, token: &Address, proposal: &TableProposal) -> BytesN<32> {
    let value: Val = (
        Symbol::new(env, "flopiq_table_v1"),
        env.ledger().network_id(),
        env.current_contract_address(),
        token.clone(),
        proposal.clone(),
    )
        .into_val(env);
    env.crypto().sha256(&value.to_xdr(env)).to_bytes()
}

pub(crate) fn hand_id(env: &Env, table_id: &BytesN<32>, version: u64) -> BytesN<32> {
    let value: Val = (
        Symbol::new(env, "flopiq_hand_v1"),
        env.ledger().network_id(),
        env.current_contract_address(),
        table_id.clone(),
        version,
    )
        .into_val(env);
    env.crypto().sha256(&value.to_xdr(env)).to_bytes()
}
