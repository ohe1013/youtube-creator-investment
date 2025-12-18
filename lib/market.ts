/**
 * Market Logic for YouTuber Invest Market
 * 
 * Rules:
 * 1. Price is formed ONLY by trading.
 * 2. P0 (Initial Price) is calculated at listing based on SCALED YouTube metrics.
 * 3. Price Impact Model determines price changes during BUY/SELL.
 */

interface ListingStats {
  subs: number;
  totalViews: number;
  recentViews: number; // e.g., last 30 days
  recentShortsViews?: number; // Optional, strict separation might not be available
}

export const MARKET_CONFIG = {
  DEFAULT_TOTAL_SUPPLY: 1000000,
  DEFAULT_CIRCULATING_SUPPLY: 200000, // 20%
  DEFAULT_LIQUIDITY_K: 0.1, // Price impact constant
  MIN_PRICE: 10,
  MIN_TRADE_UNIT: 0.01,
  
  // P0 Calculation Weights (applied after scaling)
  P0_BASE: 100,
  WEIGHT_SUBS: 1.0,        // per 1k subs
  WEIGHT_VIEWS: 0.5,       // per 1M views
  WEIGHT_RECENT: 2.0,      // per 100k recent views
};

/**
 * Calculate Initial Listing Price (P0) with Unit Scaling
 * 
 * Formula:
 * subsScaled = subs / 1,000
 * totalViewsScaled = totalViews / 1,000,000
 * recentViewsScaled = recentViewsWeighted / 100,000
 * 
 * P0 = base + (subsScaled * w1) + (totalViewsScaled * w2) + (recentViewsScaled * w3)
 */
export function calculateP0(stats: ListingStats): number {
  const { subs, totalViews, recentViews, recentShortsViews = 0 } = stats;
  
  // 1. Calculate weighted recent views (10% weight for shorts if strictly provided)
  // If shorts data is 0 or missing, we assume recentViews contains the mix or is all long-form
  // For v1 safety: recentViewsWeighted = recentViews (if no specific breakdown)
  const recentViewsWeighted = recentShortsViews > 0 
    ? (recentViews - recentShortsViews) + (0.1 * recentShortsViews)
    : recentViews;

  // 2. Unit Scaling
  const subsScaled = subs / 1000;
  const totalViewsScaled = totalViews / 1000000;
  const recentViewsScaled = recentViewsWeighted / 100000;

  // 3. Linear Combination
  const p0 = MARKET_CONFIG.P0_BASE
    + (subsScaled * MARKET_CONFIG.WEIGHT_SUBS)
    + (totalViewsScaled * MARKET_CONFIG.WEIGHT_VIEWS)
    + (recentViewsScaled * MARKET_CONFIG.WEIGHT_RECENT);
  
  // 4. Boundary Check
  return Math.max(MARKET_CONFIG.MIN_PRICE, Math.round(p0 * 100) / 100);
}

/**
 * Apply Price Impact Model
 * BUY: MP_new = MP_old * (1 + k * tradeValue / liquidity)
 * SELL: MP_new = MP_old * (1 - k * tradeValue / liquidity)
 * 
 * Invariants:
 * - Liquidity acts as 'inertia'. Higher liquidity = lower price impact.
 * - TradeValue = Quantity * CurrentPrice
 */
export function calculateNewPrice(
  currentPrice: number,
  tradeValue: number,
  tradeType: 'BUY' | 'SELL',
  liquidity: number
): number {
  const k = MARKET_CONFIG.DEFAULT_LIQUIDITY_K;
  let newPrice: number;
  
  // Safety: Prevent division by zero
  const safeLiquidity = Math.max(liquidity, 1000); // Minimum liquidity floor
  
  const impact = (k * tradeValue) / safeLiquidity;

  if (tradeType === 'BUY') {
    newPrice = currentPrice * (1 + impact);
  } else {
    // For sell, cap impact to prevent negative price (though unlikely with this formula)
    newPrice = currentPrice * (1 - Math.min(impact, 0.99)); 
  }
  
  return Math.max(MARKET_CONFIG.MIN_PRICE, Math.round(newPrice * 100) / 100);
}

/**
 * Calculate trade value and impact
 */
export function getTradeImpact(
  quantity: number,
  currentPrice: number,
  tradeType: 'BUY' | 'SELL',
  liquidity: number
): { tradeValue: number; newPrice: number } {
  const tradeValue = quantity * currentPrice;
  const newPrice = calculateNewPrice(currentPrice, tradeValue, tradeType, liquidity);
  
  return { tradeValue, newPrice };
}
