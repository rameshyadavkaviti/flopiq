use super::*;
use flopiq_settlement_types::{Participant, Settlement};
use soroban_sdk::{
    Address, BytesN, Env, IntoVal, Vec, contract, contractimpl,
    testutils::{Address as _, IssuerFlags, Ledger, MockAuth, MockAuthInvoke},
    token, vec,
};

#[contract]
struct AbortAfterDeposit;

#[contractimpl]
impl AbortAfterDeposit {
    pub fn invoke(
        env: Env,
        vault: Address,
        table_id: BytesN<32>,
        player: Address,
        amount: i128,
    ) -> Result<(), VaultError> {
        TableVaultClient::new(&env, &vault).deposit(&table_id, &player, &amount);
        Err(VaultError::Storage)
    }
}

#[contract]
struct AbortAfterExit;

#[contractimpl]
impl AbortAfterExit {
    pub fn invoke(
        env: Env,
        vault: Address,
        table_id: BytesN<32>,
        player: Address,
        expected_state_version: u64,
    ) -> Result<(), VaultError> {
        TableVaultClient::new(&env, &vault).exit(&table_id, &player, &expected_state_version);
        Err(VaultError::Storage)
    }
}

struct Fixture {
    env: Env,
    vault: Address,
    token: Address,
    participants: Vec<Participant>,
    proposal: TableProposal,
    table_id: BytesN<32>,
}

fn fixture(player_count: u32, buy_in: i128) -> Fixture {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();
    let admin = Address::generate(&env);
    let sac = env.register_stellar_asset_contract_v2(admin.clone());
    sac.issuer().set_flag(IssuerFlags::ClawbackEnabledFlag);
    sac.issuer().set_flag(IssuerFlags::RevocableFlag);
    let token = sac.address();
    let vault = env.register(TableVault, TableVaultArgs::__constructor(&token));
    let mut participants = Vec::new(&env);
    let mut buy_ins = Vec::new(&env);
    for seat in 0..player_count {
        let player = Address::generate(&env);
        token::StellarAssetClient::new(&env, &token).mint(&player, &(buy_in * 2));
        participants.push_back(Participant { seat, player });
        buy_ins.push_back(buy_in);
    }
    let proposal = TableProposal {
        nonce: BytesN::from_array(&env, &[1; 32]),
        config_digest: BytesN::from_array(&env, &[2; 32]),
        participants: participants.clone(),
        buy_ins,
    };
    let table_id = TableVaultClient::new(&env, &vault).create_table(&proposal);
    Fixture {
        env,
        vault,
        token,
        participants,
        proposal,
        table_id,
    }
}

fn fund(f: &Fixture) {
    let client = TableVaultClient::new(&f.env, &f.vault);
    for (index, participant) in f.participants.iter().enumerate() {
        client.deposit(
            &f.table_id,
            &participant.player,
            &f.proposal.buy_ins.get(index as u32).unwrap(),
        );
    }
}

fn settlement(f: &Fixture, hand_id: BytesN<32>, final_stacks: Vec<i128>) -> Settlement {
    let table = TableVaultClient::new(&f.env, &f.vault).table(&f.table_id);
    Settlement {
        protocol_version: 1,
        table_id: f.table_id.clone(),
        hand_id,
        previous_state_version: table.state.version,
        next_state_version: table.state.version + 1,
        participants: f.participants.clone(),
        starting_stacks: table.state.stacks,
        final_stacks,
        rake: 0,
        action_transcript_digest: BytesN::from_array(&f.env, &[3; 32]),
        fairness_digest: BytesN::from_array(&f.env, &[4; 32]),
    }
}

#[test]
fn actual_sac_deposits_back_version_zero_and_settlement() {
    let f = fixture(2, 100);
    let client = TableVaultClient::new(&f.env, &f.vault);
    assert_eq!(client.table(&f.table_id).phase, TablePhase::Funding);
    fund(&f);
    assert_eq!(client.table(&f.table_id).phase, TablePhase::Ready);
    assert_eq!(
        client.table(&f.table_id).state.stacks,
        vec![&f.env, 100, 100]
    );
    assert_eq!(
        client.backing(),
        Backing {
            collateral: 200,
            liabilities: 200,
            surplus: 0
        }
    );

    let hand = client.start_hand(&f.table_id, &0);
    let payload = settlement(&f, hand, vec![&f.env, 150, 50]);
    client.commit(&payload);
    let table = client.table(&f.table_id);
    assert_eq!(table.phase, TablePhase::Ready);
    assert_eq!(table.state.version, 1);
    assert_eq!(table.state.stacks, vec![&f.env, 150, 50]);
    assert_eq!(client.try_commit(&payload), Err(Ok(VaultError::Replay)));
    assert_eq!(client.backing().liabilities, 200);
}

