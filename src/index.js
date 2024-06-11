#!/usr/bin/env node
"use strict";
const React = require("react");
const importJsx = require("import-jsx");
const { render } = require("ink");
const meow = require("meow");
const { checkForEnvFile, checkWallet, checkArbReady, logExit } = require("./utils");
const chalk = require("chalk");

// Ensure .env file is present
checkForEnvFile();

// Load environment variables from .env file
require("dotenv").config();

// Check wallet configuration
checkWallet();

const isArbReady = async () => {
    try {
        // Check if arbitrage is ready
        await checkArbReady();
        return true; // Return true if checkArbReady completes without errors
    } catch (error) {
        // Display error message and exit process
        console.error(chalk.black.bgRedBright(`\n${error.message}\n`));
        logExit(1, error);
        process.exit(1);
    }
};

// Check if arbitrage is ready and proceed if true
isArbReady().then((arbReady) => {
    if (!arbReady) {
        process.exit(1); // Exit if ARB is not ready
    }
});

// Import and render the wizard component
const wizard = importJsx("./wizard/index");

const cli = meow(`
    Usage
      $ solana-jupiter-bot

    Options
        --name  Your name

    Examples
      $ solana-jupiter-bot --name=Jane
      Hello, Master
`);

console.clear();

// Render the React component and wait until it exits
render(React.createElement(wizard, cli.flags)).waitUntilExit();
