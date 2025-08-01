import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import {
    ExtensionType,
    TOKEN_2022_PROGRAM_ID,
    createInitializeMintInstruction,
    createInitializeTransferHookInstruction,
    getMintLen,
    getOrCreateAssociatedTokenAccount,
    mintTo,
    Account,
    MINT_SIZE,
    createApproveInstruction,
    getAssociatedTokenAddressSync,
    createTransferCheckedWithTransferHookInstruction,
} from "@solana/spl-token";
import { Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, SYSVAR_RENT_PUBKEY } from "@solana/web3.js";
import { assert } from "chai";
import { AmmV3 } from "../target/types/amm_v3";
import { TransferHook as TransferHookProgram } from "../target/types/transfer_hook";
import { admin } from "./admin";

describe("ammv3", () => {
    const provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);
    const ammv3Program = anchor.workspace.AmmV3 as Program<AmmV3>;
    const transferHookProgram = anchor.workspace.TransferHook as Program<TransferHookProgram>;
    const payer = provider.wallet;
    const liqudityProvider = Keypair.generate();
    let usdcMint = Keypair.generate();
    let cetusMint = Keypair.generate();
    if (usdcMint.publicKey.toBuffer().compare(cetusMint.publicKey.toBuffer()) < 0) {
        [usdcMint, cetusMint] = [cetusMint, usdcMint];
    }
    console.log("Token 0:", usdcMint.publicKey.toBase58());
    console.log("Token 1:", cetusMint.publicKey.toBase58());
    const from = Keypair.generate();
    const to = Keypair.generate();
    let usdcAtaOfLiquidityProvider: Account;
    let cetusAtaOfLiquidityProvider: Account;
    console.log(`AmmV3 Program ID: ${ammv3Program.programId.toBase58()}`);
    console.log(`Transfer Hook Program ID: ${transferHookProgram.programId.toBase58()}`);
    console.log(`Payer: ${payer.publicKey.toBase58()}`);
    console.log(`Liquidity Provider: ${liqudityProvider.publicKey.toBase58()}`);
    console.log(`USDC Mint: ${usdcMint.publicKey.toBase58()}`);
    console.log(`Cetus Mint: ${cetusMint.publicKey.toBase58()}`);
    console.log(`From: ${from.publicKey.toBase58()}`);
    console.log(`To: ${to.publicKey.toBase58()}`);
    console.log(`Admin: ${admin.publicKey.toBase58()}`);

    let ammConfigPda: PublicKey;
    let poolStatePda: PublicKey;
    let tokenVault0Pda: PublicKey;
    let tokenVault1Pda: PublicKey;
    let observationStatePda: PublicKey;
    let tickArrayBitmapPda: PublicKey;
    let tickSpacing: number;
    let extensionLamports: number;
    let mintLamports: number;
    let tickArrayLowerPda: PublicKey;
    let tickArrayUpperPda: PublicKey;
    let cetusAtaOfTo: Account;
    let counterAccountPda: PublicKey;
    let extraAccountMetaListPda: PublicKey;
    before(async () => {
        // create mint
        const extensions = [ExtensionType.TransferHook];
        const mintLen = getMintLen(extensions);
        extensionLamports =
            await provider.connection.getMinimumBalanceForRentExemption(mintLen);
        mintLamports = 
            await provider.connection.getMinimumBalanceForRentExemption(MINT_SIZE);
        const transaction = new anchor.web3.Transaction().add(
            anchor.web3.SystemProgram.createAccount({
                fromPubkey: payer.publicKey,
                newAccountPubkey: cetusMint.publicKey,
                space: mintLen,
                lamports: extensionLamports,
                programId: TOKEN_2022_PROGRAM_ID,
            }),
            anchor.web3.SystemProgram.createAccount({
                fromPubkey: payer.publicKey,
                newAccountPubkey: usdcMint.publicKey,
                space: MINT_SIZE,
                lamports: mintLamports,
                programId: TOKEN_2022_PROGRAM_ID,
            }),
            createInitializeTransferHookInstruction(
                cetusMint.publicKey,
                admin.publicKey,
                transferHookProgram.programId,
                TOKEN_2022_PROGRAM_ID
            ),
            createInitializeMintInstruction(
                cetusMint.publicKey,
                8,
                admin.publicKey,
                null,
                TOKEN_2022_PROGRAM_ID
            ),
            createInitializeMintInstruction(
                usdcMint.publicKey,
                6,
                admin.publicKey,
                null,
                TOKEN_2022_PROGRAM_ID
            )
        );
        await provider.sendAndConfirm(
            transaction,
            [cetusMint, payer.payer, usdcMint],
        );

        // init transfer hook program
        transferHookProgram.methods
            .initializeExtraAccountMetaList()
            .accounts({
                mint: cetusMint.publicKey,
                tokenProgram: TOKEN_2022_PROGRAM_ID,
                payer: payer.publicKey,
            })
            .signers([payer.payer])
            .rpc();
        [extraAccountMetaListPda] = PublicKey.findProgramAddressSync(
            [Buffer.from("extra-account-metas"), cetusMint.publicKey.toBuffer()],
            transferHookProgram.programId
        );
        // get the extra account metas for the transfer hook
        // create source ATA for liquidity provider
        usdcAtaOfLiquidityProvider = await getOrCreateAssociatedTokenAccount(
            provider.connection,
            payer.payer,
            usdcMint.publicKey,
            liqudityProvider.publicKey,
            false,
            undefined,
            undefined,
            TOKEN_2022_PROGRAM_ID
        );
        cetusAtaOfLiquidityProvider = await getOrCreateAssociatedTokenAccount(
            provider.connection,
            payer.payer,
            cetusMint.publicKey,
            liqudityProvider.publicKey,
            false,
            undefined,
            undefined,
            TOKEN_2022_PROGRAM_ID
        );
    });

    it("Setup tokens for liquidity provider", async () => {
        // mint 100 tokens each to liquidity provider
        await mintTo(
            provider.connection,
            payer.payer,
            cetusMint.publicKey,
            cetusAtaOfLiquidityProvider.address,
            admin.publicKey,
            BigInt(11_000_000_000), // 100 tokens with 8 decimals
            [
                admin
            ],
            undefined,
            TOKEN_2022_PROGRAM_ID
        );
        // demo transfer hook to ensure it works
        cetusAtaOfTo = await getOrCreateAssociatedTokenAccount(
            provider.connection,
            payer.payer,
            cetusMint.publicKey,    
            to.publicKey,
            false,
            undefined,
            undefined,
            TOKEN_2022_PROGRAM_ID
        );
        const transferCheckedDemoInstruction = await createTransferCheckedWithTransferHookInstruction(
            provider.connection,
            cetusAtaOfLiquidityProvider.address,
            cetusMint.publicKey,    
            cetusAtaOfTo.address,
            liqudityProvider.publicKey,  
            BigInt(1_000_000_000), // 10 tokens with 8
            8,
            [],
            undefined,
            TOKEN_2022_PROGRAM_ID,
        );
        // transferCheckedDemoInstruction.keys.push(
        //     {
        //         pubkey: transferHookProgram.programId,
        //         isSigner: false,
        //         isWritable: true,
        //     }
        // );
        const transferCheckedDemoTx = await provider.sendAndConfirm(
            new anchor.web3.Transaction().add(transferCheckedDemoInstruction),
            [payer.payer, liqudityProvider],
            {
                commitment: "confirmed",
            }
        );
        console.log(`Transfer Checked Demo Transaction signature: ${transferCheckedDemoTx}`);
        [counterAccountPda] = PublicKey.findProgramAddressSync(
            [Buffer.from("counter")],
            transferHookProgram.programId
        );
        const counterAccount = await transferHookProgram.account.counterAccount.fetch(
            counterAccountPda
        );
        assert.equal(counterAccount.counter, 1, "Counter should be 1 after demo transfer");
        // assert counter
        console.log(`Counter Account PDA: ${counterAccountPda.toBase58()}`);
        console.log(`Cetus ATA of Liquidity Provider: ${cetusAtaOfLiquidityProvider.address.toBase58()}`);
        console.log(`Cetus ATA of To: ${cetusAtaOfTo.address.toBase58()}`);
        console.log(`Transfer Hook Program ID: ${transferHookProgram.programId.toBase58()}`);
        console.log(`Account meta list PDA: ${extraAccountMetaListPda.toBase58()}`);
        console.log(transferCheckedDemoInstruction.keys)
        await mintTo(
            provider.connection,
            payer.payer,
            usdcMint.publicKey,
            usdcAtaOfLiquidityProvider.address,
            admin.publicKey,
            BigInt(100_000_000), // 100 tokens with 6 decimals
            [
                admin
            ],
            undefined,
            TOKEN_2022_PROGRAM_ID
        );
        // check if the liquidity provider has the correct amount of tokens
        const usdcBalance = await provider.connection.getTokenAccountBalance(
            usdcAtaOfLiquidityProvider.address
        );
        const cetusBalance = await provider.connection.getTokenAccountBalance(
            cetusAtaOfLiquidityProvider.address
        );
        assert.equal(usdcBalance.value.uiAmount, 100);
        assert.equal(cetusBalance.value.uiAmount, 100);
    });
    it("Initialize AMM V3", async () => {
        // faucet admin account
        const requestAirdropSig = await provider.connection.requestAirdrop(
            admin.publicKey,
            2 * LAMPORTS_PER_SOL
        );
        await provider.connection.confirmTransaction(requestAirdropSig, "confirmed")
        // assert that admin has enough SOL
        const adminBalance = await provider.connection.getBalance(admin.publicKey);
        assert.isAtLeast(adminBalance, 2 * LAMPORTS_PER_SOL, "Admin account should have at least 2 SOL");
        // define AMM config parameters
        const index = 1;            // config id
        tickSpacing = 50;      // tick spacing
        const tradeFeeRate = 2500;  // 0.25%
        const protocolFeeRate = 800; // 0.08%
        const fundFeeRate = 0;      // no fund fee
        // create AMM config
        [ammConfigPda] = PublicKey.findProgramAddressSync(
            [
                Buffer.from("amm_config"),
                Buffer.from(new anchor.BN(index).toArray("be", 2))],
            ammv3Program.programId
        );
        const createAmmConfigTx = await ammv3Program.methods.createAmmConfig(
            index,
            tickSpacing,
            tradeFeeRate,
            protocolFeeRate,
            fundFeeRate
        ).accounts({
            ammConfig: ammConfigPda,
            owner: admin.publicKey,
        })
            .signers([admin])
            .rpc();
        // assert that the AMM config was created successfully
        console.log(`Create AMM Config Transaction signature: ${createAmmConfigTx}`);
        const ammConfig = await ammv3Program.account.ammConfig.fetch(ammConfigPda);
        assert.equal(ammConfig.index, index);
        assert.equal(ammConfig.tickSpacing, tickSpacing);
        assert.equal(ammConfig.tradeFeeRate, tradeFeeRate);
        assert.equal(ammConfig.protocolFeeRate, protocolFeeRate);
        assert.equal(ammConfig.fundFeeRate, fundFeeRate);
        [poolStatePda] = PublicKey.findProgramAddressSync(
            [
                Buffer.from("pool"),
                ammConfigPda.toBuffer(),
                cetusMint.publicKey.toBuffer(),
                usdcMint.publicKey.toBuffer(),
            ],
            ammv3Program.programId
        );
        [tokenVault0Pda] = PublicKey.findProgramAddressSync(
            [Buffer.from("pool_vault"), poolStatePda.toBuffer(), cetusMint.publicKey.toBuffer()],
            ammv3Program.programId
        );
        [tokenVault1Pda] = PublicKey.findProgramAddressSync(
            [Buffer.from("pool_vault"), poolStatePda.toBuffer(), usdcMint.publicKey.toBuffer()],
            ammv3Program.programId
        );
        [observationStatePda] = PublicKey.findProgramAddressSync(
            [Buffer.from("observation"), poolStatePda.toBuffer()],
            ammv3Program.programId
        );
        [tickArrayBitmapPda] = PublicKey.findProgramAddressSync(
            [Buffer.from("tick_array_bitmap"), poolStatePda.toBuffer()],
            ammv3Program.programId
        );
        const sqrtPriceX64 = new anchor.BN(1).shln(64); // init price = 1.0
        const openTime = new anchor.BN(0); // mở ngay

        // faucet liquidity provider account
        const requestAirdropToLiquidityProviderSig = await provider.connection.requestAirdrop(
            liqudityProvider.publicKey,
            2 * LAMPORTS_PER_SOL
        );
        await provider.connection.confirmTransaction(requestAirdropToLiquidityProviderSig, "confirmed")
        // assert that liquidity provider has enough SOL
        const liquidityProviderBalance = await provider.connection.getBalance(liqudityProvider.publicKey);
        assert.isAtLeast(liquidityProviderBalance, 2 * LAMPORTS_PER_SOL, "Liquidity provider account should have at least 2 SOL");

        const createPoolTx = await ammv3Program.methods
            .createPool(sqrtPriceX64, openTime)
            .accounts({
                poolCreator: liqudityProvider.publicKey,
                ammConfig: ammConfigPda,
                tokenMint0: cetusMint.publicKey,
                tokenMint1: usdcMint.publicKey,
                tokenProgram0: TOKEN_2022_PROGRAM_ID,
                tokenProgram1: TOKEN_2022_PROGRAM_ID,
            })
            .signers([payer.payer, liqudityProvider])
            .rpc();
        // assert that the pool was created successfully
        console.log(`Create Pool Transaction signature: ${createPoolTx}`);
        const poolState = await ammv3Program.account.poolState.fetch(poolStatePda);
        assert.equal(poolState.tokenMint0.toBase58(), cetusMint.publicKey.toBase58());
        assert.equal(poolState.tokenMint1.toBase58(), usdcMint.publicKey.toBase58());
        assert.equal(poolState.tokenVault0.toBase58(), tokenVault0Pda.toBase58());
        assert.equal(poolState.tokenVault1.toBase58(), tokenVault1Pda.toBase58());
        assert.equal(poolState.sqrtPriceX64.toString(), sqrtPriceX64.toString());
        assert.equal(poolState.openTime.toString(), openTime.toString());
        assert.equal(poolState.ammConfig.toBase58(), ammConfigPda.toBase58());
        console.log(`Transaction signature: ${createPoolTx}`);
    });
    it("Add liquidity to the pool", async () => {
        // Define liquidity parameters
        const TICK_ARRAY_SIZE = 60;
        const ticksPerArray = tickSpacing * TICK_ARRAY_SIZE; // 3000
        const tickLowerIndex = -1000;  // Lower tick bound
        const tickUpperIndex = 1000;   // Upper tick bound
        const tickArrayLowerStartIndex = Math.floor(tickLowerIndex / ticksPerArray) * ticksPerArray;
        const tickArrayUpperStartIndex = Math.floor(tickUpperIndex / ticksPerArray) * ticksPerArray;
        const liquidity = new anchor.BN("100000000"); // Amount of liquidity to add
        const amountCetusMax = new anchor.BN("10000000000"); // Max amount of token0 (Cetus) to deposit
        const amountUsdcMax = new anchor.BN("100000000"); // Max amount of token1 (USDC) to deposit
        [tickArrayLowerPda] = PublicKey.findProgramAddressSync(
            [
                Buffer.from("tick_array"),
                poolStatePda.toBuffer(),
                new anchor.BN(tickArrayLowerStartIndex).toTwos(32).toArrayLike(Buffer, "be", 4),
            ],
            ammv3Program.programId
        );
        [tickArrayUpperPda] = PublicKey.findProgramAddressSync(
            [
                Buffer.from("tick_array"),
                poolStatePda.toBuffer(),
                new anchor.BN(tickArrayUpperStartIndex).toTwos(32).toArrayLike(Buffer, "be", 4),
            ],
            ammv3Program.programId
        );
        console.log(new anchor.BN(tickArrayUpperStartIndex).toArrayLike(Buffer, "be", 4))
        // Approve token transfers
        const approveTx = new anchor.web3.Transaction().add(
            // Approve token0 transfer
            createApproveInstruction(
                cetusAtaOfLiquidityProvider.address,
                tokenVault0Pda,
                liqudityProvider.publicKey,
                amountCetusMax.toNumber(),
                [],
                TOKEN_2022_PROGRAM_ID
            ),
            // Approve token1 transfer
            createApproveInstruction(
                usdcAtaOfLiquidityProvider.address,
                tokenVault1Pda,
                liqudityProvider.publicKey,
                amountUsdcMax.toNumber(),
                [],
                TOKEN_2022_PROGRAM_ID
            )
        );
        await provider.sendAndConfirm(approveTx, [payer.payer, liqudityProvider]);
        const positionNftMint = Keypair.generate();
        const positionNftAccount = getAssociatedTokenAddressSync(
            positionNftMint.publicKey,
            liqudityProvider.publicKey,
            false,
            TOKEN_2022_PROGRAM_ID
        );

        console.log(`Position NFT Mint: ${positionNftMint.publicKey.toBase58()}`);
        const openPositionTx = await ammv3Program.methods
            .openPositionWithToken22Nft(
                tickLowerIndex,
                tickUpperIndex,
                tickArrayLowerStartIndex,
                tickArrayUpperStartIndex,
                liquidity,
                amountCetusMax,
                amountUsdcMax,
                true,
                true,
                3,
                0
            )   
            .accounts({
                poolState: poolStatePda,
                vault0Mint: cetusMint.publicKey,
                vault1Mint: usdcMint.publicKey,
                tokenVault0: tokenVault0Pda,
                tokenVault1: tokenVault1Pda,
                payer: liqudityProvider.publicKey,
                tokenAccount0: cetusAtaOfLiquidityProvider.address,
                tokenAccount1: usdcAtaOfLiquidityProvider.address,
                positionNftMint: positionNftMint.publicKey,
                positionNftOwner: liqudityProvider.publicKey,
                positionNftAccount,
                protocolPosition: Keypair.generate().publicKey, // dummy keypair for protocol position
                tickArrayLower: tickArrayLowerPda,
                tickArrayUpper: tickArrayUpperPda,
            })
            .signers([liqudityProvider, positionNftMint])
            .remainingAccounts([
                {
                    pubkey: counterAccountPda,
                    isSigner: false,
                    isWritable: true, // This should be writable to allow the transfer hook to modify the account
                },
                {
                    pubkey: transferHookProgram.programId,
                    isSigner: false,
                    isWritable: true, // This should be writable to allow the transfer hook to modify the
                },
                {
                    pubkey: extraAccountMetaListPda,
                    isSigner: false,
                    isWritable: true, // This should be writable to allow the transfer hook to modify the account
                },
            ])
            .rpc();
        console.log(`Open Position Transaction signature: ${openPositionTx}`);
        // get the logs
        // const openPositionTransaction = await provider.connection.getTransaction(openPositionTx, { commitment: "confirmed" });
        // console.log("Transaction logs:", openPositionTransaction?.meta?.logMessages);
        // check the counter account
        const counterAccount = await transferHookProgram.account.counterAccount.fetch(counterAccountPda);
        assert.equal(counterAccount.counter, 2, "Counter should be 2 after opening position");

        // console.log(`Open Position Transaction signature: ${openPositionTx}`);

        // // Verify the position was created
        // const position = await ammv3Program.account.position.fetch(positionPda);
        // assert.equal(position.liquidity.toString(), liquidity.toString());
        // assert.equal(position.tickLowerIndex, tickLowerIndex);
        // assert.equal(position.tickUpperIndex, tickUpperIndex);

        // Verify token balances in vaults increased
        const vault0Balance = await provider.connection.getTokenAccountBalance(tokenVault0Pda);
        const vault1Balance = await provider.connection.getTokenAccountBalance(tokenVault1Pda);
        console.log(`Vault 0 Balance: ${vault0Balance.value.amount}`);
        console.log(`Vault 1 Balance: ${vault1Balance.value.amount}`);
        assert.isAbove(Number(vault0Balance.value.amount), 0);
        assert.isAbove(Number(vault1Balance.value.amount), 0);

        // // Verify liquidity provider received the position NFT
        // const nftBalance = await provider.connection.getTokenAccountBalance(positionNftAta.address);
        // assert.equal(nftBalance.value.amount, "1");
    });
    it("Process swap", async () => {
        // Define swap parameters
        const amountIn = new anchor.BN("1000000"); // 1 USDC (6 decimals)
        const amountOutMin = new anchor.BN("1000000"); // 1 CETUS (8 decimals)
        const sqrtPriceLimitX64 = new anchor.BN(0); // No price limit
        const baseFlag = true; // Swap base token (Cetus)
        const withMetadata = true; // Include metadata in the swap
        // const swapTx = await ammv3Program.methods
        //     .swapV2(
        //         amountIn,
        //         amountOutMin,
        //         sqrtPriceLimitX64,
        //         baseFlag,
        //         withMetadata
        //     )
        //     .accounts({
        //         poolState: poolStatePda,
        //         vault0Mint: cetusMint.publicKey,
        //         vault1Mint: usdcMint.publicKey,
        //         tokenVault0: tokenVault0Pda,
        //         tokenVault1: tokenVault1Pda,
        //         payer: liqudityProvider.publicKey,
        //         tokenAccount0: cetusAtaOfLiquidityProvider.address,
        //         tokenAccount1: usdcAtaOfLiquidityProvider.address,
        //     })
        //     .signers([liqudityProvider])
        //     .remainingAccounts([
        //         {
        //             pubkey: counterAccountPda,
        //             isSigner: false,
        //             isWritable: true, // This should be writable to allow the transfer hook to modify the account
        //         },
        //         {
        //             pubkey: transferHookProgram.programId,
        //             isSigner: false,
        //             isWritable: true, // This should be writable to allow the transfer hook to modify the account
        //         },
        //         {
        //             pubkey: extraAccountMetaListPda,
        //             isSigner: false,
        //             isWritable: true, // This should be writable to allow the transfer hook to modify the account
        //         },
        //     ])
        //     .rpc();
        // console.log(`Swap Transaction signature: ${swapTx}`);
        // // check the counter account
        // const counterAccount = await transferHookProgram.account.counterAccount.fetch(counterAccountPda);
        // assert.equal(counterAccount.counter, 3, "Counter should be 3 after swap");
    });
});