#[test]
fn deposits_are_exact_one_time_and_participant_scoped() {
    let f = fixture(2, 100);
    let client = TableVaultClient::new(&f.env, &f.vault);
    let first = f.participants.get(0).unwrap().player;
    assert_eq!(
        client.try_deposit(&f.table_id, &first, &99),
        Err(Ok(VaultError::Amount))
    );
    assert_eq!(client.backing().liabilities, 0);
    client.deposit(&f.table_id, &first, &100);
    assert_eq!(
        client.try_deposit(&f.table_id, &first, &100),
        Err(Ok(VaultError::Amount))
    );
    assert_eq!(
        client.try_deposit(&f.table_id, &Address::generate(&f.env), &100),
        Err(Ok(VaultError::Participants))
    );
    assert_eq!(client.backing().liabilities, 100);
}

#[test]
fn failed_deposit_auth_is_atomic() {
    let f = fixture(2, 100);
    f.env.set_auths(&[]);
    let client = TableVaultClient::new(&f.env, &f.vault);
    let player = f.participants.get(0).unwrap().player;
    assert!(client.try_deposit(&f.table_id, &player, &100).is_err());
    assert_eq!(client.table(&f.table_id).state.stacks, vec![&f.env, 0, 0]);
    assert_eq!(
        token::TokenClient::new(&f.env, &f.token).balance(&f.vault),
        0
    );
    assert_eq!(client.backing().liabilities, 0);
}

#[test]
fn deposit_auth_must_include_nested_token_transfer() {
    let f = fixture(2, 100);
    f.env.set_auths(&[]);
    let player = f.participants.get(0).unwrap().player;
    let args = (f.table_id.clone(), player.clone(), 100_i128).into_val(&f.env);
    let auth = MockAuth {
        address: &player,
        invoke: &MockAuthInvoke {
            contract: &f.vault,
            fn_name: "deposit",
            args,
            sub_invokes: &[],
        },
    };
    let client = TableVaultClient::new(&f.env, &f.vault);
    assert!(
        client
            .mock_auths(&[auth])
            .try_deposit(&f.table_id, &player, &100)
            .is_err()
    );
    assert_eq!(client.backing().liabilities, 0);
    assert_eq!(
        token::TokenClient::new(&f.env, &f.token).balance(&f.vault),
        0
    );
}

#[test]
fn enclosing_transaction_failure_rolls_back_deposit_and_sac_transfer() {
    let f = fixture(2, 100);
    let abort = f.env.register(AbortAfterDeposit, ());
    let abort_client = AbortAfterDepositClient::new(&f.env, &abort);
    let player = f.participants.get(0).unwrap().player;
    let player_before = token::TokenClient::new(&f.env, &f.token).balance(&player);
    assert_eq!(
        abort_client.try_invoke(&f.vault, &f.table_id, &player, &100),
        Err(Ok(VaultError::Storage))
    );
    assert_eq!(
        token::TokenClient::new(&f.env, &f.token).balance(&player),
        player_before
    );
    assert_eq!(
        token::TokenClient::new(&f.env, &f.token).balance(&f.vault),
        0
    );
    let client = TableVaultClient::new(&f.env, &f.vault);
    assert_eq!(client.backing().liabilities, 0);
    assert_eq!(client.table(&f.table_id).state.stacks, vec![&f.env, 0, 0]);
}

#[test]
fn direct_selected_token_donation_is_explicit_surplus_not_credit() {
    let f = fixture(2, 100);
    fund(&f);
    let donor = f.participants.get(0).unwrap().player;
    token::TokenClient::new(&f.env, &f.token).transfer(&donor, &f.vault, &25);
    let client = TableVaultClient::new(&f.env, &f.vault);
    assert_eq!(
        client.backing(),
        Backing {
            collateral: 225,
            liabilities: 200,
            surplus: 25
        }
    );
    assert_eq!(
        client.table(&f.table_id).state.stacks,
        vec![&f.env, 100, 100]
    );
}

