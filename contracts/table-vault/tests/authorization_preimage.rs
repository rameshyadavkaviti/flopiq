use flopiq_settlement_types::{Participant, Settlement};
use flopiq_table_vault::{
    Backing, TablePhase, TableProposal, TableVault, TableVaultArgs, TableVaultClient,
};
use soroban_sdk::{
    Address, BytesN, Env, IntoVal, Vec,
    testutils::{Address as _, MockAuth, MockAuthInvoke},
    token,
};

struct Fixture {
    env: Env,
    vault: Address,
    token: Address,
}

fn fixture() -> Fixture {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();
    let admin = Address::generate(&env);
    let sac = env.register_stellar_asset_contract_v2(admin);
    let token = sac.address();
    let vault = env.register(TableVault, TableVaultArgs::__constructor(&token));
    Fixture { env, vault, token }
}

fn participants(f: &Fixture, count: u32) -> Vec<Participant> {
    let mut result = Vec::new(&f.env);
    for seat in 0..count {
        let player = Address::generate(&f.env);
        token::StellarAssetClient::new(&f.env, &f.token).mint(&player, &1_000);
        result.push_back(Participant { seat, player });
    }
    result
}

fn proposal(
    f: &Fixture,
    participants: &Vec<Participant>,
    nonce_byte: u8,
    config_byte: u8,
    buy_in: i128,
) -> TableProposal {
    let mut buy_ins = Vec::new(&f.env);
    for _ in 0..participants.len() {
        buy_ins.push_back(buy_in);
    }
    TableProposal {
        nonce: BytesN::from_array(&f.env, &[nonce_byte; 32]),
        config_digest: BytesN::from_array(&f.env, &[config_byte; 32]),
        participants: participants.clone(),
        buy_ins,
    }
}

fn create(f: &Fixture, proposal: &TableProposal) -> BytesN<32> {
    TableVaultClient::new(&f.env, &f.vault).create_table(proposal)
}

fn fund(f: &Fixture, table_id: &BytesN<32>, proposal: &TableProposal) {
    let client = TableVaultClient::new(&f.env, &f.vault);
    for (index, participant) in proposal.participants.iter().enumerate() {
        client.deposit(
            table_id,
            &participant.player,
            &proposal.buy_ins.get(index as u32).unwrap(),
        );
    }
}

fn settlement(
    f: &Fixture,
    table_id: &BytesN<32>,
    hand_id: BytesN<32>,
    participants: &Vec<Participant>,
) -> Settlement {
    let state = TableVaultClient::new(&f.env, &f.vault)
        .table(table_id)
        .state;
    Settlement {
        protocol_version: 1,
        table_id: table_id.clone(),
        hand_id,
        previous_state_version: state.version,
        next_state_version: state.version + 1,
        participants: participants.clone(),
        starting_stacks: state.stacks.clone(),
        final_stacks: state.stacks,
        rake: 0,
        action_transcript_digest: BytesN::from_array(&f.env, &[0xA1; 32]),
        fairness_digest: BytesN::from_array(&f.env, &[0xB2; 32]),
    }
}

