use super::*;
use soroban_sdk::{testutils::Address as _, vec, Address, BytesN, Env};

#[test]
fn commits_conserved_settlement_and_rejects_replay() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register(TableState, ());
    let client = TableStateClient::new(&env, &id);
    let participants = vec![
        &env,
        Participant {
            seat: 0,
            player: Address::generate(&env),
        },
        Participant {
            seat: 8,
            player: Address::generate(&env),
        },
    ];
    let table = BytesN::from_array(&env, &[1; 32]);
    let stacks = vec![&env, 100_i128, 100_i128];
    client.initialize(&table, &participants, &stacks);
    let payload = Settlement {
        protocol_version: 1,
        table_id: table.clone(),
        hand_id: BytesN::from_array(&env, &[2; 32]),
        previous_state_version: 0,
        next_state_version: 1,
        participants,
        starting_stacks: stacks,
        final_stacks: vec![&env, 150_i128, 50_i128],
        rake: 0,
        action_transcript_digest: BytesN::from_array(&env, &[3; 32]),
        fairness_digest: BytesN::from_array(&env, &[4; 32]),
    };
    client.commit(&payload);
    assert_eq!(client.state(&table).version, 1);
    assert_eq!(client.state(&table).stacks, payload.final_stacks);
    assert_eq!(client.try_commit(&payload), Err(Ok(Error::Replay)));
}

fn fixture() -> (Env, Address, Settlement) {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register(TableState, ());
    let payload = Settlement {
        protocol_version: 1,
        table_id: BytesN::from_array(&env, &[1; 32]),
        hand_id: BytesN::from_array(&env, &[2; 32]),
        previous_state_version: 0,
        next_state_version: 1,
        participants: vec![
            &env,
            Participant {
                seat: 0,
                player: Address::generate(&env),
            },
            Participant {
                seat: 8,
                player: Address::generate(&env),
            },
        ],
        starting_stacks: vec![&env, 100_i128, 100_i128],
        final_stacks: vec![&env, 150_i128, 50_i128],
        rake: 0,
        action_transcript_digest: BytesN::from_array(&env, &[3; 32]),
        fairness_digest: BytesN::from_array(&env, &[4; 32]),
    };
    TableStateClient::new(&env, &id).initialize(
        &payload.table_id,
        &payload.participants,
        &payload.starting_stacks,
    );
    (env, id, payload)
}

fn rejected(env: &Env, id: &Address, payload: &Settlement, expected: Error) {
    let client = TableStateClient::new(env, id);
    let table = BytesN::from_array(env, &[1; 32]);
    let before = client.state(&table);
    assert_eq!(client.try_commit(payload), Err(Ok(expected)));
    assert_eq!(client.state(&table), before);
}

#[test]
fn rejects_stale_and_skipped_versions() {
    let (env, id, mut p) = fixture();
    p.previous_state_version = 1;
    p.next_state_version = 2;
    rejected(&env, &id, &p, Error::Version);
    p.previous_state_version = 0;
    rejected(&env, &id, &p, Error::Version);
}

#[test]
fn rejects_malformed_vectors() {
    let (env, id, mut p) = fixture();
    p.final_stacks.pop_back();
    rejected(&env, &id, &p, Error::Participants);
    p.final_stacks.push_back(50);
    p.starting_stacks.pop_back();
    rejected(&env, &id, &p, Error::Participants);
}

#[test]
fn rejects_duplicate_and_noncanonical_participants() {
    let (env, id, mut p) = fixture();
    let first = p.participants.get(0).unwrap();
    p.participants.set(
        1,
        Participant {
            seat: 8,
            player: first.player,
        },
    );
    rejected(&env, &id, &p, Error::Participants);
    p.participants.set(
        1,
        Participant {
            seat: 0,
            player: Address::generate(&env),
        },
    );
    rejected(&env, &id, &p, Error::Participants);
}

#[test]
fn rejects_wrong_members_even_with_valid_order() {
    let (env, id, mut p) = fixture();
    p.participants.set(
        1,
        Participant {
            seat: 8,
            player: Address::generate(&env),
        },
    );
    rejected(&env, &id, &p, Error::StateMismatch);
}

#[test]
fn rejects_negative_and_nonconserved_amounts() {
    let (env, id, mut p) = fixture();
    p.final_stacks.set(0, -1);
    rejected(&env, &id, &p, Error::Amount);
    p.final_stacks.set(0, 151);
    rejected(&env, &id, &p, Error::Conservation);
}

#[test]
fn rejects_changed_starting_stacks() {
    let (env, id, mut p) = fixture();
    p.starting_stacks.set(0, 101);
    p.final_stacks.set(0, 151);
    rejected(&env, &id, &p, Error::StateMismatch);
}

#[test]
fn only_zero_rake_is_enabled() {
    let (env, id, mut p) = fixture();
    for rake in [-1, 1, i128::MAX] {
        p.rake = rake;
        rejected(&env, &id, &p, Error::RakeDisabled);
    }
}

