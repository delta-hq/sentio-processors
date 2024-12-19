import { SuiChainId } from "@sentio/chain";
import { BigDecimal, BigInteger } from "@sentio/sdk";
import { SuiAddressContext, SuiAddressProcessor, SuiContext } from "@sentio/sdk/sui";
import { } from "@sentio/sdk/utils";
import {
    pool,
    tick,
    factory,
    config,
} from "./types/sui/0x1eabed72c53feb3805120a081dc15963c204dc8d091542592abaf7a35689b2fb.js";
import * as helper from "./utils/helper.js";
import { PoolInfo, PoolTokenState, UserPosition, UserState } from "./schema/store.js";
import { TypeDescriptor } from "@sentio/sdk/move";

import { SuiObjectChange } from "@mysten/sui/client"
import { SuiGlobalProcessor, SuiNetwork, SuiObjectChangeContext, SuiObjectTypeProcessor, SuiObjectProcessor } from "@sentio/sdk/sui"
import { TickMath } from "@cetusprotocol/cetus-sui-clmm-sdk";


/***************************************************
      Protocol configuration
***************************************************/
type ProtocolConfigType = {
    network: SuiChainId,
    address: string,
    checkpoiont: bigint
};
const protocolConfig: ProtocolConfigType = {
    network: SuiChainId.SUI_MAINNET,
    address: "0x1eabed72c53feb3805120a081dc15963c204dc8d091542592abaf7a35689b2fb",
    checkpoiont: 1500000n
};
const PROTOCOLS = new Set<ProtocolConfigType>(
    [protocolConfig]
)

/***************************************************
      Snapshot processing functions 
***************************************************/
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

                ctx.eventLogger.emit("PoolSnaphot", {
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
                poolState.token_amount = BigDecimal(0);
                poolState.token_amount_usd = BigDecimal(0);
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

async function createPoolSnapshots(ctx: SuiAddressContext) {
    const poolTokenStates = await ctx.store.list(PoolTokenState, []);
    const newPoolTokenStates = await Promise.all(
        poolTokenStates.map((poolTokenState) =>
            createPoolTokenSnapshot(ctx, poolTokenState)
        )
    );
    await ctx.store.upsert(newPoolTokenStates);
}


/***************************************************
        Pool created event handler
***************************************************/
const poolCreatedEventHandler = async (event: factory.CreatePoolEventInstance, ctx: SuiContext) => {
    const {
        pool_id,
        coin_type_a,
        coin_type_b,
        tick_spacing
    } = event.data_decoded

    console.log("Pool created", event);
    const token0 = `0x${coin_type_a}`;
    const token1 = `0x${coin_type_b}`;

    try {
        // create map object for the pool
        const poolInfo = await helper.getOrCreatePoolInfo(ctx, pool_id);

        // create an event for the pool and the token0
        ctx.eventLogger.emit("Pool", {
            pool_address: pool_id,
            timestamp: ctx.timestamp.getTime(),
            lp_token_address: pool_id, // the lp token address is the same as the pool addresss
            lp_token_symbol: "Cetus-LP", // hardcoded for Kriya
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
            lp_token_symbol: "Kriya-V3-LP", // hardcoded for Kriya
            token_address: token1,
            token_symbol: poolInfo.symbol_1,
            token_decimals: poolInfo.decimals_1,
            token_index: 1,
            fee_rate: poolInfo.fee_rate, //TODO: ADD FEE RATE
            dex_type: "clmm",
        });

        // create snapshot for the pool
        await helper.createPoolTokenState(ctx, pool_id, token0, 0, poolInfo.symbol_0, poolInfo.fee_rate);
        await helper.createPoolTokenState(ctx, pool_id, token1, 1, poolInfo.symbol_1, poolInfo.fee_rate);

    } catch (error) {
        console.log("Error getting pool info", error);
        throw error;
    }
};

/***************************************************
            Trade event handler
***************************************************/
const swapEventHandler = async (event: pool.SwapEventInstance, ctx: SuiContext) => {
    const {
        atob,
        pool,
        amount_in,
        amount_out,
        fee_amount,
        ref_amount,
        after_sqrt_price,

    } = event.data_decoded;

    // get the pool info
    const poolInfo = await helper.getOrCreatePoolInfo(ctx, pool);

    // get the price of the tokens
    const price0 = await helper.getTokenPrice(ctx, poolInfo.token_0);
    const price1 = await helper.getTokenPrice(ctx, poolInfo.token_1);

    // calculate the amount in and out
    let rawAmount0 = atob ? amount_in : amount_out;
    let rawAmount1 = atob ? amount_out : amount_in;
    const amount0 = rawAmount0.scaleDown(poolInfo.decimals_0);
    const amount1 = rawAmount1.scaleDown(poolInfo.decimals_1);

    // get sender
    const sender = ctx.transaction.transaction?.data.sender;

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
            fees_usd: fee_amount.scaleDown(18).multipliedBy(price0), //TODO: Check what token the fee is in
        });
        // update current tick index
        try {
            poolInfo.current_tick = after_sqrt_price.asBigDecimal();
            await ctx.store.upsert(poolInfo);
        } catch (error) {
            console.error(`Failed to update current tick for ${pool}`, error);
        }

        // update the token balances in the pool state
        await helper.updatePoolTokenState(ctx, pool, poolInfo.token_0, poolInfo.decimals_0, rawAmount0, atob ? "add" : "remove");
        await helper.updatePoolTokenState(ctx, pool, poolInfo.token_1, poolInfo.decimals_1, rawAmount1, atob ? "remove" : "add");
    } else {
        console.log("Pool info not found", pool);
    }
};