fn assert_create_substitution_rejected(case: u32) {
    let f = fixture();
    let approved_participants = participants(&f, 2);
    let approved = proposal(&f, &approved_participants, 10, 11, 100);
    let mut tampered = approved.clone();

    match case {
        0 => tampered.nonce = BytesN::from_array(&f.env, &[12; 32]),
        1 => tampered.config_digest = BytesN::from_array(&f.env, &[13; 32]),
        2 => {
            let first = tampered.participants.get(0).unwrap();
            tampered.participants.set(
                1,
                Participant {
                    seat: 1,
                    player: Address::generate(&f.env),
                },
            );
            assert_eq!(tampered.participants.get(0).unwrap(), first);
        }
        3 => {
            let first = tampered.participants.get(0).unwrap();
            let second = tampered.participants.get(1).unwrap();
            tampered.participants.set(
                0,
                Participant {
                    seat: 0,
                    player: second.player,
                },
            );
            tampered.participants.set(
                1,
                Participant {
                    seat: 1,
                    player: first.player,
                },
            );
        }
        4 => {
            let second = tampered.participants.get(1).unwrap();
            tampered.participants.set(
                1,
                Participant {
                    seat: 2,
                    player: second.player,
                },
            );
        }
        5 => tampered.buy_ins.set(1, 125),
        6 => {
            tampered.participants.push_back(Participant {
                seat: 2,
                player: Address::generate(&f.env),
            });
            tampered.buy_ins.push_back(100);
        }
        7 => {
            tampered.nonce = BytesN::from_array(&f.env, &[21; 32]);
            tampered.config_digest = BytesN::from_array(&f.env, &[22; 32]);
            let first = tampered.participants.get(0).unwrap();
            let second = tampered.participants.get(1).unwrap();
            tampered.participants.set(
                0,
                Participant {
                    seat: 0,
                    player: second.player,
                },
            );
            tampered.participants.set(
                1,
                Participant {
                    seat: 2,
                    player: first.player,
                },
            );
            tampered.buy_ins.set(0, 140);
            tampered.buy_ins.set(1, 160);
        }
        _ => unreachable!(),
    }

    f.env.set_auths(&[]);
    let first = approved.participants.get(0).unwrap().player;
    let second = approved.participants.get(1).unwrap().player;
    let approved_invoke = MockAuthInvoke {
        contract: &f.vault,
        fn_name: "create_table",
        args: (approved.clone(),).into_val(&f.env),
        sub_invokes: &[],
    };
    let auths = [
        MockAuth {
            address: &first,
            invoke: &approved_invoke,
        },
        MockAuth {
            address: &second,
            invoke: &approved_invoke,
        },
    ];
    let client = TableVaultClient::new(&f.env, &f.vault);
    assert!(
        client
            .mock_auths(&auths)
            .try_create_table(&tampered)
            .is_err(),
        "case {case} unexpectedly reused authorization"
    );
    assert_eq!(
        client.backing(),
        Backing {
            collateral: 0,
            liabilities: 0,
            surplus: 0,
        }
    );

    // Prove the substituted proposal itself is valid and the failed attempt did
    // not allocate it. The preceding failure is therefore authorization-specific.
    f.env.mock_all_auths();
    client.create_table(&tampered);
}

#[test]
fn create_table_authorization_binds_the_complete_valid_proposal() {
    for case in 0..8 {
        assert_create_substitution_rejected(case);
    }
}

struct DepositCall<'a> {
    table: &'a BytesN<32>,
    player: &'a Address,
    amount: i128,
}

fn attempt_deposit_with_approved_tree(
    f: &Fixture,
    approved: DepositCall<'_>,
    actual: DepositCall<'_>,
    expect_failure: bool,
) {
    let transfer_invoke = MockAuthInvoke {
        contract: &f.token,
        fn_name: "transfer",
        args: (approved.player.clone(), f.vault.clone(), approved.amount).into_val(&f.env),
        sub_invokes: &[],
    };
    let transfer_sub_invokes = [transfer_invoke];
    let deposit_invoke = MockAuthInvoke {
        contract: &f.vault,
        fn_name: "deposit",
        args: (
            approved.table.clone(),
            approved.player.clone(),
            approved.amount,
        )
            .into_val(&f.env),
        sub_invokes: &transfer_sub_invokes,
    };
    let auths = [MockAuth {
        address: approved.player,
        invoke: &deposit_invoke,
    }];
    let client = TableVaultClient::new(&f.env, &f.vault);
    if expect_failure {
        assert!(
            client
                .mock_auths(&auths)
                .try_deposit(actual.table, actual.player, &actual.amount)
                .is_err()
        );
    } else {
        client
            .mock_auths(&auths)
            .deposit(actual.table, actual.player, &actual.amount);
    }
}

