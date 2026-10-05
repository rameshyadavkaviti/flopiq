use flopiq_settlement_types::Participant;
use flopiq_table_vault::{Backing, TableProposal, TableVault, TableVaultArgs, TableVaultClient};
use soroban_sdk::{
    Address, BytesN, Env, IntoVal, Vec,
    testutils::{Address as _, MockAuth, MockAuthInvoke},
    token,
};

struct Fixture {
    env: Env,
    vault: Address,
    token: Address,
    players: Vec<Participant>,
    table: BytesN<32>,
}

fn fixture(nonce: u8) -> Fixture {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();
    let admin = Address::generate(&env);
    let sac = env.register_stellar_asset_contract_v2(admin);
    let token = sac.address();
    let vault = env.register(TableVault, TableVaultArgs::__constructor(&token));

    let first = Address::generate(&env);
    let second = Address::generate(&env);
    token::StellarAssetClient::new(&env, &token).mint(&first, &1_000);
    token::StellarAssetClient::new(&env, &token).mint(&second, &1_000);
    let players = soroban_sdk::vec![
        &env,
        Participant {
            seat: 0,
            player: first,
        },
        Participant {
            seat: 1,
            player: second,
        },
    ];
    let proposal = TableProposal {
        nonce: BytesN::from_array(&env, &[nonce; 32]),
        config_digest: BytesN::from_array(&env, &[0xA5; 32]),
        participants: players.clone(),
        buy_ins: soroban_sdk::vec![&env, 100_i128, 100_i128],
    };
    let client = TableVaultClient::new(&env, &vault);
    let table = client.create_table(&proposal);
    for participant in players.iter() {
        client.deposit(&table, &participant.player, &100);
    }

    Fixture {
        env,
        vault,
        token,
        players,
        table,
    }
}

fn second_table(f: &Fixture, nonce: u8) -> BytesN<32> {
    let proposal = TableProposal {
        nonce: BytesN::from_array(&f.env, &[nonce; 32]),
        config_digest: BytesN::from_array(&f.env, &[0xB6; 32]),
        participants: f.players.clone(),
        buy_ins: soroban_sdk::vec![&f.env, 100_i128, 100_i128],
    };
    let client = TableVaultClient::new(&f.env, &f.vault);
    let table = client.create_table(&proposal);
    for participant in f.players.iter() {
        client.deposit(&table, &participant.player, &100);
    }
    table
}

struct RedepositCall<'a> {
    table: &'a BytesN<32>,
    player: &'a Address,
    amount: i128,
    version: u64,
}

fn redeposit_with_tree(
    f: &Fixture,
    approved: RedepositCall<'_>,
    approved_transfer_amount: i128,
    actual: RedepositCall<'_>,
) -> bool {
    let transfer = MockAuthInvoke {
        contract: &f.token,
        fn_name: "transfer",
        args: (
            approved.player.clone(),
            f.vault.clone(),
            approved_transfer_amount,
        )
            .into_val(&f.env),
        sub_invokes: &[],
    };
    let transfers = [transfer];
    let root = MockAuthInvoke {
        contract: &f.vault,
        fn_name: "redeposit",
        args: (
            approved.table.clone(),
            approved.player.clone(),
            approved.amount,
            approved.version,
        )
            .into_val(&f.env),
        sub_invokes: &transfers,
    };
    let auths = [MockAuth {
        address: approved.player,
        invoke: &root,
    }];
    TableVaultClient::new(&f.env, &f.vault)
        .mock_auths(&auths)
        .try_redeposit(actual.table, actual.player, &actual.amount, &actual.version)
        .is_err()
}

fn assert_unchanged(
    f: &Fixture,
    table: &BytesN<32>,
    table_before: &flopiq_table_vault::Table,
    backing_before: &Backing,
    player: &Address,
    player_before: i128,
    vault_before: i128,
) {
    let client = TableVaultClient::new(&f.env, &f.vault);
    assert_eq!(client.table(table), *table_before);
    assert_eq!(client.backing(), *backing_before);
    let token_client = token::TokenClient::new(&f.env, &f.token);
    assert_eq!(token_client.balance(player), player_before);
    assert_eq!(token_client.balance(&f.vault), vault_before);
}

