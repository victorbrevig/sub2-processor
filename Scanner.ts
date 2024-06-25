import { publicClient } from './config';
import { BATCH_PROCESSOR_ABI } from './ABIs/BATCH_PROCESSOR_ABI';
import { SUB2_ABI } from './ABIs/SUB2_ABI';
import { QUERIER_ADDRESS, SUB2_ADDRESS } from './constants';
import { Subscription, IndexedSubscription, BatchProcessingReceipt } from './interfaces';
import { TokenPrices } from './TokenPrices';
import { GasPriceConfig } from './interfaces';
import { formatEther, formatUnits } from 'viem';
import { Processor } from './Processor';
import { TokenDecimals } from './TokenDecimals';
import { QUERIER_ABI } from './ABIs/QUERIER_ABI';



export class Scanner {

  processor: Processor;

  startIndex: bigint;
  endIndex: bigint;

  chainId: number;
  gasExecutionCost: bigint = 45000n;
  tokenPrices: TokenPrices;
  tokenDecimals: TokenDecimals;

  subsInAuction: Set<bigint>;


  subscriptionIndexmap: Map<bigint, IndexedSubscription>;

  // profit margin in percentage
  tokenGainFactor: number = 1.1;

  // map with subscription index as key and lastPayment + cooldown as value
  waitingSubs: Map<bigint, number>;

  constructor(chainId: number, startIndex: bigint, endIndex: bigint, tokenPrices: TokenPrices, tokenDecimals: TokenDecimals, processor: Processor) {
    this.startIndex = startIndex;
    this.endIndex = endIndex;
    this.processor = processor;
    this.chainId = chainId;
    this.tokenPrices = tokenPrices;
    this.tokenDecimals = tokenDecimals;
    this.waitingSubs = new Map<bigint, number>();
    this.subsInAuction = new Set<bigint>();
    this.subscriptionIndexmap = new Map<bigint, IndexedSubscription>();
  }

  async init() {
    // endIndex not included
    const indexedSubs: IndexedSubscription[] = await this.querySubscriptionsRange(this.startIndex, this.endIndex);
    //console.log("init scanner, indexedSubs: ", indexedSubs);
    this.handleQueriedSubs(indexedSubs);
  }

  private async handleQueriedSubs(indexedSubs: IndexedSubscription[]) {
    if(indexedSubs.length === 0) {
      return;
    }

    for(let i=0; i < indexedSubs.length; i++) {
      this.subscriptionIndexmap.set(indexedSubs[i].index, indexedSubs[i]);
    }

    // query gas prices
    const gasPriceConfig: GasPriceConfig = await this.estimateFees();
    
    
    // calculate dollar price of redeeming a subscription
    const ethCost: number = Number(formatEther(gasPriceConfig.maxFeePerGas * this.gasExecutionCost));
    
    // based on WETH price
    const ethPrice: number = this.tokenPrices.priceMap.get('0xD72b476361bB087d8158235Cca3094900877361b')!;
    
    const usdCost = ethCost * ethPrice;

    const subIndicesToProcess: bigint[] = [];

    const tokensToAdd = new Set<string>();

    for(let i=0; i < indexedSubs.length; i++) {
      const indexedSub: IndexedSubscription = indexedSubs[i];
      if(!this.subscriptionCanceled(indexedSub.subscription) && !this.subscriptionExpired(indexedSub.subscription)) {
        // dont use canceled or expired ones
        tokensToAdd.add(indexedSub.subscription.processingFeeToken);
      }
    }
    await this.tokenPrices.addTokens(Array.from(tokensToAdd));
    await this.tokenDecimals.addTokens(Array.from(tokensToAdd));

    for(let i=0; i < indexedSubs.length; i++) {
      const indexedSub: IndexedSubscription = indexedSubs[i];
      const sub: Subscription = indexedSub.subscription;
      if(this.subscriptionCanceled(indexedSub.subscription)) {
        // subscription is canceled, do nothing
        //console.log("subscription canceled: ", indexedSub.index);
      }
      else if(this.subscriptionExpired(indexedSub.subscription)) {
        // subscription is expired, do nothing
        //console.log("subscription expired: ", indexedSub.index);
      }
      else if(this.inAuctionPeriod(indexedSub.subscription)) {
        // in auction period, calculate 
        const tipTokenPrice: number = this.tokenPrices.priceMap.get(sub.processingFeeToken)!;
        if(!tipTokenPrice) continue;
        const tipAmount: bigint = this.getAuctionTipAmount(sub);
        
        const tipTokenDecimals: number = this.tokenDecimals.decimalMap.get(sub.processingFeeToken)!;
        const usdGain: number = tipTokenPrice * Number(formatUnits(tipAmount, tipTokenDecimals));

        if(usdGain > usdCost * this.tokenGainFactor) {
          // redeem subscription right away
          //console.log("is worth redeeming: ", indexedSub.index)
          subIndicesToProcess.push(indexedSub.index);
        }
        else {
          // for executing these depends on both current gas price but also the timing (tip amount)
          //console.log("adding to subsInAuction: ", indexedSub.index)
          this.subsInAuction.add(indexedSub.index);
        }

      }
      else {
        // subscription is not redeemable yet, add to BST
        //console.log("subscription not redeemable yet: ", indexedSub.index);

        this.waitingSubs.set(indexedSub.index, sub.lastPayment + sub.cooldown);
        
      }

    }

    if(subIndicesToProcess.length === 0) {
      //console.log("No subscriptions to execute");
    }
    else {
      // maybe do some checks that that fee is up to date etc
      const batchProcessingReceipt: BatchProcessingReceipt = await this.processor.processBatch(subIndicesToProcess);
      if(batchProcessingReceipt.transactionReceipt.status === 'success') {
        // requery updated subscriptions
        const indicesToUpdate: bigint[] = [];

        for(let processingReceipt of batchProcessingReceipt.processingReceipts) {
          indicesToUpdate.push(processingReceipt.subscriptionIndex);
        }
        this.updateIndices(indicesToUpdate);

      }
      else {
        //console.log("Transaction failed", batchProcessingReceipt);
      }
    }
  }

