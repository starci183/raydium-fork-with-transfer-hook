use anchor_lang::prelude::*;
#[account]
pub struct HooksAccount {
    /// authority of the hook
    pub authority: Pubkey,
    /// hook programs
    pub safe_hook_programs: Vec<Pubkey>,
    /// unsafe hook programs
    pub unsafe_hook_programs: Vec<Pubkey>,
    /// pending hook programs
    pub pending_hook_programs: Vec<Pubkey>,
}
