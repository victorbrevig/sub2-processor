import { CurrencyAmount, Token } from "@uniswap/sdk-core";
import { Pair, Route } from "@uniswap/v2-sdk";
import { Address, createPublicClient, http, parseAbi, PublicClient } from "viem";
import { mainnet } from "viem/chains";

export class TokenPrices {
  chainId: number;
  priceMap: Map<string, number> = new Map<string, number>();
  private publicClient: PublicClient;



  private readonly ABI = parseAbi([
    "function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)",
    "function token0() external view returns (address)",
    "function token1() external view returns (address)",
  ]);

  private readonly baseSepoliaToETHMainnetTokenAddresses: Map<string, {address: string, decimals: number}> = new Map<string, {address: string, decimals: number}>([
    // WETH
    ['0xD72b476361bB087d8158235Cca3094900877361b', { address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', decimals: 18 }],
    // USDC
    ['0x7139F4601480d20d43Fa77780B67D295805aD31a', { address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', decimals: 6 }],
    // DAI
    ['0x701f372f2A10688c4f3e31E20ceabC1f3A88ac2c', { address: '0x6B175474E89094C44Da98b954EedeAC495271d0F', decimals: 18 }],
    // WBTC
    ['0xF671644C9e793caF69a45520B609DDD83611FE34', { address: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599', decimals: 8 }],
  ]);

  constructor(chainId: number) {
    this.chainId = chainId;
    this.publicClient = createPublicClient({
      chain: mainnet,
      transport: http(),
    });;
  }

  async updateAllPrices() {
    const tokens: string[] = Array.from(this.priceMap.keys());
    const fetchedPrices = await this.fetchTokenPrices(tokens);

    for (const { token, price } of fetchedPrices) {
      this.priceMap.set(token, price);
    }
  }

  async addTokens(tokens: string[]) {  
    const tokensToFetch = tokens.filter((token) => {
      return !this.priceMap.has(token.toString());
    });

    const fetchedPrices = await this.fetchTokenPrices(tokensToFetch);
    for (const { token, price } of fetchedPrices) {
      this.priceMap.set(token.toString(), price);
    }
  }

  private async fetchTokenPrices(tokens: string[]): Promise<{ token: string, price: number }[]> {
    // Create an array of promises without awaiting inside the map
    const pricePromises = tokens.map(async (token) => {
      const tokenObj = this.baseSepoliaToETHMainnetTokenAddresses.get(token.toString());
      if(tokenObj !== undefined) {
        const price = await this.fetchPriceToken(tokenObj.address, tokenObj.decimals);
        return { token, price };
      }
      
    });

    // Use Promise.all to wait for all promises to resolve and filter out undefined prices
    const pricesWithTokens = await Promise.all(pricePromises);
    return pricesWithTokens.filter((entry) => entry && entry.price !== undefined) as { token: string, price: number }[];
  }

  private async fetchPriceToken(tokenAddress: string, tokenDecimals: number) : Promise<number> {
    if(tokenAddress === "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48") {
      return 1;
    }
    try {
      const USDC = new Token(1, "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", 6);
      const TOKEN = new Token(
        1,
        tokenAddress,
        tokenDecimals,
      );
      const pairAddress = Pair.getAddress(TOKEN, USDC) as Address;
  
      const wagmiConfig = {
        address: pairAddress,
        abi: this.ABI,
      };
  
      const reserves = await this.publicClient.readContract({
        ...wagmiConfig,
        functionName: "getReserves",
      });
  
      const token0Address = await this.publicClient.readContract({
        ...wagmiConfig,
        functionName: "token0",
      });
  
      const token1Address = await this.publicClient.readContract({
        ...wagmiConfig,
        functionName: "token1",
      });
      const token0 = [TOKEN, USDC].find(token => token.address === token0Address) as Token;
      const token1 = [TOKEN, USDC].find(token => token.address === token1Address) as Token;
      const pair = new Pair(
        CurrencyAmount.fromRawAmount(token0, reserves[0].toString()),
        CurrencyAmount.fromRawAmount(token1, reserves[1].toString()),
      );
      const route = new Route([pair], TOKEN, USDC);
      const price = parseFloat(route.midPrice.toSignificant(10));
      return price;
    } catch (error) {
      return 0;
    }
  }
}
