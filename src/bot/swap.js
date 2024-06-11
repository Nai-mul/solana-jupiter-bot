const { calculateProfit, toDecimal, storeItInTempAsJSON } = require("../utils");
const cache = require("./cache");
const { setTimeout } = require("timers/promises");
const { balanceCheck } = require("./setup");
const { checktrans } = require("../utils/transaction.js");
const promiseRetry = require("promise-retry");

// Wait function with proper error handling
const waitabit = async (ms) => {
  try {
    await setTimeout(ms);
    console.log('Waited for', ms, 'milliseconds.');
  } catch (error) {
    console.error('Error occurred while waiting:', error);
  }
};

// Swap function
const swap = async (jupiter, route) => {
  try {
    const performanceOfTxStart = performance.now();
    cache.performanceOfTxStart = performanceOfTxStart;

    if (process.env.DEBUG) storeItInTempAsJSON("routeInfoBeforeSwap", route);

    const priority = cache.config.priority ?? 100; // 100 BPS default if not set
    cache.priority = priority;

    const { execute } = await jupiter.exchange({
      routeInfo: route,
      computeUnitPriceMicroLamports: priority,
    });
    const result = await execute();

    if (process.env.DEBUG) storeItInTempAsJSON("result", result);

    cache.tradeCounter.failedbalancecheck = 0;
    cache.tradeCounter.errorcount = 0;

    const performanceOfTx = performance.now() - performanceOfTxStart;
    return [result, performanceOfTx];
  } catch (error) {
    console.error("Swap error:", error);
  }
};
exports.swap = swap;

// Handler for failed swaps
const failedSwapHandler = async (tradeEntry, inputToken, tradeAmount) => {
  cache.tradeCounter[cache.sideBuy ? "buy" : "sell"].fail++;

  if (cache.config.storeFailedTxInHistory) {
    cache.tradeHistory.push(tradeEntry);
  }

  const realbalanceToken = await balanceCheck(inputToken);

  if (Number(realbalanceToken) < Number(tradeAmount)) {
    cache.tradeCounter.failedbalancecheck++;
    if (cache.tradeCounter.failedbalancecheck > 5) {
      console.error(`Balance too low for token: ${realbalanceToken} < ${tradeAmount}`);
      console.error(`Failed balance check ${cache.tradeCounter.failedbalancecheck} times`);
      process.exit();
    }
  }

  cache.tradeCounter.errorcount += 1;
  if (cache.tradeCounter.errorcount > 100) {
    console.error(`Error Count too high for swaps: ${cache.tradeCounter.errorcount}`);
    process.exit();
  }
};
exports.failedSwapHandler = failedSwapHandler;

// Handler for successful swaps
const successSwapHandler = async (tx, tradeEntry, tokenA, tokenB) => {
  if (process.env.DEBUG) storeItInTempAsJSON(`txResultFromSDK_${tx?.txid}`, tx);

  cache.tradeCounter[cache.sideBuy ? "buy" : "sell"].success++;

  const updateBalancesAndProfit = (outputAmount, isBuy) => {
    if (isBuy) {
      cache.lastBalance.tokenA = cache.currentBalance.tokenA;
      cache.currentBalance.tokenA = 0;
      cache.currentBalance.tokenB = outputAmount;
      cache.currentProfit.tokenB = calculateProfit(
        String(cache.initialBalance.tokenB),
        String(cache.currentBalance.tokenB)
      );
      cache.currentProfit.tokenA = 0;
    } else {
      cache.lastBalance.tokenB = cache.currentBalance.tokenB;
      cache.currentBalance.tokenB = 0;
      cache.currentBalance.tokenA = outputAmount;
      cache.currentProfit.tokenA = calculateProfit(
        String(cache.initialBalance.tokenA),
        String(cache.currentBalance.tokenA)
      );
      cache.currentProfit.tokenB = 0;
    }
  };

  if (cache.config.tradingStrategy === "pingpong") {
    updateBalancesAndProfit(tx.outputAmount, cache.sideBuy);

    tradeEntry.inAmount = toDecimal(
      tx.inputAmount,
      cache.sideBuy ? tokenA.decimals : tokenB.decimals
    );
    tradeEntry.outAmount = toDecimal(
      tx.outputAmount,
      cache.sideBuy ? tokenB.decimals : tokenA.decimals
    );
    tradeEntry.profit = calculateProfit(
      String(cache.lastBalance[cache.sideBuy ? "tokenB" : "tokenA"]),
      String(tx.outputAmount)
    );
    cache.tradeHistory.push(tradeEntry);
  }

  if (cache.config.tradingStrategy === "arbitrage") {
    await handleArbitrage(tx, tradeEntry, tokenA);
  }
};
exports.successSwapHandler = successSwapHandler;

// Handler for arbitrage
const handleArbitrage = async (tx, tradeEntry, tokenA) => {
  try {
    const fetcher = async (retry, number) => {
      console.log(`Attempt ${number}: Fetching ARB trade result via RPC.`);
      const [txresult, err2] = await checktrans(tx?.txid, cache.walletpubkeyfull);

      if (err2 === 0 && txresult) {
        if (txresult?.[tokenA.address]?.change > 0) {
          updateArbitrageBalancesAndProfit(txresult, tradeEntry, tokenA);
          return txresult;
        } else {
          retry(new Error("Transaction not posted yet... Retrying..."));
        }
      } else if (err2 === 2) {
        throw new Error(JSON.stringify(txresult));
      } else {
        retry(new Error("Transaction not posted yet. Retrying..."));
      }
    };

    await promiseRetry(fetcher, {
      retries: 30,
      minTimeout: 1000,
      maxTimeout: 4000,
      randomize: true,
    });
  } catch (error) {
    console.error("Fetch Result Error:", error);
  }
};

// Update balances and profit for arbitrage
const updateArbitrageBalancesAndProfit = (txresult, tradeEntry, tokenA) => {
  cache.lastBalance.tokenA = cache.currentBalance.tokenA;
  cache.currentBalance.tokenA += txresult[tokenA.address].change;

  cache.currentProfit.tokenA = calculateProfit(
    String(cache.initialBalance.tokenA),
    String(cache.currentBalance.tokenA)
  );

  tradeEntry.inAmount = toDecimal(
    cache.lastBalance.tokenA, tokenA.decimals
  );
  tradeEntry.outAmount = toDecimal(
    cache.currentBalance.tokenA, tokenA.decimals
  );
  tradeEntry.profit = calculateProfit(
    tradeEntry.inAmount, tradeEntry.outAmount
  );

  cache.tradeHistory.push(tradeEntry);
};