#[test]
fn rejects_wrong_protocol_and_unknown_table() {
    let (env, id, mut p) = fixture();
    p.protocol_version = 2;
    rejected(&env, &id, &p, Error::Protocol);
    p.protocol_version = 1;
    p.table_id = BytesN::from_array(&env, &[9; 32]);
    rejected(&env, &id, &p, Error::UnknownTable);
}

#[test]
fn rejects_reinitialization() {
    let (env, id, p) = fixture();
    let client = TableStateClient::new(&env, &id);
    assert_eq!(
        client.try_initialize(&p.table_id, &p.participants, &p.starting_stacks),
        Err(Ok(Error::AlreadyExists))
    );
}

#[test]
fn requires_authorization_and_leaves_state_unchanged() {
    let (env, id, p) = fixture();
    env.set_auths(&[]);
    let client = TableStateClient::new(&env, &id);
    let before = client.state(&p.table_id);
    assert!(client.try_commit(&p).is_err());
    assert_eq!(client.state(&p.table_id), before);
    env.mock_all_auths();
    client.commit(&p); // Failed attempt did not consume hand identity.
}

#[test]
fn requires_every_participant_and_binds_full_payload() {
    use soroban_sdk::{
        testutils::{MockAuth, MockAuthInvoke},
        IntoVal,
    };
    let (env, id, p) = fixture();
    env.set_auths(&[]);
    let player = p.participants.get(0).unwrap().player;
    let auth = MockAuth {
        address: &player,
        invoke: &MockAuthInvoke {
            contract: &id,
            fn_name: "commit",
            args: (p.clone(),).into_val(&env),
            sub_invokes: &[],
        },
    };
    env.mock_auths(&[auth]);
    assert!(TableStateClient::new(&env, &id).try_commit(&p).is_err());
    env.mock_all_auths();
    TableStateClient::new(&env, &id).commit(&p);
    let auths = env.auths();
    assert_eq!(auths.len(), 2);
    for (_, invocation) in auths {
        assert_eq!(
            invocation.function,
            soroban_sdk::testutils::AuthorizedFunction::Contract((
                id.clone(),
                soroban_sdk::Symbol::new(&env, "commit"),
                (p.clone(),).into_val(&env)
            ))
        );
    }
}

#[test]
fn isolates_tables_and_rejects_cross_table_hand_reuse() {
    let (env, id, p) = fixture();
    let client = TableStateClient::new(&env, &id);
    let table2 = BytesN::from_array(&env, &[9; 32]);
    client.initialize(&table2, &p.participants, &p.starting_stacks);
    client.commit(&p);
    assert_eq!(client.state(&table2).version, 0);
    let mut other = p.clone();
    other.table_id = table2.clone();
    assert_eq!(client.try_commit(&other), Err(Ok(Error::Replay)));
    other.hand_id = BytesN::from_array(&env, &[8; 32]);
    client.commit(&other);
    assert_eq!(client.state(&table2).version, 1);
}

#[test]
fn large_values_and_overflow_rejection() {
    let (env, id, mut p) = fixture();
    let client = TableStateClient::new(&env, &id);
    p.table_id = BytesN::from_array(&env, &[9; 32]);
    p.starting_stacks = vec![&env, i128::MAX - 1, 1];
    p.final_stacks = vec![&env, 0, i128::MAX];
    client.initialize(&p.table_id, &p.participants, &p.starting_stacks);
    client.commit(&p);
    p.table_id = BytesN::from_array(&env, &[8; 32]);
    p.starting_stacks = vec![&env, i128::MAX, 1];
    assert_eq!(
        client.try_initialize(&p.table_id, &p.participants, &p.starting_stacks),
        Err(Ok(Error::Amount))
    );
}

#[test]
fn deterministic_xdr_roundtrip_binds_all_fields() {
    use soroban_sdk::xdr::{FromXdr, ToXdr};
    let (env, _, p) = fixture();
    let bytes = p.clone().to_xdr(&env);
    assert_eq!(Settlement::from_xdr(&env, &bytes).unwrap(), p);
    let mut changed = p.clone();
    changed.fairness_digest = BytesN::from_array(&env, &[99; 32]);
    assert_ne!(bytes, changed.to_xdr(&env));
    assert_eq!(bytes, p.to_xdr(&env));
}

#[test]
fn nine_players_and_generated_conservation_sequences() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register(TableState, ());
    let client = TableStateClient::new(&env, &id);
    let mut players = soroban_sdk::Vec::new(&env);
    let mut stacks = soroban_sdk::Vec::new(&env);
    for seat in 0..9 {
        players.push_back(Participant {
            seat,
            player: Address::generate(&env),
        });
        stacks.push_back(100_i128);
    }
    let table = BytesN::from_array(&env, &[1; 32]);
    client.initialize(&table, &players, &stacks);
    for version in 0_u64..32 {
        let mut finals = stacks.clone();
        let from = (version % 9) as u32;
        let to = ((version + 1) % 9) as u32;
        finals.set(from, finals.get(from).unwrap() - 1);
        finals.set(to, finals.get(to).unwrap() + 1);
        client.commit(&Settlement {
            protocol_version: 1,
            table_id: table.clone(),
            hand_id: BytesN::from_array(&env, &[version as u8; 32]),
            previous_state_version: version,
            next_state_version: version + 1,
            participants: players.clone(),
            starting_stacks: stacks,
            final_stacks: finals.clone(),
            rake: 0,
            action_transcript_digest: BytesN::from_array(&env, &[3; 32]),
            fairness_digest: BytesN::from_array(&env, &[4; 32]),
        });
        stacks = finals;
        let state = client.state(&table);
        assert_eq!(state.stacks.iter().sum::<i128>(), 900);
        assert_eq!(state.version, version + 1);
    }
}