/***************************************************
            Add liquidity event handler
***************************************************/
const addLiquidityEventHandler = async (event: pool.AddLiquidityEventInstance, ctx: SuiContext) => {
    const {
        pool,
        position,
        tick_lower,
        tick_upper,
        amount_a,
        amount_b,
        liquidity,
        after_liquidity
    } = event.data_decoded;

    console.log("Add Liquidity", event);

    const poolInfo = await helper.getOrCreatePoolInfo(ctx, pool);
    const sender = ctx.transaction.transaction?.data.sender;

    ctx.eventLogger.emit("LPMint", {
        timestamp: ctx.timestamp.getTime(),
        transaction_from_address: sender,
        event_address: "mint",
        pool_address: pool,
        tick_lower: Number(tick_lower.bits),
        tick_upper: Number(tick_upper.bits),
        current_tick: poolInfo.current_tick,
        tick_spacing: poolInfo.tick_spacing,
        nft_token_id: pool,
        token0_address: poolInfo.token_0,
        token0_amount: amount_a,
        token1_address: poolInfo.token_1,
        token1_amount: amount_b,
        token_fees: 0,
        amount_liq: liquidity,
    });

    // update user position
    await helper.updateUserPosition(ctx, poolInfo, position, sender, ctx.timestamp.getTime(), "add", pool, amount_a, amount_b, tick_lower, tick_upper, liquidity);

    // update pool token state
    await helper.updatePoolTokenState(ctx, pool, poolInfo.token_0, poolInfo.decimals_0, amount_a, "add");
    await helper.updatePoolTokenState(ctx, pool, poolInfo.token_1, poolInfo.decimals_1, amount_b, "add");
};


/***************************************************
            Remove liquidity event handler 
***************************************************/
const removeLiquidityEventHandler = async (event: pool.RemoveLiquidityEventInstance, ctx: SuiContext) => {
    const {
        pool,
        position,
        tick_lower,
        tick_upper,
        amount_a,
        amount_b,
        liquidity,
        after_liquidity,
    } = event.data_decoded;

    console.log("Remove Liquidity", event);

    const poolInfo = await helper.getOrCreatePoolInfo(ctx, pool);
    const sender = ctx.transaction.transaction?.data.sender;

    ctx.eventLogger.emit("LPBurn", {
        timestamp: ctx.timestamp.getTime(),
        transaction_from_address: sender,
        event_address: "burn",
        pool_address: pool,
        tick_lower: Number(tick_lower.bits),
        tick_upper: Number(tick_upper.bits),
        current_tick: poolInfo.current_tick,
        tick_spacing: poolInfo.tick_spacing,
        nft_token_id: pool,
        token0_address: poolInfo.token_0,
        token0_amount: amount_a,
        token1_address: poolInfo.token_1,
        token1_amount: amount_b,
        token_fees: 0,
        amount_liq: liquidity,
    });

    // create UserState for this
    await helper.updateUserPosition(ctx, poolInfo, position, sender, ctx.timestamp.getTime(), "remove", pool, amount_a, amount_b, tick_lower, tick_upper, liquidity);

    // update pool token state
    await helper.updatePoolTokenState(ctx, pool, poolInfo.token_0, poolInfo.decimals_0, amount_a, "remove");
    await helper.updatePoolTokenState(ctx, pool, poolInfo.token_1, poolInfo.decimals_1, amount_b, "remove");
};

