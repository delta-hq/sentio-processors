import { SuiChainId } from "@sentio/chain";
import { BigDecimal } from "@sentio/sdk";
import { SuiAddressContext, SuiAddressProcessor, SuiContext, SuiObjectContext, TypedSuiMoveObject, SuiWrappedObjectProcessor } from "@sentio/sdk/sui";
import {
    admin,
    create_pool,
    trade,
    liquidity,
    pool,
    tick,
} from "./types/sui/0xf6c05e2d9301e6e91dc6ab6c3ca918f7d55896e1f1edd64adc0e615cde27ebf1.js";
import * as helper from "./utils/helper.js";
import { PoolInfo, PoolTokenState, UserPosition, UserState, UserPool } from "./schema/store.js";


import { SuiObjectChange } from "@mysten/sui/client"
import { SuiGlobalProcessor, SuiNetwork, SuiObjectChangeContext, SuiObjectTypeProcessor, SuiObjectProcessor } from "@sentio/sdk/sui"


/***************************************************
      Protocol configuration
***************************************************/
type ProtocolConfigType = {
    network: SuiChainId,
    address: string,
    checkpoint: bigint
};
const protocolConfig: ProtocolConfigType = {
    network: SuiChainId.SUI_MAINNET,
    // address: "0xbd8d4489782042c6fafad4de4bc6a5e0b84a43c6c00647ffd7062d1e2bb7549e",
    address: "0xf6c05e2d9301e6e91dc6ab6c3ca918f7d55896e1f1edd64adc0e615cde27ebf1", // kriya-v5
    checkpoint: 38860558n
};
const PROTOCOLS = new Set<ProtocolConfigType>(
    [protocolConfig]
)

/***************************************************
      Pool snapshot processing functions 
***************************************************/
async function createPoolSnapshot(poolObjDecoded: any, ctx: SuiObjectContext): Promise<void> {
    // Add your processing logic here
    try {
        console.log("Snapshot for pool", poolObjDecoded);
        const poolAddress = ctx.objectId;
        try {
            // get the pool info and fee
            const poolInfo = await helper.getOrCreatePoolInfo(ctx, poolAddress);

            console.log("Snapshot for pool with poolInfo", poolInfo);

            const rawToken0 = poolObjDecoded.data_decoded.reserve_x;
            const price0 = await helper.getTokenPrice(ctx, poolInfo.token_0);
            const token0 = BigInt(rawToken0).scaleDown(poolInfo.decimals_0);

            ctx.eventLogger.emit("PoolSnapshot", {
                timestamp: ctx.timestamp,
                pool_address: poolInfo.id.toString(),
                token_address: poolInfo.token_0,
                token_symbol: poolInfo.symbol_0,
                token_amount: token0,
                token_price: price0,
                token_decimals: poolInfo.decimals_0,
                token_amount_usd: token0.multipliedBy(price0),
                volume_amount: BigDecimal(0),
                volume_usd: BigDecimal(0),
                fee_rate: poolInfo.fee_rate,
                total_fees_usd: BigDecimal(0),
                user_fees_usd: BigDecimal(0),
                protocol_fees_usd: BigDecimal(0),
            });

            const rawToken1 = poolObjDecoded.data_decoded.reserve_y;
            const price1 = await helper.getTokenPrice(ctx, poolInfo.token_1);
            const token1 = BigInt(rawToken1).scaleDown(poolInfo.decimals_1);

            ctx.eventLogger.emit("PoolSnapshot", {
                timestamp: ctx.timestamp,
                pool_address: poolInfo.id.toString(),
                token_address: poolInfo.token_1,
                token_symbol: poolInfo.symbol_1,
                token_amount: token1,
                token_price: price1,
                token_decimals: poolInfo.decimals_1,
                token_amount_usd: token1.multipliedBy(price1),
                volume_amount: BigDecimal(0),
                volume_usd: BigDecimal(0),
                fee_rate: poolInfo.fee_rate,
                total_fees_usd: BigDecimal(0),
                user_fees_usd: BigDecimal(0),
                protocol_fees_usd: BigDecimal(0),
            });
        }
        catch (error) {
            console.error("Failed to create Snapshot", error);
        }
    } catch (error) {
        console.error("Failed to get pool object details", error);
    }
}