fn assert_deposit_unchanged(
    f: &Fixture,
    table_id: &BytesN<32>,
    player: &Address,
    table_before: &flopiq_table_vault::Table,
    backing_before: &Backing,
    player_before: i128,
    vault_before: i128,
) {
    let client = TableVaultClient::new(&f.env, &f.vault);
    assert_eq!(client.table(table_id), *table_before);
    assert_eq!(client.backing(), *backing_before);
    assert_eq!(
        token::TokenClient::new(&f.env, &f.token).balance(player),
        player_before
    );
    assert_eq!(
        token::TokenClient::new(&f.env, &f.token).balance(&f.vault),
        vault_before
    );
}

#[test]
fn deposit_authorization_cannot_move_between_tables() {
    let f = fixture();
    let players = participants(&f, 2);
    let a = proposal(&f, &players, 30, 31, 100);
    let b = proposal(&f, &players, 32, 33, 100);
    let table_a = create(&f, &a);
    let table_b = create(&f, &b);
    let player = players.get(0).unwrap().player;
    let client = TableVaultClient::new(&f.env, &f.vault);
    let table_before = client.table(&table_b);
    let backing_before = client.backing();
    let player_before = token::TokenClient::new(&f.env, &f.token).balance(&player);
    let vault_before = token::TokenClient::new(&f.env, &f.token).balance(&f.vault);

    f.env.set_auths(&[]);
    attempt_deposit_with_approved_tree(
        &f,
        DepositCall {
            table: &table_a,
            player: &player,
            amount: 100,
        },
        DepositCall {
            table: &table_b,
            player: &player,
            amount: 100,
        },
        true,
    );
    assert_deposit_unchanged(
        &f,
        &table_b,
        &player,
        &table_before,
        &backing_before,
        player_before,
        vault_before,
    );

    attempt_deposit_with_approved_tree(
        &f,
        DepositCall {
            table: &table_b,
            player: &player,
            amount: 100,
        },
        DepositCall {
            table: &table_b,
            player: &player,
            amount: 100,
        },
        false,
    );
}

#[test]
fn deposit_authorization_cannot_move_between_players() {
    let f = fixture();
    let players = participants(&f, 2);
    let p = proposal(&f, &players, 40, 41, 100);
    let table_id = create(&f, &p);
    let first = players.get(0).unwrap().player;
    let second = players.get(1).unwrap().player;
    let client = TableVaultClient::new(&f.env, &f.vault);
    let table_before = client.table(&table_id);
    let backing_before = client.backing();
    let second_before = token::TokenClient::new(&f.env, &f.token).balance(&second);
    let vault_before = token::TokenClient::new(&f.env, &f.token).balance(&f.vault);

    f.env.set_auths(&[]);
    attempt_deposit_with_approved_tree(
        &f,
        DepositCall {
            table: &table_id,
            player: &first,
            amount: 100,
        },
        DepositCall {
            table: &table_id,
            player: &second,
            amount: 100,
        },
        true,
    );
    assert_deposit_unchanged(
        &f,
        &table_id,
        &second,
        &table_before,
        &backing_before,
        second_before,
        vault_before,
    );

    attempt_deposit_with_approved_tree(
        &f,
        DepositCall {
            table: &table_id,
            player: &second,
            amount: 100,
        },
        DepositCall {
            table: &table_id,
            player: &second,
            amount: 100,
        },
        false,
    );
}

