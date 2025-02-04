import { SuiChainId } from "@sentio/chain";
import { BigDecimal, BigInteger } from "@sentio/sdk";
import { SuiAddressContext, SuiAddressProcessor, SuiContext, SuiObjectContext } from "@sentio/sdk/sui";
import {
    pool,
    pool_factory,
    events
} from "./types/sui/0xefe170ec0be4d762196bedecd7a065816576198a6527c99282a2551aaa7da38c.js";
import {
    pool as poolV2,
    pool_factory as pool_factoryV2,
    events as eventsV2
} from "./types/sui/0xc4049b2d1cc0f6e017fda8260e4377cecd236bd7f56a54fee120816e72e2e0dd.js"; //V2
import * as helper from "./utils/helper.js";
import { PoolInfo, PoolTokenState, UserPosition, UserState, UserPool } from "./schema/store.js";

import { SuiObjectChange } from "@mysten/sui/client"
import { SuiGlobalProcessor, SuiNetwork, SuiObjectChangeContext, SuiObjectTypeProcessor } from "@sentio/sdk/sui"
import { _0x1 } from "@sentio/sdk/aptos/builtin";
import { isObject } from "util";
import { is } from "@mysten/sui.js/utils";


/***************************************************
      Protocol configuration
***************************************************/
type ProtocolConfigType = {
    network: SuiChainId,
    address: string,
    checkpoint: bigint
};
const protocolConfigV1: ProtocolConfigType = {
    network: SuiChainId.SUI_MAINNET,
    address: "0xefe170ec0be4d762196bedecd7a065816576198a6527c99282a2551aaa7da38c",
    checkpoint: 6824040n
};
const protocolConfigV2: ProtocolConfigType = {
    network: SuiChainId.SUI_MAINNET,
    address: "0xc4049b2d1cc0f6e017fda8260e4377cecd236bd7f56a54fee120816e72e2e0dd",
    checkpoint: 34323969n
};
const PROTOCOLS = new Set<ProtocolConfigType>(
    [protocolConfigV1, protocolConfigV2]
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

            for (let i = 0; i < poolInfo.tokens.length; i++) {
                const rawToken = poolObjDecoded.data_decoded.normalized_balances[i];
                const price = await helper.getTokenPrice(ctx, poolInfo.tokens[i]);
                const tokenAmount = BigInt(rawToken).scaleDown(poolInfo.decimals[i]);

                ctx.eventLogger.emit("PoolSnapshot", {
                    timestamp: ctx.timestamp,
                    pool_address: poolInfo.id.toString(),
                    token_address: poolInfo.tokens[i],
                    token_symbol: poolInfo.symbols[i],
                    token_amount: tokenAmount,
                    token_price: price,
                    token_decimals: poolInfo.decimals[i],
                    token_amount_usd: tokenAmount.multipliedBy(price),
                    volume_amount: BigDecimal(0),
                    volume_usd: BigDecimal(0),
                    fee_rate: BigDecimal(0),
                    total_fees_usd: BigDecimal(0),
                    user_fees_usd: BigDecimal(0),
                    protocol_fees_usd: BigDecimal(0),
                });
            }
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
const poolCreatedEventHandler = async (event: events.CreatedPoolEventInstance | eventsV2.CreatedPoolEventInstance, ctx: SuiContext) => {
    const {
        pool_id,
        name,
        creator,
        lp_type,
        coins,
        weights,
        flatness,
        fees_swap_in,
        fees_swap_out,
        fees_deposit,
        fees_withdraw,
    } = event.data_decoded

    console.log("Pool created", event);

    try {
        // create map object for the pool
        const poolInfo = await helper.getOrCreatePoolInfo(ctx, pool_id);
        console.log("Pool info", poolInfo);

        for (let i = 0; i < poolInfo.tokens.length; i++) {

            ctx.eventLogger.emit("Pool", {
                pool_address: pool_id,
                timestamp: ctx.timestamp.getTime(),
                lp_token_address: lp_type, // the lp token address is the same as the pool addresss
                lp_token_symbol: "AfterMath-LP", // hardcoded 
                token_address: poolInfo.tokens[i],
                token_symbol: poolInfo.symbols[i],
                token_decimals: poolInfo.decimals[i],
                token_index: i,
                fee_rate: fees_swap_in[i], //TODO: ADD FEE RATE
                dex_type: "amm",
            });
        }
        // create an event for the pool and the token0



        // create snapshot for the pool
        // await helper.createPoolTokenState(ctx, pool_id, poolInfo.token_0, 0, poolInfo.symbol_0, poolInfo.fee_rate);
        // await helper.createPoolTokenState(ctx, pool_id, poolInfo.token_1, 1, poolInfo.symbol_1, poolInfo.fee_rate);

    } catch (error) {
        console.log("Error getting pool info", error);
        throw error;
    }
};

/***************************************************
            Trade event handler
***************************************************/
const swapEventHandler = async (event: events.SwapEventInstance | eventsV2.SwapEventInstance, ctx: SuiContext) => {
    const {
        pool_id,
        issuer,
        referrer,
        types_in,
        amounts_in,
        types_out,
        amounts_out,
    } = event.data_decoded;

    // // get the pool info
    const poolInfo = await helper.getOrCreatePoolInfo(ctx, pool_id);

    // // get the price of the tokens
    // const price0 = await helper.getTokenPrice(ctx, poolInfo.token_0);
    // const price1 = await helper.getTokenPrice(ctx, poolInfo.token_1);

    // const atob = a_to_b;

    // // calculate the amount in and out
    // let rawAmount0 = amount_a;
    // let rawAmount1 = amount_b;
    // const amount0 = rawAmount0.scaleDown(poolInfo.decimals_0);
    // const amount1 = rawAmount1.scaleDown(poolInfo.decimals_1);

    // if (poolInfo) {

    console.log("Trade", event);

    // let user_address = recipient;

    // ctx.eventLogger.emit("Trade", {
    //     timestamp: ctx.timestamp.getTime(),
    //     user_address: user_address,
    //     taker_address: recipient,
    //     maker_address: pool,
    //     pair_name: `${poolInfo.symbol_0}-${poolInfo.symbol_1}`,
    //     pool_address: pool,
    //     input_token_address: atob ? poolInfo.token_0 : poolInfo.token_1,
    //     input_token_symbol: atob ? poolInfo.symbol_0 : poolInfo.symbol_1,
    //     input_token_amount: atob ? amount0 : amount1,
    //     output_token_address: atob ? poolInfo.token_1 : poolInfo.token_0,
    //     output_token_symbol: atob ? poolInfo.symbol_1 : poolInfo.symbol_0,
    //     output_token_amount: atob ? amount1 : amount0,
    //     spot_price_after_swap: atob ? price1 : price0,
    //     swap_amount_usd: amount0.multipliedBy(price0),
    //     fees_usd: fee_amount.scaleDown(atob ? poolInfo.decimals_0 : poolInfo.decimals_1).multipliedBy(atob ? price0 : price1), // check if correct
    // });
    // // update current tick index
    // try {
    //     poolInfo.current_tick = sqrt_price;
    //     ctx.eventLogger.emit("Tick", {
    //         timestamp: ctx.timestamp.getTime(),
    //         pool_address: pool,
    //         tick: sqrt_price
    //     });
    //     await ctx.store.upsert(poolInfo);
    // } catch (error) {
    //     console.error(`Failed to update current tick for ${pool}`, error);
    // }

    // // update the token balances in the pool state
    // await helper.updatePoolTokenState(ctx, pool, poolInfo.token_0, poolInfo.decimals_0, rawAmount0, atob ? "add" : "remove");
    // await helper.updatePoolTokenState(ctx, pool, poolInfo.token_1, poolInfo.decimals_1, rawAmount1, atob ? "remove" : "add");
    // } else {
    //     console.log("Pool info not found", pool);
    // }
};


/***************************************************
            Add liquidity event handler
***************************************************/
const addLiquidityEventHandler = async (event: events.DepositEventInstance | eventsV2.DepositEventInstance, ctx: SuiContext) => {
    const {
        pool_id,
        issuer,
        referrer,
        types,
        deposits,
        lp_coins_minted,
    } = event.data_decoded;

    console.log("Add Liquidity", event);
    try {

        const poolInfo = await helper.getOrCreatePoolInfo(ctx, pool_id);

        for (let i = 0; i < types.length; i++) {
            const j = poolInfo.tokens.indexOf(types[i]);

            const rawAmount = deposits[i];
            const amount = rawAmount.scaleDown(poolInfo.decimals[j]);

            const price = await helper.getTokenPrice(ctx, poolInfo.tokens[j]);

            ctx.eventLogger.emit("LiquidityEvent", {
                timestamp: ctx.timestamp.getTime(),
                lp_coins_minted: lp_coins_minted,
                user_address: issuer,
                taker_address: issuer,
                pool_address: pool_id,
                token_address: poolInfo.tokens[i],
                token_index: j,
                token_amount: amount,
                token_amount_usd: amount.multipliedBy(price),
                event_type: "deposit",
            });
        }
    } catch (error) {
        console.error("Failed to add liquidity", error);
    }
};


/***************************************************
            Remove liquidity event handler 
***************************************************/
const removeLiquidityEventHandler = async (event: events.WithdrawEventInstance | eventsV2.WithdrawEventInstance, ctx: SuiContext) => {
    const {
        pool_id,
        issuer,
        referrer,
        types,
        withdrawn,
        lp_coins_burned,
    } = event.data_decoded;

    console.log("Remove Liquidity", event);
    try {

        const poolInfo = await helper.getOrCreatePoolInfo(ctx, pool_id);

        for (let i = 0; i < types.length; i++) {
            const j = poolInfo.tokens.indexOf(types[i]);

            const rawAmount = withdrawn[i];
            const amount = rawAmount.scaleDown(poolInfo.decimals[j]);

            const price = await helper.getTokenPrice(ctx, poolInfo.tokens[j]);

            ctx.eventLogger.emit("LiquidityEvent", {
                timestamp: ctx.timestamp.getTime(),
                lp_coins_minted: lp_coins_burned,
                user_address: issuer,
                taker_address: issuer,
                pool_address: pool_id,
                token_address: poolInfo.tokens[i],
                token_index: j,
                token_amount: amount,
                token_amount_usd: amount.multipliedBy(price),
                event_type: "deposit",
            });
        }
    } catch (error) {
        console.error("Failed to remove liquidity", error);
    }

};

/***************************************************
            Fee change event handler
***************************************************/
// const feeChangeEventHandler = async (event: pool.UpdatePoolFeeProtocolEventInstance, ctx: SuiContext) => {
//     const {
//         pool,
//         fee_protocol
//     } = event.data_decoded;
//     try {
//         let poolFee = await helper.getOrCreatePoolInfo(ctx, pool);
//         poolFee.fee_rate = BigInt(fee_protocol);
//         await ctx.store.upsert(poolFee);
//     } catch (error) {
//         console.error("Failed to update fee rate", error);
//     }
// };


/***************************************************
            User snapshot processing functions
***************************************************/
async function createUserSnapshots(ctx: SuiAddressContext) {
    const results = await ctx.store.list(UserPosition, []);

    console.log("User positions", results);
    // process each user state
    // await Promise.all([...results.map(async (result) => {
    //     await updateUserPoolData(ctx, result);
    // })]);

    // // process for each user-ppol pair
    // const users = await ctx.store.list(UserPool, []);
    // await Promise.all([...users.map(async (user) => {
    //     await createUserSnapshot(ctx, user);
    // })]);

    // // clear each user-ppol pair
    // await ctx.store.delete(UserPool, users.map((user) => user.id.toString()));
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


/***************************************************
    Add event handlers for each chain-address pair
***************************************************/
// PROTOCOLS.forEach((protocol) => {
// SuiAddressProcessor.bind({
//     address: protocol.address,
//     network: protocol.network,
//     startCheckpoint: protocol.checkpoint,
// }).onTimeInterval(async (_, ctx) => {
//     await createUserSnapshots(ctx);
// }, 24 * 60, 24 * 60);
// });

events.bind({
    address: protocolConfigV1.address,
    network: protocolConfigV1.network,
    startCheckpoint: protocolConfigV1.checkpoint,
}).onEventCreatedPoolEvent(poolCreatedEventHandler)
    .onEventSwapEvent(swapEventHandler)
    .onEventDepositEvent(addLiquidityEventHandler)
    .onEventWithdrawEvent(removeLiquidityEventHandler);

eventsV2.bind({
    address: protocolConfigV2.address,
    network: protocolConfigV2.network,
    startCheckpoint: protocolConfigV2.checkpoint,
}).onEventCreatedPoolEvent(poolCreatedEventHandler)
    .onEventSwapEvent(swapEventHandler)
    .onEventDepositEvent(addLiquidityEventHandler)
    .onEventWithdrawEvent(removeLiquidityEventHandler);

/***************************************************
    Add snapshot for all pools
***************************************************/
SuiObjectTypeProcessor.bind({
    objectType: pool.Pool.type()
}).onTimeInterval(async (self, _, ctx) => {
    if (!self) { return }
    console.log(`Pool Snapshot: ctx ${ctx.objectId} at ctx.timestamp ${ctx.timestamp}`)
    await createPoolSnapshot(self, ctx);
}, 24 * 60, 24 * 60);
