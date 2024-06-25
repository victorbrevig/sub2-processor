import { TransactionReceipt } from 'viem';


export interface Subscription {
  sender: `0x${string}`;
  recipient: `0x${string}`;
  amount: bigint;
  token: `0x${string}`;
  maxProcessingFee: bigint;
  processingFeeToken: `0x${string}`;
  lastPayment: number;
  sponsor: `0x${string}`;
  cooldown: number;
  auctionDuration: number;
  paymentCounter: number;
}

export interface IndexedSubscription {
  index: bigint,
  subscription: Subscription;
}

export interface ProcessingReceipt {
  subscriptionIndex: bigint;
  processingFee: bigint;
  processingFeeToken: `0x${string}`;
}

export interface BatchProcessingReceipt {
  transactionReceipt: TransactionReceipt;
  processingReceipts: readonly ProcessingReceipt[];
}

export interface GasPriceConfig {
  maxFeePerGas: bigint, 
  maxPriorityFeePerGas: bigint 
}