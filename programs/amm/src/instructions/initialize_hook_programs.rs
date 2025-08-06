use crate::error::ErrorCode;
use anchor_lang::prelude::*;
use crate::{admin, states::{HooksAccount, PoolState}};
pub const MAX_ITEMS: usize = 20;
 pub const LEN: usize = 8   // discriminator
        + 32                  // authority
        + 4 + 32 * MAX_ITEMS  // safe_hook_programs
        + 4 + 32 * MAX_ITEMS  // unsafe_hook_programs
        + 4 + 32 * MAX_ITEMS; // pending_hook_programs

#[derive(Accounts)]
pub struct InitializeHookProgramsCtx<'info> {
    #[account(mut)]
    admin: Signer<'info>,
    #[account(
        init,
        payer = admin,
        seeds =[
            b"hooks"
        ],
        space = LEN,
        bump,
    )]
    pub hook_accounts: Account<'info, HooksAccount>,
    pub system_program: Program<'info, System>,
}

pub fn initialize_hook_programs(
    ctx: Context<InitializeHookProgramsCtx>,
) -> Result<()> {
    require_eq!(
        ctx.accounts.admin.key(),
        admin::ID,
        ErrorCode::UnauthorizedAdmin
    );
    let hooks_account = &mut ctx.accounts.hook_accounts;
    hooks_account.authority = ctx.accounts.admin.key();
    hooks_account.safe_hook_programs = vec![];
    hooks_account.unsafe_hook_programs = vec![];
    hooks_account.pending_hook_programs = vec![];
    Ok(())
}