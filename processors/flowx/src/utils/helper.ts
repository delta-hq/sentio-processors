import { SuiChainId } from "@sentio/chain";
import { SuiAddressContext, SuiContext, SuiObjectChangeContext, SuiObjectContext } from "@sentio/sdk/sui";
import { getPriceByType } from "@sentio/sdk/utils";
import { PoolInfo, PoolTokenState, UserState, UserPosition, UserPool } from "../schema/store.js";
import { BigDecimal } from "@sentio/sdk";
import BN from "bn.js";
import { i32, liquidity_math } from "../types/sui/0x25929e7f29e0a30eb4e692952ba1b5b65a3a4d65ab5f2a32e1ba3edcb587f26d.js";
import { ClmmPosition } from "@flowx-finance/sdk"
import { TickMath, ClmmPoolUtil } from "@cetusprotocol/cetus-sui-clmm-sdk";

// map for caching the pools
const poolInfoMap: Map<string, PoolInfo> = new Map();

/***************************************************
            PoolInfo handling functions 
***************************************************/
export function getCoinFullAddress(type: string) {
    let coin_a_address = ""
    let coin_b_address = ""

    const regex_a = /<[^,]+,/g;
    const regex_b = /0x[^\s>]+>/g;
    const matches_a = type.match(regex_a)
    const matches_b = type.match(regex_b)
    if (matches_a) {
        coin_a_address = matches_a[0].slice(1, -1)
    }
    if (matches_b) {
        coin_b_address = matches_b[0].slice(0, -1)
    }
    return [coin_a_address, coin_b_address]
}

export const buildPoolInfo = async (ctx: SuiContext | SuiObjectContext | SuiAddressContext, poolId: string): Promise<PoolInfo> => {
    let [symbol0, symbol1, decimals0, decimals1, token0, token1, fee, current_tick, tick_spacing] = ["", "", 0, 0, "", "", 0, 0, 0];

    try {
        const obj = await ctx.client.getObject({
            id: poolId,
            options: { showType: true, showContent: true },
        });
        if (obj && obj.data.content.dataType == "moveObject") {
            // token0 = `0x${(obj.data.content.fields as any).coin_type_b}`;
            // token1 = `0x${(obj.data.content.fields as any).coin_type_b}`;

            let type = obj.data.type;
            if (type) {
                [token0, token1] = getCoinFullAddress(type)
            }

            const metadataToken0 = await ctx.client.getCoinMetadata({ coinType: token0 });
            const metadataToken1 = await ctx.client.getCoinMetadata({ coinType: token1 });

            fee = (obj.data?.content.fields as any).swap_fee_rate;
            tick_spacing = (obj.data?.content.fields as any).tick_spacing;

            current_tick = (obj.data?.content.fields as any).sqrt_price;

            decimals0 = metadataToken0.decimals;
            decimals1 = metadataToken1.decimals;

            symbol0 = getCoinTypeFriendlyName(token0, metadataToken0.symbol);
            symbol1 = getCoinTypeFriendlyName(token1, metadataToken1.symbol);

        } else {
            console.log("No pool info", obj);
        }
    } catch (error) {
        console.log("Error getting pool info", error);
    }
    const poolInfo = new PoolInfo({
        id: poolId,
        symbol_0: symbol0,
        symbol_1: symbol1,
        decimals_0: decimals0,
        decimals_1: decimals1,
        fee_rate: BigInt(fee),
        current_tick: BigInt(current_tick),
        tick_spacing: BigInt(tick_spacing),
        token_0: token0,
        token_1: token1
    });
    return Promise.resolve(poolInfo);
}

export const getOrCreatePoolInfo = async (ctx: SuiContext | SuiObjectContext | SuiAddressContext, poolId: string): Promise<PoolInfo> => {
    let poolInfo = poolInfoMap.get(poolId);
    if (!poolInfo)
        poolInfo = await ctx.store.get(PoolInfo, poolId);
    if (!poolInfo) {
        console.log(`Pool info not found in store, building pool info for ${poolId}`);
        poolInfo = await buildPoolInfo(ctx, poolId);
        poolInfoMap.set(poolId, poolInfo);
        await ctx.store.upsert(poolInfo);
    }
    return poolInfo;
}


