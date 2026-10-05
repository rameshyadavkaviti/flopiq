use flopiq_settlement_types::{Participant, Settlement};
use flopiq_table_vault::{
    Backing, Table, TablePhase, TableProposal, TableVault, TableVaultArgs, TableVaultClient,
    VaultError,
};
use soroban_sdk::{Address, BytesN, Env, Vec, testutils::Address as _, token, vec};

struct TableFixture {
    participants: Vec<Participant>,
    proposal: TableProposal,
    table_id: BytesN<32>,
}

struct VaultFixture {
    env: Env,
    vault: Address,
    token: Address,
}

fn vault_fixture() -> VaultFixture {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();
    let admin = Address::generate(&env);
    let sac = env.register_stellar_asset_contract_v2(admin);
    let token = sac.address();
    let vault = env.register(TableVault, TableVaultArgs::__constructor(&token));
    VaultFixture { env, vault, token }
}

fn allocate(f: &VaultFixture, nonce_byte: u8, player_count: u32, buy_in: i128) -> TableFixture {
    let mut participants = Vec::new(&f.env);
    let mut buy_ins = Vec::new(&f.env);
    for seat in 0..player_count {
        let player = Address::generate(&f.env);
        token::StellarAssetClient::new(&f.env, &f.token).mint(&player, &(buy_in * 4));
        participants.push_back(Participant { seat, player });
        buy_ins.push_back(buy_in);
    }
    let proposal = TableProposal {
        nonce: BytesN::from_array(&f.env, &[nonce_byte; 32]),
        config_digest: BytesN::from_array(&f.env, &[nonce_byte.wrapping_add(1); 32]),
        participants: participants.clone(),
        buy_ins,
    };
    let table_id = TableVaultClient::new(&f.env, &f.vault).create_table(&proposal);
    TableFixture {
        participants,
        proposal,
        table_id,
    }
}

fn fund(f: &VaultFixture, table: &TableFixture) {
    let client = TableVaultClient::new(&f.env, &f.vault);
    for (index, participant) in table.participants.iter().enumerate() {
        client.deposit(
            &table.table_id,
            &participant.player,
            &table.proposal.buy_ins.get(index as u32).unwrap(),
        );
    }
}

fn settlement(
    f: &VaultFixture,
    table: &TableFixture,
    hand_id: BytesN<32>,
    final_stacks: Vec<i128>,
) -> Settlement {
    let state = TableVaultClient::new(&f.env, &f.vault)
        .table(&table.table_id)
        .state;
    Settlement {
        protocol_version: 1,
        table_id: table.table_id.clone(),
        hand_id,
        previous_state_version: state.version,
        next_state_version: state.version + 1,
        participants: table.participants.clone(),
        starting_stacks: state.stacks,
        final_stacks,
        rake: 0,
        action_transcript_digest: BytesN::from_array(&f.env, &[0xA1; 32]),
        fairness_digest: BytesN::from_array(&f.env, &[0xB2; 32]),
    }
}

fn claims(table: &Table) -> i128 {
    table.state.stacks.iter().sum()
}

fn assert_global_claims(
    client: &TableVaultClient<'_>,
    table_ids: &[&BytesN<32>],
    expected_surplus: i128,
) {
    let total_claims: i128 = table_ids
        .iter()
        .map(|table_id| claims(&client.table(table_id)))
        .sum();
    let backing = client.backing();
    assert_eq!(total_claims, backing.liabilities);
    assert!(backing.collateral >= backing.liabilities);
    assert_eq!(backing.surplus, expected_surplus);
}

#[test]
fn multi_table_settlement_preserves_global_liability_and_table_isolation() {
    let f = vault_fixture();
    let a = allocate(&f, 10, 2, 100);
    let b = allocate(&f, 20, 3, 70);
    fund(&f, &a);
    fund(&f, &b);

    let client = TableVaultClient::new(&f.env, &f.vault);
    let b_before = client.table(&b.table_id);
    assert_global_claims(&client, &[&a.table_id, &b.table_id], 0);
    assert_eq!(client.backing().liabilities, 410);

    let hand_a = client.start_hand(&a.table_id, &0);
    client.commit(&settlement(&f, &a, hand_a, vec![&f.env, 135_i128, 65_i128]));

    let a_after = client.table(&a.table_id);
    assert_eq!(a_after.state.version, 1);
    assert_eq!(a_after.state.stacks, vec![&f.env, 135_i128, 65_i128]);
    assert_eq!(client.table(&b.table_id), b_before);
    assert_global_claims(&client, &[&a.table_id, &b.table_id], 0);
    assert_eq!(client.backing().liabilities, 410);

    let hand_b = client.start_hand(&b.table_id, &0);
    assert_ne!(hand_b, client.start_hand(&a.table_id, &1));
}