#[test]
fn rejects_unauthorized_initialization_without_creating_table() {
    let (env, id, p) = fixture();
    env.set_auths(&[]);
    let client = TableStateClient::new(&env, &id);
    let table = BytesN::from_array(&env, &[7; 32]);
    assert!(client
        .try_initialize(&table, &p.participants, &p.starting_stacks)
        .is_err());
    assert_eq!(client.try_state(&table), Err(Ok(Error::UnknownTable)));
}

#[test]
fn rejects_invalid_initial_participants_and_amounts() {
    let (env, id, p) = fixture();
    let client = TableStateClient::new(&env, &id);
    let table = BytesN::from_array(&env, &[7; 32]);
    let mut players = p.participants.clone();
    players.pop_back();
    assert_eq!(
        client.try_initialize(&table, &players, &vec![&env, 100_i128]),
        Err(Ok(Error::Participants))
    );
    players = p.participants.clone();
    let first = players.pop_front().unwrap();
    players.push_back(first);
    assert_eq!(
        client.try_initialize(&table, &players, &p.starting_stacks),
        Err(Ok(Error::Participants))
    );
    players = p.participants.clone();
    let mut last = players.get(1).unwrap();
    last.seat = 9;
    players.set(1, last);
    assert_eq!(
        client.try_initialize(&table, &players, &p.starting_stacks),
        Err(Ok(Error::Participants))
    );
    assert_eq!(
        client.try_initialize(&table, &p.participants, &vec![&env, -1_i128, 201]),
        Err(Ok(Error::Amount))
    );
    assert_eq!(client.try_state(&table), Err(Ok(Error::UnknownTable)));
}

#[test]
fn version_overflow_fails_without_mutation() {
    let (env, id, mut p) = fixture();
    env.as_contract(&id, || {
        let key = Key::Table(p.table_id.clone());
        let mut state: CommittedState = env.storage().persistent().get(&key).unwrap();
        state.version = u64::MAX;
        env.storage().persistent().set(&key, &state);
    });
    p.previous_state_version = u64::MAX;
    p.next_state_version = 0;
    rejected(&env, &id, &p, Error::Version);
}

#[test]
fn event_commits_full_payload_hash_and_failed_calls_emit_nothing() {
    use soroban_sdk::{testutils::Events, xdr::ToXdr, Event};
    let (env, id, p) = fixture();
    let client = TableStateClient::new(&env, &id);
    let expected = StateCommitted {
        table_id: p.table_id.clone(),
        version: 1,
        settlement_digest: env.crypto().sha256(&p.clone().to_xdr(&env)).to_bytes(),
    };
    client.commit(&p);
    assert_eq!(
        env.events().all(),
        vec![
            &env,
            (id.clone(), expected.topics(&env), expected.data(&env))
        ]
    );
    assert!(client.try_commit(&p).is_err());
    assert_eq!(env.events().all(), vec![&env]);
}

#[test]
fn replay_markers_and_state_are_persistent() {
    use soroban_sdk::testutils::storage::Persistent;
    let (env, id, p) = fixture();
    TableStateClient::new(&env, &id).commit(&p);
    env.as_contract(&id, || {
        assert!(
            env.storage()
                .persistent()
                .get_ttl(&Key::Hand(p.hand_id.clone()))
                > 0
        );
        assert!(
            env.storage()
                .persistent()
                .get_ttl(&Key::Table(p.table_id.clone()))
                > 0
        );
        assert!(!env.storage().temporary().has(&Key::Hand(p.hand_id.clone())));
    });
}

#[test]
fn authorizations_for_original_payload_cannot_authorize_tampering() {
    use soroban_sdk::{
        testutils::{MockAuth, MockAuthInvoke},
        IntoVal,
    };
    let (env, id, p) = fixture();
    env.set_auths(&[]);
    let first = p.participants.get(0).unwrap().player;
    let second = p.participants.get(1).unwrap().player;
    let invocation = MockAuthInvoke {
        contract: &id,
        fn_name: "commit",
        args: (p.clone(),).into_val(&env),
        sub_invokes: &[],
    };
    env.mock_auths(&[
        MockAuth {
            address: &first,
            invoke: &invocation,
        },
        MockAuth {
            address: &second,
            invoke: &invocation,
        },
    ]);
    let client = TableStateClient::new(&env, &id);
    let mut changed = p.clone();
    changed.fairness_digest = BytesN::from_array(&env, &[99; 32]);
    assert!(client.try_commit(&changed).is_err());
    assert_eq!(client.state(&p.table_id).version, 0);
}