/***************************************************
            PoolToken handling functions 
***************************************************/
export const createPoolTokenState = async (ctx: SuiContext | SuiObjectContext | SuiAddressContext, poolId: string, token: string, tokenIndex: number, tokenSymbol: string, fee: bigint): Promise<void> => {
    try {
        const id = `${poolId}_${token}`;

        const poolTokenState = new PoolTokenState({
            id,
            timestamp: BigInt(ctx.timestamp.getTime()),
            pool_address: poolId,
            token_address: token,
            token_index: tokenIndex,
            token_symbol: tokenSymbol,
            token_amount: BigDecimal(0),
            token_amount_usd: BigDecimal(0),
            fee_rate: BigInt(fee),
            volume_amount: BigDecimal(0),
            volume_usd: BigDecimal(0),
            total_fees_usd: BigDecimal(0),
            user_fees_usd: BigDecimal(0),
            protocol_fees_usd: BigDecimal(0),
        });

        await ctx.store.upsert(poolTokenState);
    } catch (error) {
        console.log("Error creating pool token state", error);
    }
};

export const getOrCreatePoolTokenState = async (ctx: SuiContext | SuiObjectContext | SuiAddressContext, poolId: string, token: string): Promise<PoolTokenState> => {
    const id = `${poolId}_${token}`;
    let poolTokenState = await ctx.store.get(PoolTokenState, id);
    if (!poolTokenState) {
        const metadata = await ctx.client.getCoinMetadata({ coinType: token });

        poolTokenState = new PoolTokenState({
            id,
            timestamp: BigInt(ctx.timestamp.getTime()),
            pool_address: poolId,
            token_address: token,
            token_index: 0,
            token_symbol: getCoinTypeFriendlyName(token, metadata.symbol),
            token_amount: BigDecimal(0),
            token_amount_usd: BigDecimal(0),
            fee_rate: 0n,
            volume_amount: BigDecimal(0),
            volume_usd: BigDecimal(0),
            total_fees_usd: BigDecimal(0),
            user_fees_usd: BigDecimal(0),
            protocol_fees_usd: BigDecimal(0),
        });
        console.log(`Pool token state not found in store, building pool token state for ${id}`);
        await ctx.store.upsert(poolTokenState);
    }
    return poolTokenState;
};

export const updatePoolTokenState = async (ctx: SuiContext | SuiObjectContext | SuiAddressContext, poolId: string, token: string, decimals: number, tokenAmount: bigint, eventType: string): Promise<void> => {
    try {
        const poolTokenState = await getOrCreatePoolTokenState(ctx, poolId, token);
        const price = await getTokenPrice(ctx, token);

        if (eventType === "add") {
            poolTokenState.token_amount = poolTokenState.token_amount.plus(tokenAmount.asBigDecimal());
            poolTokenState.token_amount_usd = poolTokenState.token_amount_usd.plus(tokenAmount.scaleDown(decimals).multipliedBy(price));
        } else if (eventType === "remove") {
            poolTokenState.token_amount = poolTokenState.token_amount.minus(tokenAmount.asBigDecimal());
            poolTokenState.token_amount_usd = poolTokenState.token_amount_usd.minus(tokenAmount.scaleDown(decimals).multipliedBy(price));
        }

        await ctx.store.upsert(poolTokenState);
    } catch (error) {
        console.log("Error updating pool token state", error);
    }
};