#[test]
fn selected_sac_surplus_and_wrong_asset_never_become_player_claims() {
    let f = vault_fixture();
    let table = allocate(&f, 30, 2, 100);
    fund(&f, &table);
    let client = TableVaultClient::new(&f.env, &f.vault);

    let donor = Address::generate(&f.env);
    token::StellarAssetClient::new(&f.env, &f.token).mint(&donor, &50);
    token::TokenClient::new(&f.env, &f.token).transfer(&donor, &f.vault, &50);

    assert_eq!(
        client.backing(),
        Backing {
            collateral: 250,
            liabilities: 200,
            surplus: 50,
        }
    );
    assert_global_claims(&client, &[&table.table_id], 50);

    let other_admin = Address::generate(&f.env);
    let other_sac = f.env.register_stellar_asset_contract_v2(other_admin);
    let other_token = other_sac.address();
    let other_donor = Address::generate(&f.env);
    token::StellarAssetClient::new(&f.env, &other_token).mint(&other_donor, &999);
    token::TokenClient::new(&f.env, &other_token).transfer(&other_donor, &f.vault, &999);

    assert_eq!(
        client.backing(),
        Backing {
            collateral: 250,
            liabilities: 200,
            surplus: 50,
        }
    );
    assert_global_claims(&client, &[&table.table_id], 50);

    let hand = client.start_hand(&table.table_id, &0);
    client.commit(&settlement(
        &f,
        &table,
        hand,
        vec![&f.env, 80_i128, 120_i128],
    ));
    assert_global_claims(&client, &[&table.table_id], 50);
}

#[test]
fn repeated_hand_lifecycles_keep_versions_and_replay_protection_table_local() {
    let f = vault_fixture();
    let a = allocate(&f, 40, 2, 100);
    let b = allocate(&f, 50, 2, 60);
    fund(&f, &a);
    fund(&f, &b);
    let client = TableVaultClient::new(&f.env, &f.vault);

    let a_hand_0 = client.start_hand(&a.table_id, &0);
    let a_payload_0 = settlement(&f, &a, a_hand_0.clone(), vec![&f.env, 110_i128, 90_i128]);
    client.commit(&a_payload_0);
    assert_eq!(client.table(&a.table_id).state.version, 1);
    assert_eq!(client.table(&b.table_id).state.version, 0);

    let b_hand_0 = client.start_hand(&b.table_id, &0);
    assert_ne!(a_hand_0, b_hand_0);
    client.commit(&settlement(
        &f,
        &b,
        b_hand_0,
        vec![&f.env, 55_i128, 65_i128],
    ));

    let a_hand_1 = client.start_hand(&a.table_id, &1);
    assert_ne!(a_hand_0, a_hand_1);
    client.commit(&settlement(
        &f,
        &a,
        a_hand_1,
        vec![&f.env, 95_i128, 105_i128],
    ));

    assert_eq!(client.table(&a.table_id).state.version, 2);
    assert_eq!(client.table(&b.table_id).state.version, 1);
    assert_eq!(client.try_commit(&a_payload_0), Err(Ok(VaultError::Replay)));
    assert_global_claims(&client, &[&a.table_id, &b.table_id], 0);
}

#[test]
fn failed_settlement_is_fully_immutable_and_does_not_consume_the_active_hand() {
    let f = vault_fixture();
    let table = allocate(&f, 60, 2, 100);
    fund(&f, &table);
    let client = TableVaultClient::new(&f.env, &f.vault);

    let hand = client.start_hand(&table.table_id, &0);
    let table_before = client.table(&table.table_id);
    let backing_before = client.backing();
    let vault_balance_before = token::TokenClient::new(&f.env, &f.token).balance(&f.vault);

    let invalid = settlement(&f, &table, hand.clone(), vec![&f.env, 150_i128, 51_i128]);
    assert_eq!(client.try_commit(&invalid), Err(Ok(VaultError::Amount)));
    assert_eq!(client.table(&table.table_id), table_before);
    assert_eq!(client.backing(), backing_before);
    assert_eq!(
        token::TokenClient::new(&f.env, &f.token).balance(&f.vault),
        vault_balance_before
    );

    let valid = settlement(&f, &table, hand, vec![&f.env, 150_i128, 50_i128]);
    client.commit(&valid);
    assert_eq!(client.table(&table.table_id).phase, TablePhase::Ready);
    assert_eq!(client.table(&table.table_id).state.version, 1);
    assert_global_claims(&client, &[&table.table_id], 0);
}
