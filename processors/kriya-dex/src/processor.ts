import { SuiChainId } from "@sentio/chain";
import { BigDecimal } from "@sentio/sdk";
import { SuiAddressContext, SuiAddressProcessor, SuiContext } from "@sentio/sdk/sui";
import { } from "@sentio/sdk/utils";
import {
    admin,
    create_pool,
    trade,
    liquidity,
    pool,
    tick,
} from "./types/sui/0x40b6713907acadc6c8b8d9d98f36d2f24f80bd08440d5477f9f868e3b5e1e12d.js";
import * as helper from "./utils/helper.js";
import { PoolInfo, PoolTokenState, UserPosition, UserState } from "./schema/store.js";
import { TypeDescriptor } from "@sentio/sdk/move";
import "./transfers.js"


import { SuiObjectChange } from "@mysten/sui/client"
import { SuiGlobalProcessor, SuiNetwork, SuiObjectChangeContext, SuiObjectTypeProcessor, SuiObjectProcessor } from "@sentio/sdk/sui"


// const lp_type = "0xa0eba10b173538c8fecca1dff298e488402cc9ff374f8a12ca7758eebe830b66::spot_dex::KriyaLPToken<0x549e8b69270defbfafd4f94e17ec44cdbdd99820b33bda2278dea3b9a32d3f55::cert::CERT, 0x2::sui::SUI>";

// const LP_TOKEN_TYPE_PREFIX = [
//     //lp object
//     "0xa0eba10b173538c8fecca1dff298e488402cc9ff374f8a12ca7758eebe830b66::spot_dex::KriyaLPToken<",

//     "0xa0eba10b173538c8fecca1dff298e488402cc9ff374f8a12ca7758eebe830b66::spot_dex::KriyaLPToken<0x549e8b69270defbfafd4f94e17ec44cdbdd99820b33bda2278dea3b9a32d3f55::cert::CERT, 0x2::sui::SUI>",

//     "0xa0eba10b173538c8fecca1dff298e488402cc9ff374f8a12ca7758eebe830b66::spot_dex::KriyaLPToken",
//     //pool object
//     // "0xa0eba10b173538c8fecca1dff298e488402cc9ff374f8a12ca7758eebe830b66::spot_dex::Pool<",
//     //staked position object
//     // "0x88701243d0445aa38c0a13f02a9af49a58092dfadb93af9754edb41c52f40085::farm::StakedPosition<",
//     //staked position object
// ]


// for (const lp_token_prefix of LP_TOKEN_TYPE_PREFIX) {
//     console.log(`prefix ${lp_token_prefix} captured`)
//     SuiObjectTypeProcessor.bind({
//         network: SuiNetwork.MAIN_NET,
//         objectType: new TypeDescriptor<string>(lp_token_prefix),
//         startCheckpoint: 80902947n
//     })
//         .onObjectChange(async (changes, ctx) => {
//             console.log(`change detected `, changes)
//             // if (ctx.txDigest == 'EMc73fwyDtnJhFRgNWs53pGC3mvUS7ofKdXdVheby3UT') {

//             //   console.log(`prefix ${lp_token_prefix} captured EMc73fwyDtnJhFRgNWs53pGC3mvUS7ofKdXdVheby3UT`)
//             // }
//             for (let i = 0; i < changes.length; i++) {
//                 //@ts-ignore
//                 console.log(`${i}/${changes.length} change in loop: ${changes[i].objectType} ${changes[i].objectId} ${changes[i].type}  ${changes[i].version} ${ctx.txDigest} captured, prefix ${lp_token_prefix}`)

//                 // await processObjectChanges(ctx, changes[i], lp_token_prefix)
//             }
//         })
// }

// function handlePrefix(lp_token_prefix: string) {

// ,lp_token_prefix)
// }

// for (const lp_token_prefix of LP_TOKEN_TYPE_PREFIX) {
//     console.log(`prefix ${lp_token_prefix} captured2`)

//     SuiGlobalProcessor.bind({
//         network: SuiNetwork.MAIN_NET,
//         startCheckpoint: 80902947n
//     })
//         .onObjectChange(async (changes, ctx) => {
// console.log(`change detected2 `, changes /)
// if (ctx.txDigest == 'EMc73fwyDtnJhFRgNWs53pGC3mvUS7ofKdXdVheby3UT') {
//   console.log(`prefix ${lp_token_prefix} captured EMc73fwyDtnJhFRgNWs53pGC3mvUS7ofKdXdVheby3UT`)
// }
// for (let i = 0; i < changes.length; i++) {
//     //@ts-ignore
//     // console.log(`${i}/${changes.length} change in loop: ${changes[i].objectType} ${changes[i].objectId} ${changes[i].type}  ${changes[i].version} ${ctx.txDigest} captured, prefix ${lp_token_prefix}`)

//     await processObjectChanges(ctx, changes[i], lp_token_prefix)
// }
//         }, lp_token_prefix)
// }

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
    address: "0xf6c05e2d9301e6e91dc6ab6c3ca918f7d55896e1f1edd64adc0e615cde27ebf1",
    checkpoiont: 38860558n
};
const PROTOCOLS = new Set<ProtocolConfigType>(
    [protocolConfig]
)