/***************************************************
            Fee change event handler
***************************************************/
const feeChangeEventHandler = async (event: pool.UpdateFeeRateEventInstance, ctx: SuiContext) => {
    const {
        pool,
        old_fee_rate,
        new_fee_rate,
    } = event.data_decoded;
    try {
        let poolFee = await helper.getOrCreatePoolInfo(ctx, pool);
        poolFee.fee_rate = new_fee_rate.asBigDecimal();
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
async function processUserState(ctx: SuiAddressContext, userState: UserState) {
    try {
        const userPositions = await ctx.store.list(UserPosition, [
            {
                field: "user_address",
                op: "=",
                value: userState.user,
            },
        ]);
        console.log("User positions", userPositions);
        // process all positions of the user
        let scores = new Map<string, BigDecimal>();

        for (const position of userPositions) {
            const poolInfo = await helper.getOrCreatePoolInfo(ctx, position.pool_address);
            if (!scores.has(poolInfo.id.toString())) {
                scores.set(poolInfo.id.toString(), BigDecimal(0));
            }

            // TODO: Check the conversion for tick values
            if (poolInfo.current_tick.lte(position.upper_tick.asBigDecimal()) && poolInfo.current_tick.gte(position.lower_tick.asBigDecimal())) {
                scores.set(poolInfo.id.toString(), scores.get(poolInfo.id.toString()).plus(position.amount_usd));
            }
        }

        // emit the events for each user - pool pair
        scores.forEach(async (score, poolAddress) => {
            ctx.eventLogger.emit("UserScoreSnapshot", {
                timestamp: ctx.timestamp.getTime(),
                user_address: userState.user,
                pool_address: poolAddress,
                total_value_locked_score: score,
                market_depth_score: 0,
            });
        });

    } catch (error) {
        console.error("Failed to get user positions", error);
    }
}
async function createUserScoreSnapshots(ctx: SuiAddressContext) {
    const userStates = await ctx.store.list(UserState, []);
    console.log("User states", userStates);
    // process each user state
    await Promise.all([...userStates.map(async (userState) => {
        await processUserState(ctx, userState)
    })]);
}

/***************************************************
    Add event handlers for each chain-address pair
***************************************************/
PROTOCOLS.forEach((protocol) => {
    SuiAddressProcessor.bind({
        address: protocol.address,
        network: protocol.network,
        startCheckpoint: protocol.checkpoiont,
    }).onTimeInterval(async (_, ctx) => {
        await createPoolSnapshots(ctx);
        await createUserScoreSnapshots(ctx);
    }, 24 * 60, 24 * 60);

    factory.bind({
        address: protocol.address,
        network: protocol.network,
        startCheckpoint: protocol.checkpoiont,
    }).onEventCreatePoolEvent(poolCreatedEventHandler);

    pool.bind({
        address: protocol.address,
        network: protocol.network,
        startCheckpoint: protocol.checkpoiont,
    }).onEventAddLiquidityEvent(addLiquidityEventHandler)
        .onEventRemoveLiquidityEvent(removeLiquidityEventHandler)
        .onEventSwapEvent(swapEventHandler)
        .onEventUpdateFeeRateEvent(feeChangeEventHandler);
});

/***************************************************
    Add event handlers for all pools
***************************************************/
SuiObjectTypeProcessor.bind({
    objectType: factory.Pools.type(),
}).
    onObjectChange(transferEventHandler);