#[test]
fn deposit_authorization_binds_amount_after_semantic_validation() {
    let f = fixture();
    let players = participants(&f, 2);
    let p = proposal(&f, &players, 50, 51, 200);
    let table_id = create(&f, &p);
    let player = players.get(0).unwrap().player;
    let client = TableVaultClient::new(&f.env, &f.vault);
    let table_before = client.table(&table_id);
    let backing_before = client.backing();
    let player_before = token::TokenClient::new(&f.env, &f.token).balance(&player);
    let vault_before = token::TokenClient::new(&f.env, &f.token).balance(&f.vault);

    f.env.set_auths(&[]);
    // 200 is the valid required deposit, so this reaches authorization. The
    // supplied authorization tree is for the same table/player but amount 100.
    attempt_deposit_with_approved_tree(
        &f,
        DepositCall {
            table: &table_id,
            player: &player,
            amount: 100,
        },
        DepositCall {
            table: &table_id,
            player: &player,
            amount: 200,
        },
        true,
    );
    assert_deposit_unchanged(
        &f,
        &table_id,
        &player,
        &table_before,
        &backing_before,
        player_before,
        vault_before,
    );

    attempt_deposit_with_approved_tree(
        &f,
        DepositCall {
            table: &table_id,
            player: &player,
            amount: 200,
        },
        DepositCall {
            table: &table_id,
            player: &player,
            amount: 200,
        },
        false,
    );
}

#[test]
fn deposit_nested_sac_transfer_preimage_is_not_independently_reusable() {
    let f = fixture();
    let players = participants(&f, 2);
    let p = proposal(&f, &players, 60, 61, 100);
    let table_id = create(&f, &p);
    let player = players.get(0).unwrap().player;
    let client = TableVaultClient::new(&f.env, &f.vault);
    let table_before = client.table(&table_id);
    let backing_before = client.backing();
    let player_before = token::TokenClient::new(&f.env, &f.token).balance(&player);
    let vault_before = token::TokenClient::new(&f.env, &f.token).balance(&f.vault);

    f.env.set_auths(&[]);
    let wrong_transfer = MockAuthInvoke {
        contract: &f.token,
        fn_name: "transfer",
        args: (player.clone(), f.vault.clone(), 99_i128).into_val(&f.env),
        sub_invokes: &[],
    };
    let sub_invokes = [wrong_transfer];
    let correct_root = MockAuthInvoke {
        contract: &f.vault,
        fn_name: "deposit",
        args: (table_id.clone(), player.clone(), 100_i128).into_val(&f.env),
        sub_invokes: &sub_invokes,
    };
    let auths = [MockAuth {
        address: &player,
        invoke: &correct_root,
    }];

    assert!(
        client
            .mock_auths(&auths)
            .try_deposit(&table_id, &player, &100)
            .is_err()
    );
    assert_deposit_unchanged(
        &f,
        &table_id,
        &player,
        &table_before,
        &backing_before,
        player_before,
        vault_before,
    );

    attempt_deposit_with_approved_tree(
        &f,
        DepositCall {
            table: &table_id,
            player: &player,
            amount: 100,
        },
        DepositCall {
            table: &table_id,
            player: &player,
            amount: 100,
        },
        false,
    );
}

struct StartCall<'a> {
    table: &'a BytesN<32>,
    version: u64,
}

fn attempt_start_with_approved_tree(
    f: &Fixture,
    participants: &Vec<Participant>,
    approved: StartCall<'_>,
    actual: StartCall<'_>,
    include_second: bool,
    expect_failure: bool,
) {
    let invoke = MockAuthInvoke {
        contract: &f.vault,
        fn_name: "start_hand",
        args: (approved.table.clone(), approved_version).into_val(&f.env),
        sub_invokes: &[],
    };
    let first = participants.get(0).unwrap().player;
    let second = participants.get(1).unwrap().player;
    let first_auth = MockAuth {
        address: &first,
        invoke: &invoke,
    };
    let second_auth = MockAuth {
        address: &second,
        invoke: &invoke,
    };
    let client = TableVaultClient::new(&f.env, &f.vault);

    if include_second {
        let auths = [first_auth, second_auth];
        if expect_failure {
            assert!(
                client
                    .mock_auths(&auths)
                    .try_start_hand(actual.table, &actual.version)
                    .is_err()
            );
        } else {
            client
                .mock_auths(&auths)
                .start_hand(actual.table, &actual.version);
        }
    } else {
        let auths = [first_auth];
        assert!(
            client
                .mock_auths(&auths)
                .try_start_hand(actual.table, &actual.version)
                .is_err()
        );
    }
}

