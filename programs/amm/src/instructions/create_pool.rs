use crate::error::ErrorCode;
use crate::states::*;
use crate::util::create_token_vault_account;
use crate::{libraries::tick_math};
use anchor_lang::{prelude::*, solana_program};
use anchor_spl::token_interface::{Mint, TokenInterface};

#[derive(Accounts)]
pub struct CreatePool<'info> {
    #[account(mut)]
    pub pool_creator: Signer<'info>,

    pub amm_config: Box<Account<'info, AmmConfig>>,

    #[account(
        init,
        seeds = [
            POOL_SEED.as_bytes(),
            amm_config.key().as_ref(),
            token_mint_0.key().as_ref(),
            token_mint_1.key().as_ref(),
        ],
        bump,
        payer = pool_creator,
        space = PoolState::LEN
    )]
    pub pool_state: AccountLoader<'info, PoolState>,

    #[account(
        constraint = token_mint_0.key() < token_mint_1.key(),
        mint::token_program = token_program_0
    )]
    pub token_mint_0: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        mint::token_program = token_program_1
    )]
    pub token_mint_1: Box<InterfaceAccount<'info, Mint>>,

    /// CHECK: Token_0 vault for the pool.
    /// This account is created and initialized inside the program with deterministic seeds.
    /// Therefore, no further validation is required here.
    #[account(
        mut,
        seeds =[
            POOL_VAULT_SEED.as_bytes(),
            pool_state.key().as_ref(),
            token_mint_0.key().as_ref(),
        ],
        bump,
    )]
    pub token_vault_0: UncheckedAccount<'info>,

    /// CHECK: Token_1 vault for the pool.
    /// This account is created and initialized inside the program with deterministic seeds.
    /// Therefore, no further validation is required here.
    #[account(
        mut,
        seeds =[
            POOL_VAULT_SEED.as_bytes(),
            pool_state.key().as_ref(),
            token_mint_1.key().as_ref(),
        ],
        bump,
    )]
    pub token_vault_1: UncheckedAccount<'info>,

    #[account(
        init,
        seeds = [
            OBSERVATION_SEED.as_bytes(),
            pool_state.key().as_ref(),
        ],
        bump,
        payer = pool_creator,
        space = ObservationState::LEN
    )]
    pub observation_state: AccountLoader<'info, ObservationState>,

    #[account(
        init,
        seeds = [
            POOL_TICK_ARRAY_BITMAP_SEED.as_bytes(),
            pool_state.key().as_ref(),
        ],
        bump,
        payer = pool_creator,
        space = TickArrayBitmapExtension::LEN
    )]
    pub tick_array_bitmap: AccountLoader<'info, TickArrayBitmapExtension>,

    pub token_program_0: Interface<'info, TokenInterface>,
    pub token_program_1: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

pub fn create_pool(ctx: Context<CreatePool>, sqrt_price_x64: u128, open_time: u64) -> Result<()> {
    let block_timestamp = solana_program::clock::Clock::get()?.unix_timestamp as u64;
    require_gt!(block_timestamp, open_time);

    let pool_id = ctx.accounts.pool_state.key();
    let mut pool_state = ctx.accounts.pool_state.load_init()?;

    let tick = tick_math::get_tick_at_sqrt_price(sqrt_price_x64)?;

    create_token_vault_account(
        &ctx.accounts.pool_creator,
        &ctx.accounts.pool_state.to_account_info(),
        &ctx.accounts.token_vault_0,
        &ctx.accounts.token_mint_0,
        &ctx.accounts.system_program,
        &ctx.accounts.token_program_0,
        &[
            POOL_VAULT_SEED.as_bytes(),
            ctx.accounts.pool_state.key().as_ref(),
            ctx.accounts.token_mint_0.key().as_ref(),
            &[ctx.bumps.token_vault_0][..],
        ],
    )?;

    create_token_vault_account(
        &ctx.accounts.pool_creator,
        &ctx.accounts.pool_state.to_account_info(),
        &ctx.accounts.token_vault_1,
        &ctx.accounts.token_mint_1,
        &ctx.accounts.system_program,
        &ctx.accounts.token_program_1,
        &[
            POOL_VAULT_SEED.as_bytes(),
            ctx.accounts.pool_state.key().as_ref(),
            ctx.accounts.token_mint_1.key().as_ref(),
            &[ctx.bumps.token_vault_1][..],
        ],
    )?;

    ctx.accounts.observation_state.load_init()?.initialize(pool_id)?;

    let bump = ctx.bumps.pool_state;
    pool_state.initialize(
        bump,
        sqrt_price_x64,
        0,
        tick,
        ctx.accounts.pool_creator.key(),
        ctx.accounts.token_vault_0.key(),
        ctx.accounts.token_vault_1.key(),
        ctx.accounts.amm_config.as_ref(),
        ctx.accounts.token_mint_0.as_ref(),
        ctx.accounts.token_mint_1.as_ref(),
        ctx.accounts.observation_state.key(),
    )?;

    ctx.accounts.tick_array_bitmap.load_init()?.initialize(pool_id);

    emit!(PoolCreatedEvent {
        token_mint_0: ctx.accounts.token_mint_0.key(),
        token_mint_1: ctx.accounts.token_mint_1.key(),
        tick_spacing: ctx.accounts.amm_config.tick_spacing,
        pool_state: ctx.accounts.pool_state.key(),
        sqrt_price_x64,
        tick,
        token_vault_0: ctx.accounts.token_vault_0.key(),
        token_vault_1: ctx.accounts.token_vault_1.key(),
    });

    Ok(())
}