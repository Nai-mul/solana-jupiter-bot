require("dotenv").config();
const { Connection, PublicKey } = require("@solana/web3.js");
const { setTimeout } = require("timers/promises");
const cache = require("../bot/cache");
const { loadConfigFile, toNumber, calculateProfit, toDecimal } = require("./index.js");

cache.config = loadConfigFile({ showSpinner: true });

// RPC Endpoints
const rpc_main = cache.config.rpc[0];
const rpc_backup = 'https://api.mainnet-beta.solana.com';

// Key variables
const WAIT_ERROR_CODE = 1;
const WAIT_SUCCESS_CODE = 0;

// Initialize Connections
const connection = new Connection(rpc_main, {
    disableRetryOnRateLimit: true,
    commitment: 'confirmed',
});
const connection_backup = new Connection(rpc_backup, {
    disableRetryOnRateLimit: false,
    commitment: 'confirmed',
});

const waitabit = async (ms) => {
    try {
        await setTimeout(ms);
        console.log('Waited for', ms, 'milliseconds.');
        return WAIT_SUCCESS_CODE;
    } catch (error) {
        console.error('Error occurred while waiting:', error);
        return WAIT_ERROR_CODE;
    }
};

const fetchTransaction = async (rpcConnection, transaction) => {
    try {
        return await rpcConnection.getParsedTransaction(transaction, { maxSupportedTransactionVersion: 0 });
    } catch (error) {
        console.error("Error fetching transaction:", error);
        return null;
    }
};

const checkTransactionStatus = async (transaction, wallet_address) => {
    const primaryTransaction = await fetchTransaction(connection, transaction);
    if (primaryTransaction) return primaryTransaction;

    // If primary RPC fails, try backup RPC
    return await fetchTransaction(connection_backup, transaction);
};

const parseTransactionBalances = (transresp, wallet_address) => {
    const transaction_changes = {};
    let tokenamt = 0;
    let tokendec = 0;

    // Handle inner SOL transfers
    if (transresp.meta.innerInstructions) {
        for (const instructions of transresp.meta.innerInstructions) {
            if (instructions.instructions) {
                for (const parsed of instructions.instructions) {
                    if (parsed.parsed && parsed.parsed.type === 'transferChecked') {
                        if (parsed.parsed.info.authority === wallet_address && parsed.parsed.info.mint === 'So11111111111111111111111111111111111111112') {
                            tokenamt = Number(parsed.parsed.info.tokenAmount.amount);
                            tokendec = parsed.parsed.info.tokenAmount.decimals;
                        }
                    }
                }
            }
        }
    }

    if (tokenamt > 0) {
        transaction_changes['So11111111111111111111111111111111111111112'] = {
            status: transresp.meta.status,
            start: tokenamt,
            decimals: tokendec,
            end: 0,
            change: -tokenamt
        };
    }

    for (const token of transresp.meta.preTokenBalances) {
        if (token.owner === wallet_address) {
            transaction_changes[token.mint.toString()] = {
                status: transresp.meta.status,
                start: token.uiTokenAmount.amount,
                decimals: token.uiTokenAmount.decimals
            };
        }
    }

    for (const token of transresp.meta.postTokenBalances) {
        if (token.owner === wallet_address) {
            const start = transaction_changes[token.mint]?.start || 0;
            const change = Number(token.uiTokenAmount.amount) - Number(start);
            transaction_changes[token.mint] = {
                ...transaction_changes[token.mint],
                end: token.uiTokenAmount.amount,
                change: change
            };
        }
    }

    return transaction_changes;
};

const checktrans = async (txid, wallet_address) => {
    try {
        const transresp = await checkTransactionStatus(txid, wallet_address);

        if (transresp) {
            if (transresp.meta?.status?.Err) {
                // Failed Transaction
                return [transresp.meta.status.err, 2];
            }

            if (!transresp.meta.postTokenBalances || transresp.meta.postTokenBalances.length === 0) {
                return [null, WAIT_ERROR_CODE];
            }

            const transaction_changes = parseTransactionBalances(transresp, wallet_address);
            return [transaction_changes, WAIT_SUCCESS_CODE];
        } else {
            // Transaction not found or error occurred
            return [null, WAIT_ERROR_CODE];
        }
    } catch (error) {
        console.error('Error checking transaction:', error);
        return [null, WAIT_ERROR_CODE];
    }
};

module.exports = { checktrans };
