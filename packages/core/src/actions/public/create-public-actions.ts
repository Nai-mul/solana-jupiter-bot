import { createStore } from "../../store";
import { createSetStatus } from "./create-set-status";
import { createAggregators as createAggregators } from "./create-aggregators";
import { CreateBotParams } from "src/bot";
import { initialState } from "src/store/initial-state";
import { createOnStatusChange } from "./on-status-change";
import { createBlockchainDataProviders } from "./create-blockchain-data-providers";
import { createReporters } from "./create-reporters";
import { createLimiters } from "./create-limiters";
import { logger } from "src/logger";

export const createPublicActions = (params: CreateBotParams) => {
	const store = createStore(initialState);
	const setStatus = createSetStatus(store);

	const publicActions = {
		logger,
		store,
		setStatus,
		onStatusChange: createOnStatusChange(store),
		aggregators: createAggregators(params.aggregators, store, logger),
		dataProviders: createBlockchainDataProviders(params.dataProviders),
		...createReporters(store, logger),
		limiters: createLimiters(store, params.config),
	};

	return {
		...publicActions,
	};
};