/***************************************************
        Pool created event handler
***************************************************/
const poolCreatedEventHandler = async (event: create_pool.PoolCreatedEventInstance, ctx: SuiContext) => {
    const {
        sender,
        pool_id,
        type_x,
        type_y,
        fee_rate,
        tick_spacing
    } = event.data_decoded

    console.log("Pool created", event);
    const token0 = `0x${type_x.name}`;
    const token1 = `0x${type_y.name}`;

    try {
        // create map object for the pool
        const poolInfo = await helper.getOrCreatePoolInfo(ctx, pool_id);

        // create an event for the pool and the token0
        ctx.eventLogger.emit("Pool", {
            pool_address: pool_id,
            timestamp: ctx.timestamp.getTime(),
            lp_token_address: pool_id, // the lp token address is the same as the pool addresss
            lp_token_symbol: "Kriya-V3-LP", // hardcoded for Kriya
            token_address: token0,
            token_symbol: poolInfo.symbol_0,
            token_decimals: poolInfo.decimals_0,
            token_index: 0,
            fee_rate: fee_rate,
            dex_type: "clmm",
        });

        // create an event for the pool and the token1
        ctx.eventLogger.emit("Pool", {
            pool_address: pool_id,
            timestamp: ctx.timestamp.getTime(),
            lp_token_address: pool_id, // the lp token address is the same as the pool addresss
            lp_token_symbol: "Kriya-V3-LP", // hardcoded for Kriya
            token_address: token1,
            token_symbol: poolInfo.symbol_1,
            token_decimals: poolInfo.decimals_1,
            token_index: 1,
            fee_rate: fee_rate,
            dex_type: "clmm",
        });

        // create snapshot for the pool
        await helper.createPoolTokenState(ctx, pool_id, poolInfo.token_0, 0, poolInfo.symbol_0, poolInfo.fee_rate);
        await helper.createPoolTokenState(ctx, pool_id, poolInfo.token_1, 1, poolInfo.symbol_1, poolInfo.fee_rate);
    } catch (error) {
        console.log("Error getting pool info", error);
        throw error;
    }
};

/***************************************************
            Trade event handler
***************************************************/
const swapEventHandler = async (event: trade.SwapEventInstance, ctx: SuiContext) => {
    const {
        sender,
        pool_id,
        x_for_y,
        amount_x,
        amount_y,
        sqrt_price_before,
        sqrt_price_after,
        liquidity,
        tick_index,
        fee_amount,
        protocol_fee,
        reserve_x,
        reserve_y,
    } = event.data_decoded;

    // get the pool info
    const poolInfo = await helper.getOrCreatePoolInfo(ctx, pool_id);

    // get the price of the tokens
    const price0 = await helper.getTokenPrice(ctx, poolInfo.token_0);
    const price1 = await helper.getTokenPrice(ctx, poolInfo.token_1);

    // calculate the amount in and out.
    let rawAmount0 = amount_x;
    let rawAmount1 = amount_y;
    const amount0 = amount_x.scaleDown(poolInfo.decimals_0);
    const amount1 = amount_y.scaleDown(poolInfo.decimals_1);

    if (poolInfo) {

        console.log("Trade", event);

        let user_address = sender;
        let signatures = ctx.transaction.transaction?.txSignatures;
        if (signatures && signatures.length > 0) {
            user_address = signatures[0];
        }

        ctx.eventLogger.emit("Trade", {
            timestamp: ctx.timestamp.getTime(),
            user_address: user_address,
            taker_address: sender,
            maker_address: pool_id,
            pair_name: `${poolInfo.symbol_0}-${poolInfo.symbol_1}`,
            pool_address: pool_id,
            input_token_address: x_for_y ? poolInfo.token_0 : poolInfo.token_1,
            input_token_symbol: x_for_y ? poolInfo.symbol_0 : poolInfo.symbol_1,
            input_token_amount: x_for_y ? amount0 : amount1,
            output_token_address: x_for_y ? poolInfo.token_1 : poolInfo.token_0,
            output_token_symbol: x_for_y ? poolInfo.symbol_1 : poolInfo.symbol_0,
            output_token_amount: x_for_y ? amount1 : amount0,
            spot_price_after_swap: x_for_y ? price1 : price0,
            swap_amount_usd: amount0.multipliedBy(price0),
            fees_usd: fee_amount.scaleDown(18).multipliedBy(price0), //TODO: Check what token the fee is in
        });
        // update current tick index
        try {
            poolInfo.current_tick = sqrt_price_after.asBigDecimal();
            ctx.eventLogger.emit("Tick", {
                timestamp: ctx.timestamp.getTime(),
                pool_address: pool_id,
                tick: sqrt_price_after
            });
            await ctx.store.upsert(poolInfo);
        } catch (error) {
            console.error(`Failed to update PoolFee for ${pool_id}`, error);
        }

        // update the token balances in the pool state
        await helper.updatePoolTokenState(ctx, pool_id, poolInfo.token_0, poolInfo.decimals_0, rawAmount0, atob ? "add" : "remove");
        await helper.updatePoolTokenState(ctx, pool_id, poolInfo.token_1, poolInfo.decimals_1, rawAmount1, atob ? "remove" : "add");
    } else {
        // calculates the pool volume

        console.log("Pool info not found", pool_id);
    }
};