#[test]
fn wrong_token_transfers_do_not_affect_backing_or_player_credit() {
    let f = fixture(2, 100);
    fund(&f);
    let other = f
        .env
        .register_stellar_asset_contract_v2(Address::generate(&f.env));
    let other_token = other.address();
    let player = f.participants.get(0).unwrap().player;
    token::StellarAssetClient::new(&f.env, &other_token).mint(&player, &50);
    token::TokenClient::new(&f.env, &other_token).transfer(&player, &f.vault, &50);
    let client = TableVaultClient::new(&f.env, &f.vault);
    assert_eq!(client.backing().collateral, 200);
    assert_eq!(client.backing().liabilities, 200);
}

#[test]
#[should_panic(expected = "constructor invocation has failed")]
fn constructor_rejects_non_sac() {
    let env = Env::default();
    env.register(
        TableVault,
        TableVaultArgs::__constructor(&Address::generate(&env)),
    );
}

#[test]
fn token_identity_is_immutable() {
    let f = fixture(2, 100);
    assert_eq!(TableVaultClient::new(&f.env, &f.vault).token(), f.token);
}

#[test]
fn table_identity_binds_proposal_token_vault_and_network_context() {
    let f = fixture(2, 100);
    let client = TableVaultClient::new(&f.env, &f.vault);
    assert_eq!(
        client.try_create_table(&f.proposal),
        Err(Ok(VaultError::TableExists))
    );
    let mut changed = f.proposal.clone();
    changed.config_digest = BytesN::from_array(&f.env, &[9; 32]);
    assert_ne!(client.create_table(&changed), f.table_id);

    let second_vault = f
        .env
        .register(TableVault, TableVaultArgs::__constructor(&f.token));
    assert_ne!(
        TableVaultClient::new(&f.env, &second_vault).create_table(&f.proposal),
        f.table_id
    );
}

#[test]
fn table_allocation_requires_unanimous_scoped_authorization() {
    let f = fixture(2, 100);
    let mut proposal = f.proposal.clone();
    proposal.nonce = BytesN::from_array(&f.env, &[42; 32]);
    f.env.set_auths(&[]);
    let client = TableVaultClient::new(&f.env, &f.vault);
    let first = f.participants.get(0).unwrap().player;
    let invoke = MockAuthInvoke {
        contract: &f.vault,
        fn_name: "create_table",
        args: (proposal.clone(),).into_val(&f.env),
        sub_invokes: &[],
    };
    assert!(
        client
            .mock_auths(&[MockAuth {
                address: &first,
                invoke: &invoke,
            }])
            .try_create_table(&proposal)
            .is_err()
    );
    f.env.mock_all_auths();
    client.create_table(&proposal);
}

#[test]
fn rejects_malformed_participants_and_buyins() {
    let f = fixture(2, 100);
    let client = TableVaultClient::new(&f.env, &f.vault);
    let mut proposal = f.proposal.clone();
    proposal.nonce = BytesN::from_array(&f.env, &[8; 32]);
    proposal.participants.get(1).unwrap();
    let first = proposal.participants.get(0).unwrap();
    proposal.participants.set(
        1,
        Participant {
            seat: 1,
            player: first.player,
        },
    );
    assert_eq!(
        client.try_create_table(&proposal),
        Err(Ok(VaultError::Participants))
    );
    proposal = f.proposal.clone();
    proposal.nonce = BytesN::from_array(&f.env, &[7; 32]);
    proposal.buy_ins.set(1, 0);
    assert_eq!(
        client.try_create_table(&proposal),
        Err(Ok(VaultError::Amount))
    );
    proposal.buy_ins.pop_back();
    assert_eq!(
        client.try_create_table(&proposal),
        Err(Ok(VaultError::Participants))
    );
}

#[test]
fn funding_and_active_phase_transitions_are_enforced() {
    let f = fixture(2, 100);
    let client = TableVaultClient::new(&f.env, &f.vault);
    assert_eq!(
        client.try_start_hand(&f.table_id, &0),
        Err(Ok(VaultError::Phase))
    );
    fund(&f);
    assert_eq!(
        client.try_start_hand(&f.table_id, &1),
        Err(Ok(VaultError::Version))
    );
    let hand = client.start_hand(&f.table_id, &0);
    assert_eq!(
        client.try_start_hand(&f.table_id, &0),
        Err(Ok(VaultError::Phase))
    );
    let wrong_hand = BytesN::from_array(&f.env, &[99; 32]);
    let wrong = settlement(&f, wrong_hand, vec![&f.env, 100, 100]);
    assert_eq!(client.try_commit(&wrong), Err(Ok(VaultError::Hand)));
    let valid = settlement(&f, hand, vec![&f.env, 100, 100]);
    client.commit(&valid);
}