  async updateTime() {
    const currentTime: bigint = BigInt(Math.floor(Date.now() / 1000));
    const subIndices: bigint[] = this.removeLessThanOrEqualTo(this.waitingSubs, currentTime);

    // check if auction period is over
    for(let index of this.subsInAuction) {
      const indexedSub: IndexedSubscription = this.subscriptionIndexmap.get(index)!;
      if(!this.inAuctionPeriod(indexedSub.subscription)) {
        // remove from set
        this.subsInAuction.delete(index);
      }
    }

    // go thorugh subsInAuction and check if they are profitable to redeem
    const gasPriceConfig: GasPriceConfig = await this.estimateFees();
    //console.log("GAS PRICE CONFIG: ", gasPriceConfig);
    for(let index of this.subsInAuction) {
      //console.log("EVALUATING SUB IN AUCTION")
      const indexedSub: IndexedSubscription = this.subscriptionIndexmap.get(index)!;
      const sub: Subscription = indexedSub.subscription;
      const tipTokenPrice: number = this.tokenPrices.priceMap.get(sub.processingFeeToken)!;
      if(!tipTokenPrice) continue;
      const tipAmount: bigint = this.getAuctionTipAmount(sub);
      
      const tipTokenDecimals: number = this.tokenDecimals.decimalMap.get(sub.processingFeeToken)!;
      const usdGain: number = tipTokenPrice * Number(formatUnits(tipAmount, tipTokenDecimals));
      const ethCost: number = Number(formatEther(gasPriceConfig.maxFeePerGas * this.gasExecutionCost));
      const ethPrice: number = this.tokenPrices.priceMap.get('0xD72b476361bB087d8158235Cca3094900877361b')!;
      const usdCost = ethCost * ethPrice;
      if(usdGain > usdCost * this.tokenGainFactor) {
        //console.log("PUSHING PROFITABLE SUB TO PROCESS")
        subIndices.push(index);
      }
    }
  

    if(subIndices.length === 0) {
      //console.log("No subscriptions to process");
    }
    else {
      // maybe do some checks that that fee is up to date etc
      const batchProcessingReceipt: BatchProcessingReceipt = await this.processor.processBatch(subIndices);
      if(batchProcessingReceipt.transactionReceipt.status === 'success') {
        // requery updated subscriptions
        const indicesToUpdate: bigint[] = [];

        for(let processingReceipt of batchProcessingReceipt.processingReceipts) {
          indicesToUpdate.push(processingReceipt.subscriptionIndex);
        }
        this.updateIndices(indicesToUpdate);
      }
      else {
        // transaction reverted
        // query nonce and try again
        //console.log("Transaction failed", batchProcessingReceipt);
      }
    }
    

  }
  
  async getSubscriptions(indices: bigint[]) : Promise<Readonly<Subscription[]>> {
    const data = await publicClient.readContract({
      address: `0x${QUERIER_ADDRESS.substring(2)}`,
      abi: QUERIER_ABI,
      functionName: 'getSubscriptions',
      args: [indices]
    })
    return data;
  }