#[test]
fn redeposit_authorization_cannot_cross_tables() {
    let f = fixture(0x10);
    let other = second_table(&f, 0x11);
    let player = f.players.get(0).unwrap().player;
    let client = TableVaultClient::new(&f.env, &f.vault);
    client.exit(&f.table, &player, &0);
    client.exit(&other, &player, &0);

    let table_before = client.table(&other);
    let backing_before = client.backing();
    let token_client = token::TokenClient::new(&f.env, &f.token);
    let player_before = token_client.balance(&player);
    let vault_before = token_client.balance(&f.vault);
    f.env.set_auths(&[]);

    assert!(
        redeposit_with_tree(
            &f,
            RedepositCall {
                table: &f.table,
                player: &player,
                amount: 50,
                version: 1,
            },
            50,
            RedepositCall {
                table: &other,
                player: &player,
                amount: 50,
                version: 1,
            },
        )
    );
    assert_unchanged(
        &f,
        &other,
        &table_before,
        &backing_before,
        &player,
        player_before,
        vault_before,
    );
}

#[test]
fn redeposit_authorization_cannot_cross_players_or_versions() {
    let f = fixture(0x20);
    let client = TableVaultClient::new(&f.env, &f.vault);
    let first = f.players.get(0).unwrap().player;
    let second = f.players.get(1).unwrap().player;
    client.exit(&f.table, &first, &0);
    client.exit(&f.table, &second, &1);
    let table_before = client.table(&f.table);
    let backing_before = client.backing();
    let token_client = token::TokenClient::new(&f.env, &f.token);
    let second_before = token_client.balance(&second);
    let vault_before = token_client.balance(&f.vault);
    f.env.set_auths(&[]);

    assert!(
        redeposit_with_tree(
            &f,
            RedepositCall {
                table: &f.table,
                player: &first,
                amount: 50,
                version: 2,
            },
            50,
            RedepositCall {
                table: &f.table,
                player: &second,
                amount: 50,
                version: 2,
            },
        )
    );
    assert_unchanged(
        &f,
        &f.table,
        &table_before,
        &backing_before,
        &second,
        second_before,
        vault_before,
    );

    assert!(
        redeposit_with_tree(
            &f,
            RedepositCall {
                table: &f.table,
                player: &second,
                amount: 50,
                version: 1,
            },
            50,
            RedepositCall {
                table: &f.table,
                player: &second,
                amount: 50,
                version: 2,
            },
        )
    );
    assert_unchanged(
        &f,
        &f.table,
        &table_before,
        &backing_before,
        &second,
        second_before,
        vault_before,
    );
}

#[test]
fn redeposit_nested_sac_transfer_must_match_the_authorized_tree() {
    let f = fixture(0x30);
    let client = TableVaultClient::new(&f.env, &f.vault);
    let player = f.players.get(0).unwrap().player;
    client.exit(&f.table, &player, &0);
    let table_before = client.table(&f.table);
    let backing_before = client.backing();
    let token_client = token::TokenClient::new(&f.env, &f.token);
    let player_before = token_client.balance(&player);
    let vault_before = token_client.balance(&f.vault);
    f.env.set_auths(&[]);

    assert!(
        redeposit_with_tree(
            &f,
            RedepositCall {
                table: &f.table,
                player: &player,
                amount: 50,
                version: 1,
            },
            49,
            RedepositCall {
                table: &f.table,
                player: &player,
                amount: 50,
                version: 1,
            },
        )
    );
    assert_unchanged(
        &f,
        &f.table,
        &table_before,
        &backing_before,
        &player,
        player_before,
        vault_before,
    );
}

#[test]
fn collateral_overflow_after_valid_liability_addition_fails_before_auth_or_transfer() {
    let f = fixture(0x40);
    let client = TableVaultClient::new(&f.env, &f.vault);
    let player = f.players.get(0).unwrap().player;
    client.exit(&f.table, &player, &0);

    // liabilities == 100, while unsolicited selected-SAC surplus pushes
    // collateral to i128::MAX. Adding 1 to liabilities is valid; adding 1 to
    // collateral is not.
    token::StellarAssetClient::new(&f.env, &f.token).mint(&f.vault, &(i128::MAX - 100));
    assert_eq!(
        client.backing(),
        Backing {
            collateral: i128::MAX,
            liabilities: 100,
            surplus: i128::MAX - 100,
        }
    );

    let table_before = client.table(&f.table);
    let backing_before = client.backing();
    let token_client = token::TokenClient::new(&f.env, &f.token);
    let player_before = token_client.balance(&player);
    let vault_before = token_client.balance(&f.vault);
    f.env.set_auths(&[]);

    assert!(client.try_redeposit(&f.table, &player, &1, &1).is_err());
    assert_unchanged(
        &f,
        &f.table,
        &table_before,
        &backing_before,
        &player,
        player_before,
        vault_before,
    );
}