#[test]
fn start_hand_rejects_a_retained_zero_stack_participant() {
    let f = fixture(2, 100);
    fund(&f);
    let client = TableVaultClient::new(&f.env, &f.vault);
    let hand = client.start_hand(&f.table_id, &0);
    client.commit(&settlement(&f, hand, vec![&f.env, 200, 0]));

    assert_eq!(
        client.try_start_hand(&f.table_id, &1),
        Err(Ok(VaultError::Phase))
    );
    assert_eq!(client.table(&f.table_id).state.version, 1);
}

#[test]
fn start_and_settlement_require_every_participant() {
    let f = fixture(2, 100);
    fund(&f);
    f.env.set_auths(&[]);
    let client = TableVaultClient::new(&f.env, &f.vault);
    let player = f.participants.get(0).unwrap().player;
    let start_auth = MockAuth {
        address: &player,
        invoke: &MockAuthInvoke {
            contract: &f.vault,
            fn_name: "start_hand",
            args: (f.table_id.clone(), 0_u64).into_val(&f.env),
            sub_invokes: &[],
        },
    };
    assert!(
        client
            .mock_auths(&[start_auth])
            .try_start_hand(&f.table_id, &0)
            .is_err()
    );
    f.env.mock_all_auths();
    let hand = client.start_hand(&f.table_id, &0);
    let payload = settlement(&f, hand, vec![&f.env, 100, 100]);
    f.env.set_auths(&[]);
    assert!(client.try_commit(&payload).is_err());
    assert_eq!(client.table(&f.table_id).state.version, 0);
}

#[test]
fn settlement_validation_is_atomic() {
    let f = fixture(2, 100);
    fund(&f);
    let client = TableVaultClient::new(&f.env, &f.vault);
    let hand = client.start_hand(&f.table_id, &0);
    let before = client.table(&f.table_id);
    let mut payload = settlement(&f, hand.clone(), vec![&f.env, 150, 51]);
    assert_eq!(client.try_commit(&payload), Err(Ok(VaultError::Amount)));
    assert_eq!(client.table(&f.table_id), before);
    payload.final_stacks = vec![&f.env, 150, 50];
    payload.previous_state_version = 1;
    payload.next_state_version = 2;
    assert_eq!(client.try_commit(&payload), Err(Ok(VaultError::Version)));
    assert_eq!(client.table(&f.table_id), before);
    payload.previous_state_version = 0;
    payload.next_state_version = 1;
    payload.rake = 1;
    assert_eq!(
        client.try_commit(&payload),
        Err(Ok(VaultError::InvalidSettlement))
    );
    assert_eq!(client.table(&f.table_id), before);
}

#[test]
fn table_and_hand_identity_are_isolated() {
    let f = fixture(2, 100);
    fund(&f);
    let client = TableVaultClient::new(&f.env, &f.vault);
    let hand = client.start_hand(&f.table_id, &0);
    let payload = settlement(&f, hand.clone(), vec![&f.env, 100, 100]);
    client.commit(&payload);

    let mut proposal = f.proposal.clone();
    proposal.nonce = BytesN::from_array(&f.env, &[7; 32]);
    let other_table = client.create_table(&proposal);
    for participant in f.participants.iter() {
        client.deposit(&other_table, &participant.player, &100);
    }
    let other_hand = client.start_hand(&other_table, &0);
    assert_ne!(other_hand, hand);
    assert_eq!(client.table(&f.table_id).state.version, 1);
    assert_eq!(client.table(&other_table).state.version, 0);
}

#[test]
fn external_issuer_clawback_exposes_deficit_and_blocks_transitions() {
    let f = fixture(2, 100);
    fund(&f);
    token::StellarAssetClient::new(&f.env, &f.token).clawback(&f.vault, &1);
    let client = TableVaultClient::new(&f.env, &f.vault);
    assert_eq!(client.try_backing(), Err(Ok(VaultError::Insolvent)));
    assert_eq!(
        client.try_start_hand(&f.table_id, &0),
        Err(Ok(VaultError::Insolvent))
    );
}

