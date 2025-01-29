import { SuiChainId } from "@sentio/chain";
import { BigDecimal, BigInteger } from "@sentio/sdk";
import { SuiAddressContext, SuiAddressProcessor, SuiContext, SuiObjectContext, TypedSuiMoveObject, SuiWrappedObjectProcessor } from "@sentio/sdk/sui";
import { } from "@sentio/sdk/utils";
import {
    pool, pool_manager
} from "./types/sui/0x25929e7f29e0a30eb4e692952ba1b5b65a3a4d65ab5f2a32e1ba3edcb587f26d.js";
import * as helper from "./utils/helper.js";
import { PoolInfo, PoolTokenState, UserPosition, UserState, UserPool } from "./schema/store.js";
import { TypeDescriptor } from "@sentio/sdk/move";

import { SuiObjectChange } from "@mysten/sui/client"
import { SuiGlobalProcessor, SuiNetwork, SuiObjectChangeContext, SuiObjectTypeProcessor, SuiObjectProcessor } from "@sentio/sdk/sui"
import { SuiMoveObject } from "@mysten/sui.js/client";


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
    address: "0x25929e7f29e0a30eb4e692952ba1b5b65a3a4d65ab5f2a32e1ba3edcb587f26d",
    checkpoint: 33580300n //98392410n 
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

            const rawToken0 = poolObjDecoded.data_decoded.coin_a;
            const price0 = await helper.getTokenPrice(ctx, poolInfo.token_0);
            const token0 = BigInt(rawToken0).scaleDown(poolInfo.decimals_0);

            ctx.eventLogger.emit("PoolSnapshot", {
                timestamp: ctx.timestamp,
                pool_address: poolInfo.id.toString(),
                token_address: poolInfo.token_0,
                token_symbol: poolInfo.symbol_0,
                token_amount: token0,
                token_amount_usd: token0.multipliedBy(price0),
                volume_amount: BigDecimal(0),
                volume_usd: BigDecimal(0),
                fee_rate: poolInfo.fee_rate,
                total_fees_usd: BigDecimal(0),
                user_fees_usd: BigDecimal(0),
                protocol_fees_usd: BigDecimal(0),
            });

            const rawToken1 = poolObjDecoded.data_decoded.coin_b;
            const price1 = await helper.getTokenPrice(ctx, poolInfo.token_1);
            const token1 = BigInt(rawToken1).scaleDown(poolInfo.decimals_1);

            ctx.eventLogger.emit("PoolSnapshot", {
                timestamp: ctx.timestamp,
                pool_address: poolInfo.id.toString(),
                token_address: poolInfo.token_1,
                token_symbol: poolInfo.symbol_1,
                token_amount: token1,
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

async function createPoolTokenSnapshot(ctx: SuiAddressContext, poolState: PoolTokenState): Promise<PoolTokenState> {
    // Add your processing logic here

    try {
        console.log("Snapshot for poolState", poolState.id);
        const obj = await ctx.client.getObject({
            id: poolState.pool_address,
            options: { showType: true, showContent: true },
        });
        if (obj && obj.data.content.dataType == "moveObject") {
            try {
                // get the pool info and fee
                const poolInfo = await helper.getOrCreatePoolInfo(ctx, poolState.pool_address);

                const isToken0 = poolInfo.token_0 == poolState.token_address;

                console.log("Snapshot poolState with poolInfo", poolInfo);

                const currentTokenAmountRaw = isToken0 ? (obj.data.content.fields as any).coin_a : (obj.data.content.fields as any).coin_b;
                const price = await helper.getTokenPrice(ctx, poolState.token_address);
                const currentTokenAmount = BigInt(currentTokenAmountRaw).scaleDown(isToken0 ? poolInfo.decimals_0 : poolInfo.decimals_1);

                ctx.eventLogger.emit("PoolSnapshot", {
                    timestamp: ctx.timestamp,
                    pool_address: poolState.pool_address,
                    token_address: poolState.token_address,
                    token_symbol: poolState.token_symbol,
                    token_amount: currentTokenAmount,
                    token_amount_usd: currentTokenAmount.multipliedBy(price),
                    volume_amount: poolState.volume_amount,
                    volume_usd: poolState.volume_usd,
                    fee_rate: poolInfo.fee_rate,
                    total_fees_usd: BigDecimal(0),
                    user_fees_usd: BigDecimal(0),
                    protocol_fees_usd: BigDecimal(0),
                });

                // reset the token amount and volume
                poolState.volume_amount = BigDecimal(0);
                poolState.volume_usd = BigDecimal(0);
            }
            catch (error) {
                console.error("Failed to create Snapshot", error);
            }
        }
    } catch (error) {
        console.error("Failed to get pool info", error);
    }

    return poolState;
}

/***************************************************
        Pool created event handler
***************************************************/
const poolCreatedEventHandler = async (event: pool_manager.PoolCreatedInstance, ctx: SuiContext) => {
    const {
        sender,
        pool_id,
        coin_type_x,
        coin_type_y,
        fee_rate,
        tick_spacing
    } = event.data_decoded

    const coin_type_a = coin_type_x.name;
    const coin_type_b = coin_type_y.name;

    console.log("Pool created", event);
    const token0 = helper.getTokenAddressFromAddres(`0x${coin_type_a}`);
    const token1 = helper.getTokenAddressFromAddres(`0x${coin_type_b}`);

    try {
        // create map object for the pool
        const poolInfo = await helper.getOrCreatePoolInfo(ctx, pool_id);

        // create an event for the pool and the token0
        ctx.eventLogger.emit("Pool", {
            pool_address: pool_id,
            timestamp: ctx.timestamp.getTime(),
            lp_token_address: pool_id, // the lp token address is the same as the pool addresss
            lp_token_symbol: "Flow-LP", // hardcoded for Kriya
            token_address: token0,
            token_symbol: poolInfo.symbol_0,
            token_decimals: poolInfo.decimals_0,
            token_index: 0,
            fee_rate: poolInfo.fee_rate, //TODO: ADD FEE RATE
            dex_type: "clmm",
        });

        // create an event for the pool and the token1
        ctx.eventLogger.emit("Pool", {
            pool_address: pool_id,
            timestamp: ctx.timestamp.getTime(),
            lp_token_address: pool_id, // the lp token address is the same as the pool addresss
            lp_token_symbol: "Cetus-LP", // hardcoded for Kriya
            token_address: token1,
            token_symbol: poolInfo.symbol_1,
            token_decimals: poolInfo.decimals_1,
            token_index: 1,
            fee_rate: poolInfo.fee_rate, //TODO: ADD FEE RATE
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
const swapEventHandler = async (event: pool.SwapInstance, ctx: SuiContext) => {
    const {
        sender,
        x_for_y,
        pool_id,
        amount_x,
        amount_y,
        fee_amount,
        sqrt_price_after,
    } = event.data_decoded;

    // get the pool info
    const poolInfo = await helper.getOrCreatePoolInfo(ctx, pool_id);

    // get the price of the tokens
    const price0 = await helper.getTokenPrice(ctx, poolInfo.token_0);
    const price1 = await helper.getTokenPrice(ctx, poolInfo.token_1);

    const atob = x_for_y;

    // calculate the amount in and out
    let rawAmount0 = amount_x;
    let rawAmount1 = amount_y;
    const amount0 = rawAmount0.scaleDown(poolInfo.decimals_0);
    const amount1 = rawAmount1.scaleDown(poolInfo.decimals_1);

    if (poolInfo) {

        console.log("Trade", event);

        let user_address = sender;

        ctx.eventLogger.emit("Trade", {
            timestamp: ctx.timestamp.getTime(),
            user_address: user_address,
            taker_address: sender,
            maker_address: pool,
            pair_name: `${poolInfo.symbol_0}-${poolInfo.symbol_1}`,
            pool_address: pool,
            input_token_address: atob ? poolInfo.token_0 : poolInfo.token_1,
            input_token_symbol: atob ? poolInfo.symbol_0 : poolInfo.symbol_1,
            input_token_amount: atob ? amount0 : amount1,
            output_token_address: atob ? poolInfo.token_1 : poolInfo.token_0,
            output_token_symbol: atob ? poolInfo.symbol_1 : poolInfo.symbol_0,
            output_token_amount: atob ? amount1 : amount0,
            spot_price_after_swap: atob ? price1 : price0,
            swap_amount_usd: amount0.multipliedBy(price0),
            fees_usd: fee_amount.scaleDown(atob ? poolInfo.decimals_0 : poolInfo.decimals_1).multipliedBy(atob ? price0 : price1), // check if correct
        });
        // update current tick index
        try {
            poolInfo.current_tick = sqrt_price_after.asBigDecimal();
            await ctx.store.upsert(poolInfo);
        } catch (error) {
            console.error(`Failed to update current tick for ${pool}`, error);
        }

        // update the token balances in the pool state
        await helper.updatePoolTokenState(ctx, pool_id, poolInfo.token_0, poolInfo.decimals_0, rawAmount0, atob ? "add" : "remove");
        await helper.updatePoolTokenState(ctx, pool_id, poolInfo.token_1, poolInfo.decimals_1, rawAmount1, atob ? "remove" : "add");
    } else {
        console.log("Pool info not found", pool);
    }
};


/***************************************************
            Add liquidity event handler
***************************************************/
const addLiquidityEventHandler = async (event: pool.ModifyLiquidityInstance, ctx: SuiContext) => {
    const {
        sender,
        pool_id,
        position_id,
        tick_lower_index,
        tick_upper_index,
        liquidity_delta,
        amount_x,
        amount_y
    } = event.data_decoded;

    console.log("Add Liquidity", event);

    const after_liquidity = BigInt(0); //TODO: FIX THIS

    const poolInfo = await helper.getOrCreatePoolInfo(ctx, pool_id);

    const tickLower = helper.getSqrtPriceFromTickIndex(tick_lower_index);
    const tickUpper = helper.getSqrtPriceFromTickIndex(tick_upper_index);

    ctx.eventLogger.emit("LPMint", {
        timestamp: ctx.timestamp,
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
        amount_liquidity: after_liquidity,
    });

    // update user position
    await helper.updateUserPosition(ctx, poolInfo, position_id, sender, ctx.timestamp.getTime(), "add", pool_id, amount_x, amount_y, tickLower, tickUpper, after_liquidity);

    // update pool token state
    await helper.updatePoolTokenState(ctx, pool_id, poolInfo.token_0, poolInfo.decimals_0, amount_x, "add");
    await helper.updatePoolTokenState(ctx, pool_id, poolInfo.token_1, poolInfo.decimals_1, amount_y, "add");
};


/***************************************************
            Remove liquidity event handler 
***************************************************/
const removeLiquidityEventHandler = async (event: pool.ModifyLiquidityInstance, ctx: SuiContext) => {
    const {
        sender,
        pool_id,
        position_id,
        tick_lower_index,
        tick_upper_index,
        liquidity_delta,
        amount_x,
        amount_y
    } = event.data_decoded;

    console.log("Remove Liquidity", event);

    const after_liquidity = BigInt(0); //TODO: FIX THIS

    const poolInfo = await helper.getOrCreatePoolInfo(ctx, pool_id);

    const tickLower = helper.getSqrtPriceFromTickIndex(tick_lower_index);
    const tickUpper = helper.getSqrtPriceFromTickIndex(tick_upper_index);

    ctx.eventLogger.emit("LPBurn", {
        timestamp: ctx.timestamp,
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
        amount_liquidity: after_liquidity,
    });

    // create UserState for this
    await helper.updateUserPosition(ctx, poolInfo, position_id, sender, ctx.timestamp.getTime(), "remove", pool_id, amount_x, amount_y, tickLower, tickUpper, after_liquidity);

    // update pool token state
    await helper.updatePoolTokenState(ctx, pool_id, poolInfo.token_0, poolInfo.decimals_0, amount_x, "remove");
    await helper.updatePoolTokenState(ctx, pool_id, poolInfo.token_1, poolInfo.decimals_1, amount_y, "remove");
};

/***************************************************
            Fee change event handler
***************************************************/
const feeChangeEventHandler = async (event: pool.SetProtocolFeeRateInstance, ctx: SuiContext) => {
    const {
        pool_id,
        protocol_fee_rate_x_new,
        protocol_fee_rate_y_new,
    } = event.data_decoded;
    try {
        let poolFee = await helper.getOrCreatePoolInfo(ctx, pool_id);
        poolFee.fee_rate_x = protocol_fee_rate_x_new.asBigDecimal();
        poolFee.fee_rate_y = protocol_fee_rate_x_new.asBigDecimal();
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
            User snapshot processing functions
***************************************************/
async function updateUserPoolData(ctx: SuiAddressContext, userPosition: UserPosition) {
    try {
        console.log("User position", userPosition);

        const poolInfo = await helper.getOrCreatePoolInfo(ctx, userPosition.pool_address);

        await helper.updateUserPool(ctx, poolInfo, userPosition.user_address, userPosition.lower_tick, userPosition.upper_tick, userPosition.liquidity);
    } catch (error) {
        console.error("Failed to get user positions", error);
    }
}

async function createUserSnapthots(ctx: SuiAddressContext) {
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


/***************************************************
    LP  Snapshot processing functions 
***************************************************/
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
    SuiAddressProcessor.bind({
        address: protocol.address,
        network: protocol.network,
        startCheckpoint: protocol.checkpoint,
    }).onTimeInterval(async (_, ctx) => {
        await createUserSnapthots(ctx);
    }, 24 * 60, 24 * 60);

    pool_manager.bind({
        address: protocol.address,
        network: protocol.network,
        startCheckpoint: protocol.checkpoint,
    }).onEventPoolCreated(poolCreatedEventHandler);

    pool.bind({
        address: protocol.address,
        network: protocol.network,
        startCheckpoint: protocol.checkpoint,
    }).onEventSetProtocolFeeRate(feeChangeEventHandler)
        .onEventSwap(swapEventHandler)
        .onEventModifyLiquidity(async (event: pool.ModifyLiquidityInstance, ctx: SuiContext) => {
            const deltaLiquidity = BigInt.asIntN(
                128,
                BigInt(event.data_decoded.liquidity_delta.bits)
            );
            if (deltaLiquidity > 0) {
                await addLiquidityEventHandler(event, ctx);
            } else {
                await removeLiquidityEventHandler(event, ctx);
            }
        });
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
