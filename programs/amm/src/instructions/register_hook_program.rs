use crate::{error::ErrorCode, states::HooksAccount};
use anchor_lang::prelude::*;

const MAX_ITEMS: usize = 20;

#[derive(Accounts)]
pub struct RegisterHookProgramCtx<'info> {
    #[account(
        mut,
        seeds = [b"hooks"],
        bump
    )]
    pub hook_accounts: Account<'info, HooksAccount>,
}

pub fn register_hook_program(
    ctx: Context<RegisterHookProgramCtx>,
    program_id: Pubkey,
) -> Result<()> {
    let acc = &mut ctx.accounts.hook_accounts;
    // check authority
    require!(
        !acc.safe_hook_programs.contains(&program_id)
            && !acc.unsafe_hook_programs.contains(&program_id)
            && !acc.pending_hook_programs.contains(&program_id),
        ErrorCode::HookAlreadyExists
    );

    // check max items
    require!(
        acc.pending_hook_programs.len() < MAX_ITEMS,
        ErrorCode::TooManyHooks
    );

    // add program id to pending hook programs
    acc.pending_hook_programs.push(program_id);

    Ok(())
}