#[test]
fn large_i128_values_are_conserved_and_overflowing_allocations_are_rejected() {
    let f = fixture(2, 100);
    let client = TableVaultClient::new(&f.env, &f.vault);
    let mut overflowing = f.proposal.clone();
    overflowing.nonce = BytesN::from_array(&f.env, &[88; 32]);
    overflowing.buy_ins = vec![&f.env, i128::MAX, 1];
    assert_eq!(
        client.try_create_table(&overflowing),
        Err(Ok(VaultError::Amount))
    );

    let mut large = f.proposal.clone();
    large.nonce = BytesN::from_array(&f.env, &[89; 32]);
    large.buy_ins = vec![&f.env, i128::MAX - 1, 1];
    let large_table = client.create_table(&large);
    let first = f.participants.get(0).unwrap().player;
    let second = f.participants.get(1).unwrap().player;
    token::StellarAssetClient::new(&f.env, &f.token).mint(&first, &(i128::MAX - 201));
    client.deposit(&large_table, &first, &(i128::MAX - 1));
    client.deposit(&large_table, &second, &1);
    assert_eq!(client.backing().liabilities, i128::MAX);
    assert_eq!(
        client.table(&large_table).state.stacks.iter().sum::<i128>(),
        i128::MAX
    );
}

#[test]
fn nine_player_generated_settlements_preserve_backing_and_versions() {
    let f = fixture(9, 100);
    fund(&f);
    let client = TableVaultClient::new(&f.env, &f.vault);
    for version in 0_u64..16 {
        let hand = client.start_hand(&f.table_id, &version);
        let state = client.table(&f.table_id).state;
        let mut finals = state.stacks.clone();
        let from = (version % 9) as u32;
        let to = ((version + 1) % 9) as u32;
        finals.set(from, finals.get(from).unwrap() - 1);
        finals.set(to, finals.get(to).unwrap() + 1);
        client.commit(&settlement(&f, hand, finals));
        assert_eq!(client.table(&f.table_id).state.version, version + 1);
        assert_eq!(
            client.table(&f.table_id).state.stacks.iter().sum::<i128>(),
            900
        );
        assert_eq!(client.backing().liabilities, 900);
    }
}

#[test]
fn approved_payload_tampering_fails_authorization_without_mutation() {
    let f = fixture(2, 100);
    fund(&f);
    let client = TableVaultClient::new(&f.env, &f.vault);
    let hand = client.start_hand(&f.table_id, &0);
    let approved = settlement(&f, hand, vec![&f.env, 150, 50]);
    f.env.set_auths(&[]);
    let mut tampered = approved.clone();
    tampered.fairness_digest = BytesN::from_array(&f.env, &[99; 32]);
    let first = f.participants.get(0).unwrap().player;
    let second = f.participants.get(1).unwrap().player;
    let first_invoke = MockAuthInvoke {
        contract: &f.vault,
        fn_name: "commit",
        args: (approved.clone(),).into_val(&f.env),
        sub_invokes: &[],
    };
    let second_invoke = MockAuthInvoke {
        contract: &f.vault,
        fn_name: "commit",
        args: (approved,).into_val(&f.env),
        sub_invokes: &[],
    };
    let auths = [
        MockAuth {
            address: &first,
            invoke: &first_invoke,
        },
        MockAuth {
            address: &second,
            invoke: &second_invoke,
        },
    ];
    assert!(client.mock_auths(&auths).try_commit(&tampered).is_err());
    assert_eq!(client.table(&f.table_id).state.version, 0);
}

#[test]
fn persistent_table_and_replay_state_auto_restore_without_losing_ownership() {
    let f = fixture(2, 100);
    fund(&f);
    let client = TableVaultClient::new(&f.env, &f.vault);
    let hand = client.start_hand(&f.table_id, &0);
    let payload = settlement(&f, hand, vec![&f.env, 100, 100]);
    client.commit(&payload);

    let current = f.env.ledger().sequence();
    let minimum_ttl = f.env.ledger().get().min_persistent_entry_ttl;
    f.env
        .ledger()
        .set_sequence_number(current + minimum_ttl + 1);

    assert_eq!(client.table(&f.table_id).state.version, 1);
    assert_eq!(client.try_commit(&payload), Err(Ok(VaultError::Replay)));
    assert_eq!(client.backing().liabilities, 200);
}