/***************************************************
            UserState handling functions 
***************************************************/
export const updateUserPosition = async (ctx: SuiContext | SuiObjectContext | SuiAddressContext, poolInfo: PoolInfo,
    positionId: string, user: string, timestamp: number, eventType: string, poolId: string,
    amount0: bigint, amount1: bigint, lowerTick: bigint, upperTick: bigint, liquidity: bigint): Promise<UserPosition> => {

    try {
        // get token prices
        const price0 = await getTokenPrice(ctx, poolInfo.token_0);
        const price1 = await getTokenPrice(ctx, poolInfo.token_1);

        // check if there is a position for this user in that pool in that range
        let userPosition = await ctx.store.get(UserPosition, positionId);

        if (!userPosition) {
            userPosition = new UserPosition({
                timestamp: BigInt(ctx.timestamp.getTime()),
                id: positionId,
                user_address: user,
                position_id: positionId,
                pool_address: poolId,
                amount_0: 0n,
                amount_1: 0n,
                amount_usd: BigDecimal(0),
                lower_tick: lowerTick,
                upper_tick: upperTick,
                liquidity: 0n,
            });

            // emit transfer event
            ctx.eventLogger.emit("Transfer", {
                timestamp: ctx.timestamp,
                transaction_from_address: user.toString(),
                nft_token_id: positionId,
                from_address: "0x0000000000",
                to_address: user.toString(),
                event_type: "transfer",
            });
        }

        if (eventType === "add") {
            userPosition.amount_0 = userPosition.amount_0 + amount0;
            userPosition.amount_1 = userPosition.amount_1 + amount1;
            userPosition.amount_usd = userPosition.amount_usd.plus(amount0.scaleDown(poolInfo.decimals_0).multipliedBy(price0).plus(amount1.scaleDown(poolInfo.decimals_1).multipliedBy(price1)));
        } else if (eventType === "remove") {
            userPosition.amount_0 = userPosition.amount_0 - amount0;
            userPosition.amount_1 = userPosition.amount_1 - amount1;
            userPosition.amount_usd = userPosition.amount_usd.minus(amount0.scaleDown(poolInfo.decimals_0).multipliedBy(price0).plus(amount1.scaleDown(poolInfo.decimals_1).multipliedBy(price1)));

        }
        //  add the liquidty, since it's a delta and has a sign
        userPosition.liquidity = userPosition.liquidity + liquidity;
        userPosition.timestamp = BigInt(timestamp);

        await ctx.store.upsert(userPosition);

        return userPosition;
    } catch (error) {
        console.log("Error creating user state", error);
        return null;
    }
}

export const updateUserPositionOwner = async (ctx: SuiContext | SuiObjectContext | SuiAddressContext | SuiObjectChangeContext, positionId: string, oldUser: string, newUser: string,): Promise<void> => {
    let userPosition = await ctx.store.get(UserPosition, positionId);
    console.log(`Updating user position owner from ${oldUser} to ${newUser}`);
    if (userPosition) {
        userPosition.user_address = newUser;
        await ctx.store.upsert(userPosition);
        console.log(`User position owner updated from ${oldUser} to ${newUser}`);
    }
};

export const updateUserPool = async (ctx: SuiContext | SuiObjectContext | SuiAddressContext | SuiObjectChangeContext, poolInfo: PoolInfo, user: string, lowerTick: bigint, upperTick: bigint, liquidity: bigint): Promise<void> => {
    try {
        let id = `${poolInfo.id}_${user}`;
        let userPool = await ctx.store.get(UserPool, id);
        if (!userPool) {
            userPool = new UserPool({
                id,
                user_address: user,
                pool_address: poolInfo.id.toString(),
                amount_0: 0n,
                amount_1: 0n,
                amount_0_in_range: 0n,
                amount_1_in_range: 0n,
            });
        }

        try {
            console.log(`Process Getting token amounts from ${user} liquidity`, liquidity, liquidity.toString());
            console.log(`Process Getting token amounts from ${user} poolinf`, poolInfo.current_tick, poolInfo.current_tick.toString());
            console.log(`Process Getting token amounts from ${user} lowerTick`, lowerTick, lowerTick.toString());
            console.log(`Process Getting token amounts from ${user} upperTick`, upperTick, upperTick.toString());
            const amounts = ClmmPoolUtil.getCoinAmountFromLiquidity(
                new BN(liquidity.toString()),
                new BN(poolInfo.current_tick.toString()),
                new BN(lowerTick.toString()),
                new BN(upperTick.toString()),
                false
            );
            const { coinA, coinB } = amounts;
            console.log(`Process Getting token amounts from ${user} coinA ${coinA} coinB ${coinB}`);
            const amount0 = BigInt(coinA.toString());//BigInt(coinA.toString()).asBigDecimal();
            const amount1 = BigInt(coinB.toString());
            console.log(`Process Getting token amounts from ${user} amount0 ${amount0} amount1 ${amount1}`);

            userPool.amount_0 = userPool.amount_0 + amount0;
            userPool.amount_1 = userPool.amount_1 + amount1;

            if (poolInfo.current_tick >= lowerTick && poolInfo.current_tick <= upperTick) {
                userPool.amount_0_in_range = userPool.amount_0_in_range + amount0;
                userPool.amount_1_in_range = userPool.amount_1_in_range + amount1;
            }

        } catch (error) {
            console.log(`Error getting token amounts from liquidity ${user}`, error);
        }

        // userPool.amount_0 = userPool.amount_0.lt(BigDecimal(0)) ? BigDecimal(0) : userPool.amount_0;
        // userPool.amount_1 = userPool.amount_1.lt(BigDecimal(0)) ? BigDecimal(0) : userPool.amount_1;
        // userPool.amount_0_in_range = userPool.amount_0_in_range.lt(BigDecimal(0)) ? BigDecimal(0) : userPool.amount_0_in_range;
        // userPool.amount_1_in_range = userPool.amount_1_in_range.lt(BigDecimal(0)) ? BigDecimal(0) : userPool.amount_1_in_range;

        await ctx.store.upsert(userPool);
    } catch (error) {
        console.log("Error creating user pool", error);
    }
}

