use crate::{Error, Participant};
use soroban_sdk::Vec;

pub(crate) fn participants(players: &Vec<Participant>) -> Result<(), Error> {
    if !(2..=9).contains(&players.len()) {
        return Err(Error::Participants);
    }
    for (i, player) in players.iter().enumerate() {
        if player.seat > 8 {
            return Err(Error::Participants);
        }
        for earlier in players.iter().take(i) {
            if earlier.seat >= player.seat || earlier.player == player.player {
                return Err(Error::Participants);
            }
        }
    }
    Ok(())
}

pub(crate) fn total(stacks: &Vec<i128>, count: u32) -> Result<i128, Error> {
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