#[test]
fn unknown_table_operations_are_rejected_without_financial_effect() {
    let f = fixture(2, 100);
    let unknown = BytesN::from_array(&f.env, &[77; 32]);
    let player = f.participants.get(0).unwrap().player;
    let client = TableVaultClient::new(&f.env, &f.vault);
    assert_eq!(
        client.try_deposit(&unknown, &player, &100),
        Err(Ok(VaultError::UnknownTable))
    );
    assert_eq!(client.backing().liabilities, 0);
    assert_eq!(
        token::TokenClient::new(&f.env, &f.token).balance(&f.vault),
        0
    );
}

#[test]
fn ready_exit_returns_exact_balance_and_reduces_exact_liability() {
    use soroban_sdk::{Event, testutils::Events};

    let f = fixture(2, 100);
    fund(&f);
    let client = TableVaultClient::new(&f.env, &f.vault);
    let player = f.participants.get(0).unwrap().player;
    let participants_before = client.table(&f.table_id).state.participants;
    let player_before = token::TokenClient::new(&f.env, &f.token).balance(&player);

    assert_eq!(client.exit(&f.table_id, &player, &0), 100);
    let expected = Exited {
        table_id: f.table_id.clone(),
        player: player.clone(),
        amount: 100,
        next_state_version: 1,
    };
    assert_eq!(
        f.env.events().all().filter_by_contract(&f.vault),
        vec![
            &f.env,
            (
                f.vault.clone(),
                expected.topics(&f.env),
                expected.data(&f.env)
            )
        ]
    );

    let table = client.table(&f.table_id);
    assert_eq!(table.phase, TablePhase::Ready);
    assert_eq!(table.state.version, 1);
    assert_eq!(table.state.stacks, vec![&f.env, 0, 100]);
    assert_eq!(table.state.participants, participants_before);
    assert_eq!(
        token::TokenClient::new(&f.env, &f.token).balance(&player),
        player_before + 100
    );
    assert_eq!(
        client.backing(),
        Backing {
            collateral: 100,
            liabilities: 100,
            surplus: 0
        }
    );
}

#[test]
fn exit_requires_the_exiting_players_authorization() {
    let f = fixture(2, 100);
    fund(&f);
    let client = TableVaultClient::new(&f.env, &f.vault);
    let player = f.participants.get(0).unwrap().player;
    let table_before = client.table(&f.table_id);
    let backing_before = client.backing();
    let player_before = token::TokenClient::new(&f.env, &f.token).balance(&player);
    f.env.set_auths(&[]);

    assert!(client.try_exit(&f.table_id, &player, &0).is_err());
    assert_eq!(client.table(&f.table_id), table_before);
    assert_eq!(client.backing(), backing_before);
    assert_eq!(
        token::TokenClient::new(&f.env, &f.token).balance(&player),
        player_before
    );
}

#[test]
fn one_player_cannot_authorize_another_players_exit() {
    let f = fixture(2, 100);
    fund(&f);
    let client = TableVaultClient::new(&f.env, &f.vault);
    let attacker = f.participants.get(0).unwrap().player;
    let victim = f.participants.get(1).unwrap().player;
    let table_before = client.table(&f.table_id);
    f.env.set_auths(&[]);
    let invocation = MockAuthInvoke {
        contract: &f.vault,
        fn_name: "exit",
        args: (f.table_id.clone(), victim.clone(), 0_u64).into_val(&f.env),
        sub_invokes: &[],
    };

    assert!(
        client
            .mock_auths(&[MockAuth {
                address: &attacker,
                invoke: &invocation,
            }])
            .try_exit(&f.table_id, &victim, &0)
            .is_err()
    );
    assert_eq!(client.table(&f.table_id), table_before);
    assert_eq!(client.backing().liabilities, 200);
}

#[test]
fn exit_rejects_an_unknown_table() {
    let f = fixture(2, 100);
    let client = TableVaultClient::new(&f.env, &f.vault);
    let player = f.participants.get(0).unwrap().player;
    let unknown = BytesN::from_array(&f.env, &[73; 32]);

    assert_eq!(
        client.try_exit(&unknown, &player, &0),
        Err(Ok(VaultError::UnknownTable))
    );
    assert_eq!(client.backing().liabilities, 0);
}