/***************************************************
      Snapshot processing functions 
***************************************************/
async function process(ctx: SuiAddressContext, poolState: PoolTokenState): Promise<PoolTokenState> {
    // Add your processing logic here

    try {
        const obj = await ctx.client.getObject({
            id: poolState.pool_address,
            options: { showType: true, showContent: true },
        });
        if (obj && obj.data.content.dataType == "moveObject") {
            // get the pool info and fee
            const poolInfo = await helper.getOrCreatePoolInfo(ctx, poolState.pool_address);

            const isToken0 = poolInfo.token_0 == poolState.token_address;

            const currentTokenAmountRaw = isToken0 ? (obj.data.content.fields as any).reserve_x : (obj.data.content.fields as any).reserve_y;
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
    } catch (error) {
        console.error("Failed to get pool info", error);
    }

    return poolState;
}

async function updatePoolTokenStates(ctx: SuiAddressContext) {
    const poolTokenStates = await ctx.store.list(PoolTokenState, []);
    const newPoolTokenStates = await Promise.all(
        poolTokenStates.map((poolTokenState) =>
            process(ctx, poolTokenState)
        )
    );
    await ctx.store.upsert(newPoolTokenStates);
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
        await helper.createPoolTokenState(ctx, pool_id, token0, 0, poolInfo.symbol_0, fee_rate.asBigDecimal());
        await helper.createPoolTokenState(ctx, pool_id, token1, 1, poolInfo.symbol_1, fee_rate.asBigDecimal());
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

    // calculate the amount in and out
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
            await ctx.store.upsert(poolInfo);
        } catch (error) {
            console.error(`Failed to update PoolFee for ${pool_id}`, error);
        }

        // update the token balances in the pool state
        const token = x_for_y ? poolInfo.token_0 : poolInfo.token_1;
        try {
            let poolState = await helper.getOrCreatePoolTokenState(ctx, pool_id, token);
            poolState.volume_amount = poolState.volume_amount.plus(x_for_y ? amount0 : amount1);
            poolState.volume_usd = poolState.volume_usd.plus(x_for_y ? amount0.multipliedBy(price0) : amount1.multipliedBy(price1));

            await ctx.store.upsert(poolState);
        } catch (error) {
            console.error(`Failed to update PoolTokenState for ${pool_id}-${token}`, event, error);
        }
    } else {
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

    ctx.eventLogger.emit("LPMint", {
        timestamp: ctx.timestamp.getTime(),
        transaction_from_address: sender,
        event_address: "mint",
        pool_address: pool_id,
        tick_lower: lower_tick_index,
        tick_upper: upper_tick_index,
        current_tick: poolInfo.current_tick,
        tick_spacing: poolInfo.tick_spacing,
        nft_token_id: pool_id,
        token0_address: poolInfo.token_0,
        token0_amount: amount_x,
        token1_address: poolInfo.token_1,
        token1_amount: amount_y,
        token_fees: 0,
        amount_liq: liquidity,
    });

    // create UserState for this
    await helper.updateUserPosition(ctx, poolInfo, position_id, sender, ctx.timestamp.getTime(), "add", pool_id, amount_x, amount_y, lower_tick_index, upper_tick_index, liquidity);
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

    ctx.eventLogger.emit("LPBurn", {
        timestamp: ctx.timestamp.getTime(),
        transaction_from_address: sender,
        event_address: "burn",
        pool_address: pool_id,
        tick_lower: lower_tick_index,
        tick_upper: upper_tick_index,
        current_tick: poolInfo.current_tick,
        tick_spacing: poolInfo.tick_spacing,
        nft_token_id: pool_id,
        token0_address: poolInfo.token_0,
        token0_amount: amount_x,
        token1_address: poolInfo.token_1,
        token1_amount: amount_y,
        token_fees: 0,
        amount_liq: liquidity,
    });

    // create UserState for this
    await helper.updateUserPosition(ctx, poolInfo, position_id, sender, ctx.timestamp.getTime(), "remove", pool_id, amount_x, amount_y, lower_tick_index, upper_tick_index, liquidity);
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
    let poolFee = await helper.getOrCreatePoolInfo(ctx, pool_id);
    poolFee.fee_rate = protocol_fee_share_new.asBigDecimal();
    await ctx.store.upsert(poolFee);
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
        // await updatePoolTokenStates(ctx);
        await createUserScoreSnapshots(ctx);
    }, 24 * 60);

    create_pool.bind({
        address: protocol.address,
        network: protocol.network,
        startCheckpoint: protocol.checkpoiont,
    }).onEventPoolCreatedEvent(poolCreatedEventHandler);

    admin.bind({
        address: protocol.address,
        network: protocol.network,
        startCheckpoint: protocol.checkpoiont,
    }).onEventSetProtocolSwapFeeRateEvent(feeChangeEventHandler);

    trade
        .bind({
            address: protocol.address,
            network: protocol.network,
            startCheckpoint: protocol.checkpoiont,
        }).onEventSwapEvent(swapEventHandler);

    liquidity.bind({
        address: protocol.address,
        network: protocol.network,
        startCheckpoint: protocol.checkpoiont,
    }).onEventAddLiquidityEvent(addLiquidityEventHandler)
        .onEventRemoveLiquidityEvent(removeLiquidityEventHandler);
});

/***************************************************
    Add event handlers for all pools
***************************************************/
SuiObjectTypeProcessor.bind({
    objectType: pool.Pool.type(),
}).
    onObjectChange(transferEventHandler);