/***************************************************
            Add liquidity event handler
***************************************************/
const addLiquidityEventHandler = async (event: liquidity.AddLiquidityEventInstance, ctx: SuiContext) => {
    const {
        sender,
        pool_id,
        position_id,
        liquidity,
        amount_x,
        amount_y,
        upper_tick_index,
        lower_tick_index,
        reserve_x,
        reserve_y,
    } = event.data_decoded;

    console.log("Add Liquidity", event);

    const poolInfo = await helper.getOrCreatePoolInfo(ctx, pool_id);

    const tickLower = helper.getSqrtPriceFromTickIndex(lower_tick_index);
    const tickUpper = helper.getSqrtPriceFromTickIndex(upper_tick_index);

    ctx.eventLogger.emit("LPMint", {
        timestamp: ctx.timestamp.getTime(),
        transaction_from_address: sender,
        event_address: "mint",
        pool_address: pool_id,
        tick_lower: tickLower,
        tick_upper: tickUpper,
        current_tick: poolInfo.current_tick,
        tick_spacing: poolInfo.tick_spacing,
        nft_token_id: pool_id,
        token0_address: poolInfo.token_0,
        token0_amount: amount_x,
        token1_address: poolInfo.token_1,
        token1_amount: amount_y,
        token_fees: 0,
        amount_liquidity: liquidity,
    });

    // update user position
    const userPosition = await helper.updateUserPosition(ctx, poolInfo, position_id, sender, ctx.timestamp.getTime(), "add", pool_id, amount_x, amount_y, tickLower, tickUpper, liquidity);

    // update pool token state
    await helper.updatePoolTokenState(ctx, pool_id, poolInfo.token_0, poolInfo.decimals_0, amount_x, "add");
    await helper.updatePoolTokenState(ctx, pool_id, poolInfo.token_1, poolInfo.decimals_1, amount_y, "add");
};


