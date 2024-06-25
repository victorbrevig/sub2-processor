
import { erc20Abi } from "viem";
import { publicClient } from './config';

export class TokenDecimals {
  chainId: number;

  decimalMap: Map<string, number> = new Map<string, number>();

  constructor(chainId: number) {
    this.chainId = chainId;
  }

  async addTokens(tokens: string[]) {  
    const tokensToFetch = tokens.filter((token) => {
      return !this.decimalMap.has(token.toString());
    });

    const fetchedPrices = await this.fetchTokenDecimals(tokensToFetch);
    for (let i = 0; i < fetchedPrices.length; i++) {
        this.decimalMap.set(tokensToFetch[i].toString(), fetchedPrices[i]!);
    }
  }

  private async fetchTokenDecimals(tokens: string[]): Promise<number[]> {
    // Create an array of promises without awaiting inside the map
    const pricePromises = tokens.map((token) => {
      return this.fetchTokenDecimal(token.toString());
    });

    // Use Promise.all to wait for all promises to resolve
    return Promise.all(pricePromises);
  }

  private async fetchTokenDecimal(token: string) : Promise<number> {
    const data = await publicClient.readContract({
      address: `0x${token.substring(2)}`,
      abi: erc20Abi,
      functionName: 'decimals',
    })

    return data;
  };
}