import { Scanner } from "./Scanner";
import { Processor } from "./Processor";
import { TokenPrices } from "./TokenPrices";
import { IndexedSubscription } from "./interfaces";

import { publicClient } from './config';
import { PublicClient, parseAbiItem } from 'viem';
import { SUB2_ADDRESS } from './constants';

import { SUB2_ABI } from './ABIs/SUB2_ABI';

import { EventListener } from "./EventListener";
import { TokenDecimals } from "./TokenDecimals";

async function main() {
  
  // Base Sepolia
  const processor: Processor = new Processor(84532);
  const tokenPrices: TokenPrices = new TokenPrices(84532);
  const tokenDecimals: TokenDecimals = new TokenDecimals(84532);
  await tokenPrices.addTokens(['0xD72b476361bB087d8158235Cca3094900877361b']);
  const scanner: Scanner = new Scanner(84532, 0n, 100n, tokenPrices, tokenDecimals, processor);
  scanner.init();
  const eventListener: EventListener = new EventListener(84532, scanner);

  // every block, query eventListener

  // query current block number
  let blockNumber = await publicClient.getBlockNumber();

  const unwatch = publicClient.watchBlockNumber( 
    { onBlockNumber: blockNum => {
      // make sure to not miss a number
      eventListener.onNewBlocks(blockNumber+1n, blockNum);
      
      // print all bigints between blockNumber +1 and blockNum (inclusive)
      /*
      for (let i = blockNumber+1n; i <= blockNum; i++) {
        console.log(i);
      }
      */
      blockNumber = blockNum;
      }
    }
  )

  // updateTime in interval every 2 minutes
  setInterval(async () => {
    await tokenPrices.updateAllPrices();
    await scanner.updateTime();
  }, 120000);

}

main();