#[test]
fn exit_rejects_an_unknown_participant() {
    let f = fixture(2, 100);
    fund(&f);
    let client = TableVaultClient::new(&f.env, &f.vault);
    let unknown = Address::generate(&f.env);
    let table_before = client.table(&f.table_id);

    assert_eq!(
        client.try_exit(&f.table_id, &unknown, &0),
        Err(Ok(VaultError::Participants))
    );
    assert_eq!(client.table(&f.table_id), table_before);
    assert_eq!(client.backing().liabilities, 200);
}

#[test]
fn repeated_exit_rejects_zero_liability() {
    let f = fixture(2, 100);
    fund(&f);
    let client = TableVaultClient::new(&f.env, &f.vault);
    let player = f.participants.get(0).unwrap().player;
    client.exit(&f.table_id, &player, &0);
    let table_before = client.table(&f.table_id);

    assert_eq!(
        client.try_exit(&f.table_id, &player, &1),
        Err(Ok(VaultError::NoLiability))
    );
    assert_eq!(client.table(&f.table_id), table_before);
    assert_eq!(client.backing().liabilities, 100);
}

#[test]
fn stale_exit_version_is_rejected_without_mutation() {
    let f = fixture(2, 100);
    fund(&f);
    let client = TableVaultClient::new(&f.env, &f.vault);
    let first = f.participants.get(0).unwrap().player;
    let second = f.participants.get(1).unwrap().player;
    client.exit(&f.table_id, &first, &0);
    let table_before = client.table(&f.table_id);

    assert_eq!(
        client.try_exit(&f.table_id, &second, &0),
        Err(Ok(VaultError::Version))
    );
    assert_eq!(client.table(&f.table_id), table_before);
    assert_eq!(client.backing().liabilities, 100);
}

#[test]
fn exit_is_rejected_while_table_is_funding() {
    let f = fixture(2, 100);
    let client = TableVaultClient::new(&f.env, &f.vault);
    let player = f.participants.get(0).unwrap().player;

    assert_eq!(
        client.try_exit(&f.table_id, &player, &0),
        Err(Ok(VaultError::Phase))
    );
    assert_eq!(client.backing().liabilities, 0);
}

#[test]
fn exit_is_rejected_during_an_active_hand() {
    let f = fixture(2, 100);
    fund(&f);
    let client = TableVaultClient::new(&f.env, &f.vault);
    let player = f.participants.get(0).unwrap().player;
    client.start_hand(&f.table_id, &0);
    let table_before = client.table(&f.table_id);

    assert_eq!(
        client.try_exit(&f.table_id, &player, &0),
        Err(Ok(VaultError::Phase))
    );
    assert_eq!(client.table(&f.table_id), table_before);
    assert_eq!(client.backing().liabilities, 200);
}

#[test]
fn sequential_and_final_exits_leave_zero_liability_ready_table() {
    let f = fixture(3, 100);
    fund(&f);
    let client = TableVaultClient::new(&f.env, &f.vault);
    for index in 0..3_u32 {
        let player = f.participants.get(index).unwrap().player;
        assert_eq!(client.exit(&f.table_id, &player, &(index as u64)), 100);
        assert_eq!(client.backing().liabilities, i128::from(2 - index) * 100);
    }

    let table = client.table(&f.table_id);
    assert_eq!(table.phase, TablePhase::Ready);
    assert_eq!(table.state.version, 3);
    assert_eq!(table.state.stacks, vec![&f.env, 0, 0, 0]);
    assert_eq!(table.state.participants, f.participants);
    assert_eq!(client.backing().collateral, 0);
    assert_eq!(client.backing().liabilities, 0);
}

