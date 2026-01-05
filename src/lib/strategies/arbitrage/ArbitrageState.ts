/**
 * Arbitrage Strategy State Management
 *
 * Encapsulates per-bot state including:
 * - Order cooldowns per leg (YES/NO)
 * - Round-robin leg selection tracking
 */

export interface CooldownState {
  lastYesTime: number;
  lastNoTime: number;
}

/**
 * Manages per-bot state for the arbitrage strategy
 */
export class ArbitrageState {
  private cooldowns: Map<string, CooldownState> = new Map();
  private lastBoughtLeg: Map<string, 'YES' | 'NO'> = new Map();

  /**
   * Get or initialize cooldown state for a bot
   */
  getCooldowns(botId: string): CooldownState {
    if (!this.cooldowns.has(botId)) {
      this.cooldowns.set(botId, { lastYesTime: 0, lastNoTime: 0 });
    }
    return this.cooldowns.get(botId)!;
  }

  /**
   * Record that an order was placed for a specific leg
   */
  recordOrder(botId: string, leg: 'YES' | 'NO', timestamp: number = Date.now()): void {
    const cooldowns = this.getCooldowns(botId);
    if (leg === 'YES') {
      cooldowns.lastYesTime = timestamp;
    } else {
      cooldowns.lastNoTime = timestamp;
    }
    this.lastBoughtLeg.set(botId, leg);
  }

  /**
   * Check if a leg is on cooldown
   */
  isOnCooldown(botId: string, leg: 'YES' | 'NO', cooldownMs: number, now: number = Date.now()): boolean {
    const cooldowns = this.getCooldowns(botId);
    const lastTime = leg === 'YES' ? cooldowns.lastYesTime : cooldowns.lastNoTime;
    return now - lastTime < cooldownMs;
  }

  /**
   * Check if both legs are on cooldown
   */
  areBothOnCooldown(botId: string, cooldownMs: number, now: number = Date.now()): boolean {
    return this.isOnCooldown(botId, 'YES', cooldownMs, now) &&
           this.isOnCooldown(botId, 'NO', cooldownMs, now);
  }

  /**
   * Get the next leg to buy in round-robin fashion
   * Returns the opposite of the last bought leg
   */
  getNextLegRoundRobin(botId: string): 'YES' | 'NO' {
    const lastLeg = this.lastBoughtLeg.get(botId) ?? 'NO';
    return lastLeg === 'YES' ? 'NO' : 'YES';
  }

  /**
   * Clean up state for a deleted bot (prevents memory leaks)
   */
  cleanup(botId: string): void {
    this.cooldowns.delete(botId);
    this.lastBoughtLeg.delete(botId);
  }
}
