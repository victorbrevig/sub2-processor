import dotenv from 'dotenv';
import { createPublicClient, createWalletClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { baseSepolia } from 'viem/chains';

dotenv.config();
const { PRIVATE_KEY } = process.env;



 
// JSON-RPC Account
//export const account = '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266'
// Local Account
export const account = privateKeyToAccount(`0x${PRIVATE_KEY}`)
 
export const publicClient = createPublicClient({
  chain: baseSepolia,
  transport: http()
})

export const walletClient = createWalletClient({
  chain: baseSepolia,
  transport: http()
})