#[test]
fn exit_isolates_tables_and_other_participants() {
    let f = fixture(2, 100);
    fund(&f);
    let client = TableVaultClient::new(&f.env, &f.vault);
    let mut other_proposal = f.proposal.clone();
    other_proposal.nonce = BytesN::from_array(&f.env, &[74; 32]);
    let other_table_id = client.create_table(&other_proposal);
    for participant in f.participants.iter() {
        client.deposit(&other_table_id, &participant.player, &100);
    }
    let first = f.participants.get(0).unwrap().player;
    let second = f.participants.get(1).unwrap().player;
    let second_before = token::TokenClient::new(&f.env, &f.token).balance(&second);

    client.exit(&f.table_id, &first, &0);

    assert_eq!(client.table(&f.table_id).state.stacks, vec![&f.env, 0, 100]);
    assert_eq!(client.table(&f.table_id).state.version, 1);
    assert_eq!(
        client.table(&other_table_id).state.stacks,
        vec![&f.env, 100, 100]
    );
    assert_eq!(client.table(&other_table_id).state.version, 0);
    assert_eq!(
        token::TokenClient::new(&f.env, &f.token).balance(&second),
        second_before
    );
    assert_eq!(client.backing().liabilities, 300);
}

#[test]
fn failed_enclosing_transaction_rolls_back_exit_and_sac_return() {
    let f = fixture(2, 100);
    fund(&f);
    let client = TableVaultClient::new(&f.env, &f.vault);
    let abort = f.env.register(AbortAfterExit, ());
    let abort_client = AbortAfterExitClient::new(&f.env, &abort);
    let player = f.participants.get(0).unwrap().player;
    let table_before = client.table(&f.table_id);
    let backing_before = client.backing();
    let player_before = token::TokenClient::new(&f.env, &f.token).balance(&player);

    assert_eq!(
        abort_client.try_invoke(&f.vault, &f.table_id, &player, &0),
        Err(Ok(VaultError::Storage))
    );
    assert_eq!(client.table(&f.table_id), table_before);
    assert_eq!(client.backing(), backing_before);
    assert_eq!(
        token::TokenClient::new(&f.env, &f.token).balance(&player),
        player_before
    );
}

#[test]
fn sac_transfer_failure_rolls_back_exit_accounting() {
    let f = fixture(2, 100);
    fund(&f);
    let client = TableVaultClient::new(&f.env, &f.vault);
    let player = f.participants.get(0).unwrap().player;
    let table_before = client.table(&f.table_id);
    let vault_before = token::TokenClient::new(&f.env, &f.token).balance(&f.vault);
    let player_before = token::TokenClient::new(&f.env, &f.token).balance(&player);
    token::StellarAssetClient::new(&f.env, &f.token).set_authorized(&f.vault, &false);

    assert!(client.try_exit(&f.table_id, &player, &0).is_err());
    assert_eq!(client.table(&f.table_id), table_before);
    assert_eq!(client.backing().liabilities, 200);
    assert_eq!(
        token::TokenClient::new(&f.env, &f.token).balance(&f.vault),
        vault_before
    );
    assert_eq!(
        token::TokenClient::new(&f.env, &f.token).balance(&player),
        player_before
    );
}

#[test]
fn exit_preserves_surplus_and_conserves_collateral() {
    let f = fixture(2, 100);
    fund(&f);
    let client = TableVaultClient::new(&f.env, &f.vault);
    let player = f.participants.get(0).unwrap().player;
    token::StellarAssetClient::new(&f.env, &f.token).mint(&f.vault, &25);

    assert_eq!(client.exit(&f.table_id, &player, &0), 100);
    assert_eq!(
        client.backing(),
        Backing {
            collateral: 125,
            liabilities: 100,
            surplus: 25
        }
    );
}

#[test]
fn full_exit_supports_large_i128_balance() {
    let f = fixture(2, 100);
    let client = TableVaultClient::new(&f.env, &f.vault);
    let mut proposal = f.proposal.clone();
    proposal.nonce = BytesN::from_array(&f.env, &[75; 32]);
    proposal.buy_ins = vec![&f.env, i128::MAX - 1, 1];
    let table_id = client.create_table(&proposal);
    let first = f.participants.get(0).unwrap().player;
    let second = f.participants.get(1).unwrap().player;
    token::StellarAssetClient::new(&f.env, &f.token).mint(&first, &(i128::MAX - 201));
    client.deposit(&table_id, &first, &(i128::MAX - 1));
    client.deposit(&table_id, &second, &1);

    assert_eq!(client.exit(&table_id, &first, &0), i128::MAX - 1);
    assert_eq!(client.table(&table_id).state.stacks, vec![&f.env, 0, 1]);
    assert_eq!(client.backing().collateral, 1);
    assert_eq!(client.backing().liabilities, 1);
    assert_eq!(
        token::TokenClient::new(&f.env, &f.token).balance(&first),
        i128::MAX - 1
    );
}