/***************************************************
            Coin handler functions
***************************************************/
export const getTokenPrice = async (ctx: SuiContext | SuiObjectContext | SuiAddressContext, token: string) => {
    try {
        let price = await getPriceByType(
            SuiChainId.SUI_MAINNET,
            token,
            ctx.timestamp
        );

        const isStableCoin = (token: string) => {
            const stableCoins = new Set(["0xce7ff77a83ea0cb6fd39bd8748e2ec89a3f41e8efdc3f4eb123e0ca37b184db2::buck::BUCK", "0x94e7a8e71830d2b34b3edaa195dc24c45d142584f06fa257b73af753d766e690::celer_usdt_coin::CELER_USDT_COIN", "0x94e7a8e71830d2b34b3edaa195dc24c45d142584f06fa257b73af753d766e690::celer_usdc_coin::CELER_USDC_COIN"])
            return stableCoins.has(token)
        }

        if (!price || isStableCoin(token)) {
            price = 0; //use 0 for assets with no price
        }
        return price;
    } catch (error) {
        console.log("Error getting token price", error);
        return 0;
    }
};

export const getCoinTypeFriendlyName = (coinType: string, metadataSymbol?: string) => {
    switch (coinType) {
        case "0x5d4b302506645c37ff133b98c4b50a5ae14841659738d6d733d59d0d217a93bf::coin::COIN":
            return "USDCeth";
        case "0xc060006111016b8a020ad5b33834984a437aaa7d3c74c18e09a95d48aceab08c::coin::COIN":
            return "USDT";
        case "0x2::sui::SUI":
            return "SUI";
        case "0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI":
            return "SUI";
        case "0xaf8cd5edc19c4512f4259f0bee101a40d41ebed738ade5874359610ef8eeced5::coin::COIN":
            return "WETH";
        case "0x909cba62ce96d54de25bec9502de5ca7b4f28901747bbf96b76c2e63ec5f1cba::coin::COIN":
            return "USDCbnb"
        case "0xce7ff77a83ea0cb6fd39bd8748e2ec89a3f41e8efdc3f4eb123e0ca37b184db2::buck::BUCK":
            return "BUCK"
        case "0x549e8b69270defbfafd4f94e17ec44cdbdd99820b33bda2278dea3b9a32d3f55::cert::CERT":
            return "vSUI"
        default:
            if (metadataSymbol) {
                return metadataSymbol;
            }
            return coinType;
    }
}

export const getTokenAddressFromAddres = (address: string): string => {
    switch (address) {
        case "0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI":
            return "0x2::sui::SUI";
        default:
            return address;
    }
};

export const getPairFriendlyName = (token0: string, token1: string): string => {
    let name0 = getCoinTypeFriendlyName(token0);
    let name1 = getCoinTypeFriendlyName(token1);
    return `${name0}-${name1}`;
}

const convertTick = (tick: number): number => {
    if (tick > 2147483647) {
        tick = (tick - 4294967296);
    }
    return tick;
}

export const getSqrtPriceFromTickIndex = (tick: i32.I32): bigint => {
    return BigInt(TickMath.tickIndexToSqrtPriceX64(convertTick(tick.bits)).toString());
}

export const getObjectOwner = async (ctx: SuiContext | SuiObjectContext | SuiAddressContext, id: string): Promise<string> => {
    try {
        ctx.client.tryGetPastObject
        const obj = await ctx.client.getObject({
            id,
            options: {
                showOwner: true,
            },
        });
        if (!obj) {
            console.log("No object found for id", id);
            return "none";
        }
        if (obj.error) {
            console.log("Error in object owner", obj.error);
            return "none";
        }
        const owner =
            (obj as any)?.data?.owner?.AddressOwner ??
            (obj as any)?.data?.owner?.ObjectOwner;
        if (!owner) {
            console.log("No owner found for object", obj);
        }
        return owner;
    }
    catch (error) {
        console.log("Error getting object owner", error);
    }
    return "none";
}