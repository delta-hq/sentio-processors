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
import { PoolInfo, PoolTokenState } from "./schema/store.js";


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
        Handle events for each chain-address pair
***************************************************/
PROTOCOLS.forEach((protocol) => {
    SuiAddressProcessor.bind({
        address: protocol.address,
        network: protocol.network,
        startCheckpoint: protocol.checkpoiont,
    }).onTimeInterval(async (_, ctx) => {
        await updatePoolTokenStates(ctx);
    }, 24 * 60);

    /***************************************************
                Capture pool creation events 
    ***************************************************/
    create_pool.bind({
        address: protocol.address,
        network: protocol.network,
        startCheckpoint: protocol.checkpoiont,
    }).onEventPoolCreatedEvent(async (event, ctx) => {
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
            // const poolInfo = await helper.buildPoolInfo(ctx, pool_id);

            // get metadata for the tokens
            // const metadata0 = await ctx.client.getCoinMetadata({ coinType: token0 });
            // const metadata1 = await ctx.client.getCoinMetadata({ coinType: token1 });

            // create an event for the pool and the token0
            ctx.eventLogger.emit("Pool", {
                pool_address: pool_id,
                timestamp: event.timestampMs,
                lp_token_address: pool_id, // the lp token address is the same as the pool addresss
                lp_token_symbol: "Kriya-V3-LP", // hardcoded for Kriya
                token_address: token0,
                token_symbol: poolInfo.symbol_0, // helper.getCoinTypeFriendlyName(token0, metadata0.symbol),
                token_decimals: poolInfo.decimals_0, //metadata0.decimals,
                token_index: 0,
                fee_rate: fee_rate,
                dex_type: "clmm",
            });

            // create an event for the pool and the token1
            ctx.eventLogger.emit("Pool", {
                pool_address: pool_id,
                timestamp: event.timestampMs,
                lp_token_address: pool_id, // the lp token address is the same as the pool addresss
                lp_token_symbol: "Kriya-V3-LP", // hardcoded for Kriya
                token_address: token1,
                token_symbol: poolInfo.symbol_1, // helper.getCoinTypeFriendlyName(token1, metadata1.symbol),
                token_decimals: poolInfo.decimals_1, // metadata1.decimals,
                token_index: 1,
                fee_rate: fee_rate,
                dex_type: "clmm",
            });

            // create snapshot for the pool
            await helper.createPoolTokenState(ctx, pool_id, token0, 0, poolInfo.symbol_0, fee_rate.asBigDecimal());
            await helper.createPoolTokenState(ctx, pool_id, token1, 1, poolInfo.symbol_1, fee_rate.asBigDecimal());

            // add fee rate to the pool
            // await ctx.store.upsert(new PoolFee({
            //   id: pool_id,
            //   fee_rate: fee_rate.asBigDecimal(),
            //   tick_spacing: BigDecimal(tick_spacing),
            // }));
        } catch (error) {
            console.log("Error getting pool info", error);
            throw error;
        }
    });

    /***************************************************
                Capture fee change event
    ***************************************************/
    admin.bind({
        address: protocol.address,
        network: protocol.network,
        startCheckpoint: protocol.checkpoiont,
    }).onEventSetProtocolSwapFeeRateEvent(async (event, ctx) => {
        const {
            pool_id,
            protocol_fee_share_new,
            protocol_fee_share_old,
        } = event.data_decoded;
        let poolFee = await helper.getOrCreatePoolInfo(ctx, pool_id);
        poolFee.fee_rate = protocol_fee_share_new.asBigDecimal();
        await ctx.store.upsert(poolFee);
    });

    /***************************************************
                Capture trade events 
    ***************************************************/
    trade
        .bind({
            address: protocol.address,
            network: protocol.network,
            startCheckpoint: protocol.checkpoiont,
        }).onEventSwapEvent(async (event, ctx) => {
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
                    timestamp: event.timestampMs,
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
        });


    /***************************************************
                Capture liquidity events 
    ***************************************************/
    liquidity.bind({
        address: protocol.address,
        network: protocol.network,
        startCheckpoint: protocol.checkpoiont,
    }).onEventAddLiquidityEvent(async (event, ctx) => {
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
            timestamp: event.timestampMs,
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
    }).onEventRemoveLiquidityEvent(async (event, ctx) => {
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
            timestamp: event.timestampMs,
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

    });


    // liquidity
    //   .bind({
    //     address: addr,
    //     network: chainId,
    //     startCheckpoint: 38860558n,
    //   })
    //   .onEventAddLiquidityEvent(async (event, ctx) => {
    //     const {
    //       sender,
    //       pool_id,
    //       position_id,
    //       liquidity,
    //       amount_x,
    //       amount_y,
    //       upper_tick_index,
    //       lower_tick_index,
    //       reserve_x,
    //       reserve_y,
    //     } = event.data_decoded;

    //     const poolInfo = await getPoolInfo(ctx, pool_id);

    //     const {
    //       coinTypeA,
    //       coinTypeB,
    //       priceA,
    //       priceB,
    //       scaleX,
    //       scaleY,
    //       reserveX,
    //       reserveY,
    //     } = poolInfo;

    //     const dollarX = (Number(amount_x) * priceA!) / scaleX;
    //     const dollarY = (Number(amount_y) * priceB!) / scaleY;

    //     ctx.eventLogger.emit("LiquidityAddedEvent", {
    //       poolId: pool_id,
    //       typeX: coinTypeA,
    //       typeY: coinTypeB,
    //       user: sender,
    //       position_id: position_id,
    //       amountX: Number(amount_x) / scaleX,
    //       amountY: Number(amount_y) / scaleY,
    //       dollarX,
    //       dollarY,
    //       liquidity,
    //     });

    //     let lpMetadata = {
    //       pair: getPairFriendlyName(coinTypeA, coinTypeB),
    //     };

    //     AddLPTxnCounter.add(ctx, 1, lpMetadata);
    //     TokenYBalanceGauge.record(ctx, Number(reserve_y) / scaleY, {
    //       coin_symbol: getCoinTypeFriendlyName(poolInfo.coinTypeB),
    //       pair: getPairFriendlyName(poolInfo.coinTypeA, poolInfo.coinTypeB),
    //     });
    //     TokenXBalanceGauge.record(ctx, Number(reserve_x) / scaleX, {
    //       coin_symbol: getCoinTypeFriendlyName(poolInfo.coinTypeA),
    //       pair: getPairFriendlyName(poolInfo.coinTypeA, poolInfo.coinTypeB),
    //     });

    //     DollarInflowOutflowGauge.record(ctx, dollarX + dollarY, lpMetadata);
    //     TokenXInflowOutflowGauge.record(ctx, Number(amount_x) / scaleX, {
    //       coin_symbol: getCoinTypeFriendlyName(coinTypeA),
    //       pair: getPairFriendlyName(coinTypeA, coinTypeB),
    //     });
    //     TokenYInflowOutflowGauge.record(ctx, Number(amount_y) / scaleY, {
    //       coin_symbol: getCoinTypeFriendlyName(coinTypeB),
    //       pair: getPairFriendlyName(coinTypeA, coinTypeB),
    //     });
    //   })
    //   .onEventRemoveLiquidityEvent(async (event, ctx) => {
    //     const {
    //       sender,
    //       pool_id,
    //       position_id,
    //       liquidity,
    //       amount_x,
    //       amount_y,
    //       upper_tick_index,
    //       lower_tick_index,
    //       reserve_x,
    //       reserve_y,
    //     } = event.data_decoded;

    //     const poolInfo = await getPoolInfo(ctx, pool_id);

    //     const {
    //       coinTypeA,
    //       coinTypeB,
    //       priceA,
    //       priceB,
    //       scaleX,
    //       scaleY,
    //       reserveX,
    //       reserveY,
    //     } = poolInfo;

    //     const dollarX = (Number(amount_x) * priceA!) / scaleX;
    //     const dollarY = (Number(amount_y) * priceB!) / scaleY;

    //     ctx.eventLogger.emit("LiquidityRemovedEvent", {
    //       poolId: pool_id,
    //       typeX: coinTypeA,
    //       typeY: coinTypeB,
    //       user: sender,
    //       position_id: position_id,
    //       amountX: Number(amount_x) / scaleX,
    //       amountY: Number(amount_y) / scaleY,
    //       dollarX,
    //       dollarY,
    //       liquidity,
    //     });

    //     let lpMetadata = {
    //       pair: getPairFriendlyName(coinTypeA, coinTypeB),
    //     };
    //     RemoveLPTxnCounter.add(ctx, 1, lpMetadata);
    //     TokenYBalanceGauge.record(ctx, Number(reserve_y) / scaleY, {
    //       coin_symbol: getCoinTypeFriendlyName(poolInfo.coinTypeB),
    //       pair: getPairFriendlyName(poolInfo.coinTypeA, poolInfo.coinTypeB),
    //     });
    //     TokenXBalanceGauge.record(ctx, Number(reserve_x) / scaleX, {
    //       coin_symbol: getCoinTypeFriendlyName(poolInfo.coinTypeA),
    //       pair: getPairFriendlyName(poolInfo.coinTypeA, poolInfo.coinTypeB),
    //     });

    //     DollarInflowOutflowGauge.record(ctx, -(dollarX + dollarY), lpMetadata);
    //     TokenXInflowOutflowGauge.record(ctx, -(Number(amount_x) / scaleX), {
    //       coin_symbol: getCoinTypeFriendlyName(coinTypeA),
    //       pair: getPairFriendlyName(coinTypeA, coinTypeB),
    //     });
    //     TokenYInflowOutflowGauge.record(ctx, -(Number(amount_y) / scaleY), {
    //       coin_symbol: getCoinTypeFriendlyName(coinTypeB),
    //       pair: getPairFriendlyName(coinTypeA, coinTypeB),
    //     });
    //   });
});