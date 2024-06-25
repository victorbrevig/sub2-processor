import { publicClient, walletClient, account } from './config';
import { BATCH_PROCESSOR_ABI } from './ABIs/BATCH_PROCESSOR_ABI';
import { BATCH_PROCESSOR_ADDRESS, PROCESSOR_ADDRESS } from './constants';
import { IndexedSubscription, BatchProcessingReceipt } from './interfaces';
import { TransactionReceipt } from 'viem';


export class Processor {

  chainId: number;

  constructor(chainId : number) {
    this.chainId = chainId;
  }

  async processBatch(subscriptionIndices: bigint[]) : Promise<BatchProcessingReceipt> {
    console.log("PROCESSING INDICES", subscriptionIndices);
    console.log("Processing batch of size " + subscriptionIndices.length);

    const { result, request } = await publicClient.simulateContract({
      address: BATCH_PROCESSOR_ADDRESS,
      abi: BATCH_PROCESSOR_ABI,
      functionName: 'processBatch',
      args: [subscriptionIndices, PROCESSOR_ADDRESS],
      gas: 120000n * BigInt(subscriptionIndices.length) + 100000n,
      account
    })
    const txHash: `0x${string}` = await walletClient.writeContract(request);
    console.log("processing... hash:" , txHash);

    const transactionReceipt: TransactionReceipt = await publicClient.waitForTransactionReceipt( 
      { hash: txHash }
    )

    console.log("RESULT", result);

    const batchProcessingReceipt: BatchProcessingReceipt = {
      transactionReceipt: transactionReceipt,
      processingReceipts: result
    }

    return batchProcessingReceipt;
  }
}