#[test]
fn start_hand_authorization_cannot_move_between_tables() {
    let f = fixture();
    let players = participants(&f, 2);
    let a = proposal(&f, &players, 70, 71, 100);
    let b = proposal(&f, &players, 72, 73, 100);
    let table_a = create(&f, &a);
    let table_b = create(&f, &b);
    fund(&f, &table_a, &a);
    fund(&f, &table_b, &b);
    let client = TableVaultClient::new(&f.env, &f.vault);
    let before = client.table(&table_b);
    let backing_before = client.backing();

    f.env.set_auths(&[]);
    attempt_start_with_approved_tree(
        &f,
        &players,
        StartCall {
            table: &table_a,
            version: 0,
        },
        StartCall {
            table: &table_b,
            version: 0,
        },
        true,
        true,
    );
    assert_eq!(client.table(&table_b), before);
    assert_eq!(client.backing(), backing_before);

    // A correct tree can still start the hand, proving the failed attempt did
    // not change phase or consume the table/version hand identity.
    attempt_start_with_approved_tree(
        &f,
        &players,
        StartCall {
            table: &table_b,
            version: 0,
        },
        StartCall {
            table: &table_b,
            version: 0,
        },
        true,
        false,
    );
    assert!(matches!(
        client.table(&table_b).phase,
        TablePhase::Active(_)
    ));
}

#[test]
fn start_hand_authorization_binds_expected_state_version() {
    let f = fixture();
    let players = participants(&f, 2);
    let p = proposal(&f, &players, 80, 81, 100);
    let table_id = create(&f, &p);
    fund(&f, &table_id, &p);
    let client = TableVaultClient::new(&f.env, &f.vault);

    let hand = client.start_hand(&table_id, &0);
    client.commit(&settlement(&f, &table_id, hand, &players));
    assert_eq!(client.table(&table_id).state.version, 1);
    let before = client.table(&table_id);
    let backing_before = client.backing();

    f.env.set_auths(&[]);
    attempt_start_with_approved_tree(
        &f,
        &players,
        StartCall {
            table: &table_id,
            version: 0,
        },
        StartCall {
            table: &table_id,
            version: 1,
        },
        true,
        true,
    );
    assert_eq!(client.table(&table_id), before);
    assert_eq!(client.backing(), backing_before);

    attempt_start_with_approved_tree(
        &f,
        &players,
        StartCall {
            table: &table_id,
            version: 1,
        },
        StartCall {
            table: &table_id,
            version: 1,
        },
        true,
        false,
    );
    assert!(matches!(
        client.table(&table_id).phase,
        TablePhase::Active(_)
    ));
    assert_eq!(client.table(&table_id).state.version, 1);
}

#[test]
fn start_hand_requires_the_complete_participant_authorization_set() {
    let f = fixture();
    let players = participants(&f, 2);
    let p = proposal(&f, &players, 90, 91, 100);
    let table_id = create(&f, &p);
    fund(&f, &table_id, &p);
    let client = TableVaultClient::new(&f.env, &f.vault);
    let before = client.table(&table_id);
    let backing_before = client.backing();

    f.env.set_auths(&[]);
    attempt_start_with_approved_tree(
        &f,
        &players,
        StartCall {
            table: &table_id,
            version: 0,
        },
        StartCall {
            table: &table_id,
            version: 0,
        },
        false,
        true,
    );
    assert_eq!(client.table(&table_id), before);
    assert_eq!(client.backing(), backing_before);

    attempt_start_with_approved_tree(
        &f,
        &players,
        StartCall {
            table: &table_id,
            version: 0,
        },
        StartCall {
            table: &table_id,
            version: 0,
        },
        true,
        false,
    );
    assert!(matches!(
        client.table(&table_id).phase,
        TablePhase::Active(_)
    ));
}
