/**
 * Polymarket SDK Client Initialization
 *
 * This module provides initialized SDK clients for interacting with Polymarket.
 * Uses polymarket-kit for convenience features, with fallback to official client.
 */

import { GammaSDK } from "@hk/polymarket";
import { ClobClient } from "@polymarket/clob-client";
import { Wallet } from "@ethersproject/wallet";
import type { PolymarketConfig } from "./types";
import { log, warn, error } from "@/lib/logger";

// Environment configuration with defaults
const config: PolymarketConfig = {
  privateKey: process.env.POLYMARKET_PRIVATE_KEY || "",
  funderAddress: process.env.POLYMARKET_FUNDER_ADDRESS || "",
  chainId: parseInt(process.env.POLYMARKET_CHAIN_ID || "137", 10),
  clobHost: process.env.POLYMARKET_CLOB_HOST || "https://clob.polymarket.com",
  gammaHost:
    process.env.POLYMARKET_GAMMA_HOST || "https://gamma-api.polymarket.com",
};

/**
 * GammaSDK instance for market data (no credentials needed)
 * Use this for fetching market information, prices, and events
 */
let gammaClient: GammaSDK | null = null;

export function getGammaClient(): GammaSDK {
  if (!gammaClient) {
    gammaClient = new GammaSDK();
  }
  return gammaClient;
}

/**
 * Official CLOB client for trading operations
 * Requires credentials (private key and funder address)
 */
let clobClient: ClobClient | null = null;
let apiCreds: { key: string; secret: string; passphrase: string } | null = null;

export async function initializeClobClient(): Promise<ClobClient> {
  if (!config.privateKey || !config.funderAddress) {
    throw new Error(
      "POLYMARKET_PRIVATE_KEY and POLYMARKET_FUNDER_ADDRESS must be set for trading operations"
    );
  }

  // Create wallet from private key
  const wallet = new Wallet(config.privateKey);
  const derivedAddress = await wallet.getAddress();

  log('CLOB', `Wallet address derived from private key: ${derivedAddress}`);
  log('CLOB', `Configured funder address: ${config.funderAddress}`);

  // Warn if addresses don't match
  if (derivedAddress.toLowerCase() !== config.funderAddress.toLowerCase()) {
    warn(
      'CLOB',
      `WARNING: Derived wallet address (${derivedAddress}) does not match ` +
      `funder address (${config.funderAddress}). This may cause authentication issues.`
    );
  }

  // Create initial client to derive API credentials
  const tempClient = new ClobClient(
    config.clobHost,
    config.chainId,
    wallet,
    undefined,
    undefined,
    derivedAddress // Use the derived address as funder
  );

  try {
    // Derive API credentials for authenticated requests
    apiCreds = await tempClient.createOrDeriveApiKey();
    log('CLOB', 'API credentials derived successfully');
  } catch (err) {
    error('CLOB', 'Failed to derive API credentials:', err);
    throw new Error(
      `Failed to derive API credentials. Make sure the private key is for an account ` +
      `that has been registered with Polymarket. Derived address: ${derivedAddress}`
    );
  }

  // Create authenticated client with API credentials
  clobClient = new ClobClient(
    config.clobHost,
    config.chainId,
    wallet,
    apiCreds,
    undefined,
    derivedAddress
  );

  return clobClient;
}

export function getClobClient(): ClobClient {
  if (!clobClient) {
    throw new Error(
      "CLOB client not initialized. Call initializeClobClient() first."
    );
  }
  return clobClient;
}

export async function getOrInitClobClient(): Promise<ClobClient> {
  if (!clobClient) {
    return initializeClobClient();
  }
  return clobClient;
}

/**
 * Check if trading credentials are configured
 */
export function hasCredentials(): boolean {
  return !!config.privateKey && !!config.funderAddress;
}

/**
 * Get current configuration (without sensitive data)
 */
export function getConfig(): Omit<PolymarketConfig, "privateKey"> {
  return {
    funderAddress: config.funderAddress,
    chainId: config.chainId,
    clobHost: config.clobHost,
    gammaHost: config.gammaHost,
  };
}
