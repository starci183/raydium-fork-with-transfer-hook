import { Keypair } from "@solana/web3.js";
import base58 from "bs58";
export const admin = Keypair.fromSecretKey(
    base58.decode(  // Replace with the actual secret key
        "3KLasSiRUVBv2RySVtP1hsQLVTx2Z2NBmYsRPuT5MJDeF4qbnoge46UT7YwgZNotoEkZtrrGGY5FTtU5VWNzZKXB"
    )
)