  async getSubscriptionsLength() : Promise<bigint> {
    const data = await publicClient.readContract({
      address: `0x${SUB2_ADDRESS.substring(2)}`,
      abi: SUB2_ABI,
      functionName: 'getNumberOfSubscriptions',
      args: []
    })
    return data;
  }

  cooldownPassed(sub: Subscription) : boolean {
    return Math.floor(Date.now() / 1000) > sub.cooldown + sub.lastPayment;
  }

  inAuctionPeriod(sub: Subscription) : boolean {
    
    return this.cooldownPassed(sub) && Math.floor(Date.now() / 1000) < sub.cooldown + sub.lastPayment + sub.auctionDuration;
  }

  getAuctionTipAmount(sub: Subscription) : bigint {
    // should only be used after inAuctionPeriod check
    const secondsInAuctionPeriod: number = Math.floor(Date.now() / 1000) - sub.lastPayment - sub.cooldown;
    const executorTip: bigint = (sub.maxProcessingFee * BigInt(secondsInAuctionPeriod)) / BigInt(sub.auctionDuration);
    return executorTip;
  }

  subscriptionCanceled(sub: Subscription) : boolean {
    return sub.sender === "0x0000000000000000000000000000000000000000";
  }

  subscriptionExpired(sub: Subscription) : boolean {
    return BigInt(Math.floor(Date.now() / 1000)) > sub.cooldown + sub.lastPayment + sub.auctionDuration;
  }

  async querySubscriptionsRange(startIndex: bigint, endIndex: bigint) : Promise<IndexedSubscription[]> {
    // queries and returns all redeemable subscriptions
    // endIndex not included


    const numberOfSubs: bigint = await this.getSubscriptionsLength();
    if(endIndex > numberOfSubs) {
      endIndex = numberOfSubs;
    }

    const subscriptionIndices: bigint[] = this.generateIndices(startIndex, endIndex);

    const subscriptions: Readonly<Subscription[]> = await this.getSubscriptions(subscriptionIndices);

    const indexedSubscriptions: IndexedSubscription[] = [];

    for(let i=0; i < subscriptionIndices.length; i++) {
        const sub: Subscription = subscriptions[i];
        indexedSubscriptions.push({index: subscriptionIndices[i], subscription: sub});
      }

    return indexedSubscriptions;
  }

  async querySubscriptions(indices: bigint[]) : Promise<IndexedSubscription[]> {

    const subscriptions: Readonly<Subscription[]> = await this.getSubscriptions(indices);

    const indexedSubscriptions: IndexedSubscription[] = [];

    for(let i=0; i < indices.length; i++) {
        const sub: Subscription = subscriptions[i];
        indexedSubscriptions.push({index: indices[i], subscription: sub});
      }

    return indexedSubscriptions;
  }

  async updateIndices(indices: bigint[]) {
    const numberOfSubs: bigint = await this.getSubscriptionsLength();
    //console.log("INDICES: ", indices);
    const indicesWithinRange: bigint[] = indices.filter(value => value >= this.startIndex && value < this.endIndex && value < numberOfSubs);
    //console.log("updating, deleting indices: ", indicesWithinRange);
    for(let i=0; i < indicesWithinRange.length; i++) {
      // delete from all data structures
      this.waitingSubs.delete(indicesWithinRange[i]);
      this.subsInAuction.delete(indicesWithinRange[i]);
      this.subscriptionIndexmap.delete(indicesWithinRange[i]);
    }

    const indexedSubs: IndexedSubscription[] = await this.querySubscriptions(indicesWithinRange);

    //console.log("updated indexedSubs: ", indexedSubs)
    

    this.handleQueriedSubs(indexedSubs);

  }

  private generateIndices = (startIndex: bigint, endIndex: bigint): bigint[] => {
    // endIndex not included
    const indices: bigint[] = [];

    for (let i = startIndex; i < endIndex; i++) {
      indices.push(i);
    }
    return indices;
  }

  private async estimateFees() : Promise<GasPriceConfig> {
    const gasPriceRes = await publicClient.estimateFeesPerGas();

    const gasPriceConfig: GasPriceConfig = {
      maxFeePerGas: gasPriceRes.maxFeePerGas!,
      maxPriorityFeePerGas: gasPriceRes.maxPriorityFeePerGas!
    }
    return gasPriceConfig;
  };
  

private removeLessThanOrEqualTo(map: Map<bigint, number>, cutoff: bigint): bigint[] {
  const result: bigint[] = [];

  //console.log("MAP: ", map)
  for (const [key, value] of map) {
    if (value <= cutoff) {
      result.push(key);
    }
  }

  // Delete the keys after collecting the values to avoid modifying the map during iteration
  for (const [key, value] of map) {
    if (value <= cutoff) {
      map.delete(key);
    }
  }

  return result;
}

}