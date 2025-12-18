
import { calculateP0, calculateNewPrice, MARKET_CONFIG } from "../lib/market";

function testP0Scaling() {
  console.log("=== Testing P0 Scaling ===");
  
  const cases = [
    { subs: 1000, totalViews: 1000000, recentViews: 100000, expectedP0: 100 + 1 + 0.5 + 2 },
    { subs: 10000, totalViews: 10000000, recentViews: 1000000, expectedP0: 100 + 10 + 5 + 20 },
    // Small channel
    { subs: 100, totalViews: 10000, recentViews: 1000, expectedP0: 100 + 0.1 + 0.005 + 0.02 },
  ];

  cases.forEach((c, i) => {
    const res = calculateP0({
      subs: c.subs,
      totalViews: c.totalViews,
      recentViews: c.recentViews
    });
    console.log(`Case ${i+1}: Subs=${c.subs}, Views=${c.totalViews} -> P0=${res} (Expected ~${c.expectedP0})`);
    
    if (Math.abs(res - c.expectedP0) > 0.01) {
      console.error(`FAIL: Expected ${c.expectedP0}, got ${res}`);
    } else {
      console.log("PASS");
    }
  });
}

function testPriceImpact() {
  console.log("\n=== Testing Price Impact ===");
  
  const currentPrice = 100;
  const liquidity = 10000;
  const k = MARKET_CONFIG.DEFAULT_LIQUIDITY_K; // 0.1

  // Buy 100 shares (Value = 10000)
  // Impact = 0.1 * 10000 / 10000 = 0.1 (10%)
  // New Price = 100 * 1.1 = 110
  const buyRes = calculateNewPrice(currentPrice, 10000, 'BUY', liquidity);
  console.log(`BUY Impact: 100 -> ${buyRes} (Expected 110)`);
  if (Math.abs(buyRes - 110) < 0.01) console.log("PASS"); else console.error("FAIL");

  // Sell 100 shares (Value = 10000)
  // Impact = 0.1 (10%)
  // New Price = 100 * 0.9 = 90
  const sellRes = calculateNewPrice(currentPrice, 10000, 'SELL', liquidity);
  console.log(`SELL Impact: 100 -> ${sellRes} (Expected 90)`);
  if (Math.abs(sellRes - 90) < 0.01) console.log("PASS"); else console.error("FAIL");
}

function testReversibility() {
    console.log("\n=== Testing Reversibility (Spread Check) ===");
    // Price = 100.
    // Buy 1 share (Value 100). Impact small.
    // Then Sell 1 share (Value ~100).
    const liquidity = 10000;
    const initialPrice = 100;
    
    // BUY 100 Value
    const priceAfterBuy = calculateNewPrice(initialPrice, 100, 'BUY', liquidity);
    
    // SELL 100 Value (Simulation: Selling back same amount)
    // Note: In real trade, selling same QUANTITY would yield slightly different VALUE. 
    // Here we test "Reverse Operation with similar magnitude".
    // If we sell same Quantity, value is Quantity * NewPrice (higher).
    
    // Let's assume we execute Buy(100 value) -> P_up
    // Then Sell(100 value) -> P_down
    // P_up = P * (1 + delta)
    // P_down = P_up * (1 - delta) = P * (1 - delta^2) < P
    // So price drops slightly (Slippage/Spread).
    
    const priceAfterSell = calculateNewPrice(priceAfterBuy, 100, 'SELL', liquidity);
    
    console.log(`Sequence: 100 -> BUY(100) -> ${priceAfterBuy} -> SELL(100) -> ${priceAfterSell}`);
    console.log(`Spread/Loss: ${initialPrice - priceAfterSell}`);
    
    if (priceAfterSell < initialPrice) {
        console.log("PASS: Reversibility shows slight spread (natural)");
    } else {
        console.log("FAIL: Price increased or stayed same (unexpected for P * (1-d) model)");
    }
}

testP0Scaling();
testPriceImpact();
testReversibility();