/***************************************************
            Remove liquidity event handler 
***************************************************/
const removeLiquidityEventHandler = async (event: liquidity.RemoveLiquidityEventInstance, ctx: SuiContext) => {
    const {
        sender,
        pool_id,
        position_id,
        liquidity,
        amount_x,
        amount_y,
        upper_tick_index,
        lower_tick_index,
        reserve_x,
        reserve_y,
    } = event.data_decoded;

    console.log("Remove Liquidity", event);

    const poolInfo = await helper.getOrCreatePoolInfo(ctx, pool_id);

    const tickLower = helper.getSqrtPriceFromTickIndex(lower_tick_index);
    const tickUpper = helper.getSqrtPriceFromTickIndex(upper_tick_index);

    ctx.eventLogger.emit("LPBurn", {
        timestamp: ctx.timestamp.getTime(),
        transaction_from_address: sender,
        event_address: "burn",
        pool_address: pool_id,
        tick_lower: tickLower,
        tick_upper: tickUpper,
        current_tick: poolInfo.current_tick,
        tick_spacing: poolInfo.tick_spacing,
        nft_token_id: pool_id,
        token0_address: poolInfo.token_0,
        token0_amount: amount_x,
        token1_address: poolInfo.token_1,
        token1_amount: amount_y,
        token_fees: 0,
        amount_liquidity: liquidity,
    });

    // create UserState for this
    await helper.updateUserPosition(ctx, poolInfo, position_id, sender, ctx.timestamp.getTime(), "remove", pool_id, amount_x, amount_y, tickLower, tickUpper, liquidity);

    // update pool token state
    await helper.updatePoolTokenState(ctx, pool_id, poolInfo.token_0, poolInfo.decimals_0, amount_x, "remove");
    await helper.updatePoolTokenState(ctx, pool_id, poolInfo.token_1, poolInfo.decimals_1, amount_y, "remove");
};

/***************************************************
            Fee change event handler
***************************************************/
const feeChangeEventHandler = async (event: admin.SetProtocolSwapFeeRateEventInstance, ctx: SuiContext) => {
    const {
        pool_id,
        protocol_fee_share_new,
        protocol_fee_share_old,
    } = event.data_decoded;
    try {
        let poolFee = await helper.getOrCreatePoolInfo(ctx, pool_id);
        poolFee.fee_rate = protocol_fee_share_new.asBigDecimal();
        await ctx.store.upsert(poolFee);
    } catch (error) {
        console.error("Failed to update fee rate", error);
    }
};


/***************************************************
            V3 transfer event handler
***************************************************/
const transferEventHandler = async (changes: SuiObjectChange[], ctx: SuiObjectChangeContext) => {
    console.log("Transfer event", changes);
    for (let change of changes) {
        if (change.type == 'transferred') {
            const { objectId, sender, recipient } = change;
            helper.updateUserPositionOwner(ctx, objectId, sender, recipient.toString());

            // emit event
            ctx.eventLogger.emit("Transfer", {
                timestamp: ctx.timestamp.getTime(),
                transaction_from_address: sender,
                nft_token_id: objectId,
                from_address: sender,
                to_address: recipient.toString(),
                event_type: "transfer",
            });
        }
    }
};

/***************************************************
            User score snapshot
***************************************************/
async function createUserSnapshots(ctx: SuiAddressContext) {
    const results = await ctx.store.list(UserPosition, []);

    console.log("User positions", results);
    // process each user state
    await Promise.all([...results.map(async (result) => {
        await updateUserPoolData(ctx, result);
    })]);

    // process for each user-ppol pair
    const users = await ctx.store.list(UserPool, []);
    await Promise.all([...users.map(async (user) => {
        await createUserSnapshot(ctx, user);
    })]);

    // clear each user-ppol pair
    await ctx.store.delete(UserPool, users.map((user) => user.id.toString()));
}

async function updateUserPoolData(ctx: SuiAddressContext, userPosition: UserPosition) {
    try {
        console.log("User position", userPosition);

        const poolInfo = await helper.getOrCreatePoolInfo(ctx, userPosition.pool_address);

        await helper.updateUserPool(ctx, poolInfo, userPosition.user_address, userPosition.lower_tick, userPosition.upper_tick, userPosition.liquidity);
    } catch (error) {
        console.error("Failed to get user positions", error);
    }
}

