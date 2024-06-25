import { Scanner } from './Scanner';
import { publicClient } from './config';
import { SUB2_ADDRESS } from './constants';
import { parseAbiItem } from 'viem';


export class EventListener {
  chainId: number;
  scanner: Scanner;

  constructor(chainId : number, scanner: Scanner) {
    this.chainId = chainId;
    this.scanner = scanner;
  }

  private async getCanceledSubscriptionsInBlock(fromNum: bigint, toNum: bigint) : Promise<bigint[]> {
    const logs = await publicClient.getLogs({
      fromBlock: fromNum,
      toBlock: toNum,
      address: SUB2_ADDRESS,
      event: parseAbiItem('event SubscriptionCanceled(uint256 indexed subscriptionIndex, address indexed recipient)'),
    });
    
    const indices: bigint[] = [];
    logs.forEach((log) => {
      indices.push(BigInt(log.args.subscriptionIndex!))
    })
    
    return indices;
  }

  private async getUpdatedMaxTipInBlock(fromNum: bigint, toNum: bigint) : Promise<bigint[]> {
    const logs = await publicClient.getLogs({
      fromBlock: fromNum,
      toBlock: toNum,
      address: SUB2_ADDRESS,
      event: parseAbiItem('event MaxProcessingFeeUpdated(uint256 subscriptionIndex, uint256 maxProcessingFee, address processingFeeToken)'),
    });
    const indices: bigint[] = [];
    logs.forEach((log) => {
      indices.push(BigInt(log.args.subscriptionIndex!))
    })
    
    return indices;
  }

  private async getCreatedSubscriptionInBlock(fromNum: bigint, toNum: bigint) : Promise<bigint[]> {
    const logs = await publicClient.getLogs({
      fromBlock: fromNum,
      toBlock: toNum,
      address: SUB2_ADDRESS,
      event: parseAbiItem('event SubscriptionCreated(uint256 indexed subscriptionIndex, address indexed recipient)'),
    });
    const indices: bigint[] = [];
    logs.forEach((log) => {
      indices.push(BigInt(log.args.subscriptionIndex!))
    })
    
    return indices;
  }

  /*
  private async getSuccessfulPaymentsInBlock(fromNum: bigint, toNum: bigint) : Promise<bigint[]> {
    const logs = await publicClient.getLogs({
      fromBlock: fromNum,
      toBlock: toNum,
      address: SUB2_ADDRESS,
      event: parseAbiItem('event Payment(address indexed sender, address indexed recipient, uint256 indexed subscriptionIndex, address sponsor, uint256 amount, address token, uint256 protocolFee, uint256 processingFee, address processingFeeToken, uint256 terms)'),
    });
    const indices: bigint[] = [];
    logs.forEach((log) => {
      indices.push(BigInt(log.args.subscriptionIndex!))
    })

    return indices;
  }
  */


  async onNewBlocks(fromNum: bigint, toNum: bigint) {
    Promise.all([
      this.getCanceledSubscriptionsInBlock(fromNum, toNum),
      this.getUpdatedMaxTipInBlock(fromNum, toNum),
      this.getCreatedSubscriptionInBlock(fromNum, toNum),
      //this.getSuccessfulPaymentsInBlock(fromNum, toNum)
    ]).then(([canceledSubs, updatedMaxTipSubs, createdSubs]) => {
      const allIndices = this.unionBigIntArrays(canceledSubs, updatedMaxTipSubs, createdSubs);
      if(allIndices.length > 0) {
        //console.log("EVENTS FOUND: ", allIndices);
        this.scanner.updateIndices(allIndices);
      }
    })
  }

  private unionBigIntArrays(...arrays: bigint[][]): bigint[] {
    const unionSet = new Set<bigint>();
    for (const array of arrays) {
        for (const value of array) {
            unionSet.add(value);
        }
    }
    return Array.from(unionSet);
}



}