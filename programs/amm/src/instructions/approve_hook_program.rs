use crate::{error::ErrorCode, states::HooksAccount};
use anchor_lang::prelude::*;

const MAX_ITEMS: usize = 20;

#[derive(Accounts)]
pub struct ApproveHookProgramCtx<'info> {
    #[account(
        mut,
        has_one = authority,          // ensure authority matches
        seeds = [b"hooks"],
        bump
    )]
    pub hook_accounts: Account<'info, HooksAccount>,
    pub authority: Signer<'info>,    // must be the authority of the hook accounts
}

pub fn approve_hook_program(
    ctx: Context<ApproveHookProgramCtx>,
    program_id: Pubkey,
) -> Result<()> {
    let acc = &mut ctx.accounts.hook_accounts;
    // find program_id in pending_hook_programs
    if let Some(pos) = acc.pending_hook_programs.iter().position(|h| *h == program_id) {
        // check max items
        require!(
            acc.safe_hook_programs.len() < MAX_ITEMS,
            ErrorCode::TooManyHooks
        );
        // remove from pending
        acc.pending_hook_programs.remove(pos);
        // add to safe hook programs
        acc.safe_hook_programs.push(program_id);

        Ok(())
    } else {
        err!(ErrorCode::HookNotFound)
    }
}