async function createUserSnapshot(ctx: SuiAddressContext, userPool: UserPool) {
    try {
        console.log("User pool", userPool);

        // get pool info
        const poolInfo = await helper.getOrCreatePoolInfo(ctx, userPool.pool_address);

        // ger price info
        const price1 = await helper.getTokenPrice(ctx, poolInfo.token_1);
        const price0 = await helper.getTokenPrice(ctx, poolInfo.token_0);

        // get decimal normalized values
        const TEN = new BigDecimal(10);
        const amount0 = userPool.amount_0.dividedBy(TEN.pow(poolInfo.decimals_0));
        const amount1 = userPool.amount_1.dividedBy(TEN.pow(poolInfo.decimals_1));
        const amount0InRange = userPool.amount_0_in_range.dividedBy(TEN.pow(poolInfo.decimals_0));
        const amount1InRange = userPool.amount_1_in_range.dividedBy(TEN.pow(poolInfo.decimals_1));

        // calculate the usd denominated values
        const amountUsd0 = amount0.multipliedBy(price0);
        const amountUsd1 = amount1.multipliedBy(price1);
        const amountUsd0InRange = amount0InRange.multipliedBy(price0);
        const amountUsd1InRange = amount1InRange.multipliedBy(price1);

        // create an event for the pool and the token0
        ctx.eventLogger.emit("LPSnapshot", {
            timestamp: ctx.timestamp,
            pool_address: userPool.pool_address,
            user_address: userPool.user_address,
            token_index: 0,
            token_address: poolInfo.token_0,
            token_symbol: poolInfo.symbol_0,
            token_amount: amount0,
            token_amount_usd: amountUsd0,
        });

        // create an event for the pool and the token1
        ctx.eventLogger.emit("LPSnapshot", {
            timestamp: ctx.timestamp,
            pool_address: userPool.pool_address,
            user_address: userPool.user_address,
            token_index: 1,
            token_address: poolInfo.token_1,
            token_symbol: poolInfo.symbol_1,
            token_amount: amount1,
            token_amount_usd: amountUsd1,
        });


        // emit the events for each user - pool pair
        ctx.eventLogger.emit("UserScoreSnapshot", {
            timestamp: ctx.timestamp,
            user_address: userPool.user_address,
            pool_address: userPool.pool_address,
            total_value_locked_score: amountUsd0InRange.plus(amountUsd1InRange),
            market_depth_score: 0,
        });

        // reset user-pool pair
        userPool.amount_0 = BigDecimal(0);
        userPool.amount_1 = BigDecimal(0);
        userPool.amount_0_in_range = BigDecimal(0);
        userPool.amount_1_in_range = BigDecimal(0);
        await ctx.store.upsert(userPool);
    } catch (error) {
        console.error("Failed to get user pool ", error);
    }
}

/***************************************************
    Add event handlers for each chain-address pair
***************************************************/
PROTOCOLS.forEach((protocol) => {
    // SuiAddressProcessor.bind({
    //     address: protocol.address,
    //     network: protocol.network,
    //     startCheckpoint: protocol.checkpoint,
    // }).onTimeInterval(async (_, ctx) => {
    //     await createUserSnapshots(ctx);
    // }, 24 * 60, 24 * 60);

    create_pool.bind({
        address: protocol.address,
        network: protocol.network,
        startCheckpoint: protocol.checkpoint,
    }).onEventPoolCreatedEvent(poolCreatedEventHandler);

    admin.bind({
        address: protocol.address,
        network: protocol.network,
        startCheckpoint: protocol.checkpoint,
    }).onEventSetProtocolSwapFeeRateEvent(feeChangeEventHandler);

    trade
        .bind({
            address: protocol.address,
            network: protocol.network,
            startCheckpoint: protocol.checkpoint,
        }).onEventSwapEvent(swapEventHandler);

    liquidity.bind({
        address: protocol.address,
        network: protocol.network,
        startCheckpoint: protocol.checkpoint,
    }).onEventAddLiquidityEvent(addLiquidityEventHandler)
        .onEventRemoveLiquidityEvent(removeLiquidityEventHandler);
});

/***************************************************
    Add event handlers for transfers for all pools
***************************************************/
SuiObjectTypeProcessor.bind({
    objectType: pool.Pool.type(),
}).onObjectChange(transferEventHandler);

/***************************************************
    Add snapshot for all pools
***************************************************/
SuiObjectTypeProcessor.bind({
    objectType: pool.Pool.type(),
}).onTimeInterval(async (self, _, ctx) => {
    if (!self) { return }
    console.log(`Pool Snapshot: ctx ${ctx.objectId} at ctx.timestamp ${ctx.timestamp}`)
    await createPoolSnapshot(self, ctx);
}, 24 * 60, 24 * 60);