import { ContractContext, EthChainId } from "@sentio/sdk/eth";
import { ComptrollerProcessor, CTokenProcessor, CTokenProcessorTemplate } from "./types/eth/index.js";
import { BorrowEvent, CToken, CTokenBoundContractView, CTokenContext, getCTokenContract, getCTokenContractOnContext, MintEvent, RedeemEvent } from "./types/eth/ctoken.js";
import { token } from '@sentio/sdk/utils'
import { ComptrollerContext, MarketListedEvent } from "./types/eth/comptroller.js";
import { scaleDown } from "@sentio/sdk";
import { BlockParams } from 'ethers/providers'
import { Account } from "./schema/store.js";

interface Pool {
  chain_id: EthChainId;
  creation_block_number: number;
  timestamp: Date;
  underlying_token_address: string;
  underlying_token_symbol: string;
  receipt_token_address: string;
  receipt_token_symbol: string;
  pool_address: string;
  pool_type: string;
}

const pools = new Map<string, Pool>()

const poolInfo = new Map<string, {receiptInfo: token.TokenInfo, underlyingInfo: token.TokenInfo}>()

async function onEvent(event: MintEvent | BorrowEvent, ctx: CTokenContext) {
    const args = event.args.toObject()
    const pool = pools.get(event.address)
    if (!pool) {
      console.log("Pool: " + event.address + " does not exist.")
    }
    const info = poolInfo.get(event.address)

    if (event.name = 'Mint') {
      ctx.eventLogger.emit(event.name, {
        timestamp: ctx.timestamp,
        chain_id: ctx.chainId,
        block_number: event.blockNumber,
        log_index: event.index,
        transaction_hash: event.transactionHash,
        user_address: args.minter,
        taker_address: args.minter,
        pool_address: event.address,
        token_address: pool!.underlying_token_address,
        amount: scaleDown(args.mintAmount, info!.underlyingInfo.decimal),
        amount_usd: 0.0,
        event_type: "deposit"
      })

      const supplier = new Account({
        id: args.minter + "-" + event.address,
        account: args.minter,
        pool: event.address,
      })
      await ctx.store.upsert(supplier)
    } else if (event.name = "Borrow") {
      ctx.eventLogger.emit(event.name, {
        timestamp: ctx.timestamp,
        chain_id: ctx.chainId,
        block_number: event.blockNumber,
        log_index: event.index,
        transaction_hash: event.transactionHash,
        user_address: args.borrower,
        taker_address: args.borrower,
        pool_address: event.address,
        token_address: pool!.underlying_token_address,
        amount: scaleDown(args.borrowAmount, info!.underlyingInfo.decimal),
        amount_usd: 0.0,
        event_type: "borrow"
      })

      const borrower = new Account({
        id: args.minter + "-" + event.address,
        account: args.minter,
        pool: event.address,
      })
      await ctx.store.upsert(borrower)
    }
}

async function createPool(event: MarketListedEvent, ctx: ComptrollerContext) {
  let underlying, underlyingInfo, receiptInfo
  // cuz cEther is a different contract
  if (event.args.cToken.toLowerCase() == '0x4ddc2d193948926d02f9b1fe9e1daa0718270ed5' || event.transactionHash.toLowerCase() == '0xfd7283d4200935bebf3eca130bd20a5d5d0c21fe337cea68a1d63035a057f23b') {
    underlying = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"
    underlyingInfo = {
      symbol: 'ETH',
      name: 'Ethereum',
      decimal: 18
    }
  } else {
    const cTokenContract = getCTokenContract(ctx.chainId, event.args.cToken)
    underlying = (await cTokenContract.underlying()).toLowerCase()
    underlyingInfo = await token.getERC20TokenInfo(ctx, underlying)
  }
  receiptInfo = await token.getERC20TokenInfo(ctx, event.args.cToken)

  poolInfo.set(event.args.cToken, {
    receiptInfo: receiptInfo,
    underlyingInfo: underlyingInfo
  })

  const pool: Pool = {
    chain_id: ctx.chainId,
    creation_block_number: event.blockNumber,
    timestamp: ctx.timestamp,
    underlying_token_address: underlying,
    underlying_token_symbol: underlyingInfo.symbol,
    receipt_token_address: event.args.cToken,
    receipt_token_symbol: receiptInfo.symbol,
    pool_address: event.args.cToken,
    pool_type: 'supply_pool'
  };

  pools.set(event.args.cToken, pool)
  ctx.eventLogger.emit(event.name, {pool})
}

async function poolSnapshot(block: BlockParams, ctx: ContractContext<CToken, CTokenBoundContractView>) {
    const pool = pools.get(ctx.contract.address)!
    const tokens = poolInfo.get(ctx.contract.address)!

    const totalBorrows = await ctx.contract.totalBorrows()
    const totalSupply = await ctx.contract.totalSupply()
    const exchangeRateStored = await ctx.contract.exchangeRateStored()
    const reserveFactorMantissa = await ctx.contract.reserveFactorMantissa()
    const supplyRatePerBlock = await ctx.contract.supplyRatePerBlock()
    const borrowRatePerBlock = await ctx.contract.borrowRatePerBlock()
    // const borrowIndex = await ctx.contract.borrowIndex()
  
    const borrow_amount = scaleDown(totalBorrows, tokens.underlyingInfo.decimal)
    const normalizeDecimals = 18 - 8 + tokens.underlyingInfo.decimal + tokens.receiptInfo.decimal
    const supplied_amount = scaleDown(totalSupply * exchangeRateStored, normalizeDecimals)

    ctx.eventLogger.emit('poolSnapshot', {
      timestamp: block.timestamp,
      chain_id: ctx.chainId,
      pool_address: pool.pool_address,
      underlying_token_address: pool.underlying_token_address,
      underlying_token_symbol: pool.underlying_token_symbol,
      available_amount: supplied_amount.minus(borrow_amount),
      available_amount_usd: 0.0,
      supplied_amount: supplied_amount,
      supplied_amount_usd: 0.0,
      collateral_amount: 0.0, // does not exist in compound v2
      collateral_amount_usd: 0.0,
      collateral_factor: scaleDown(reserveFactorMantissa, 18-2), // https://docs.compound.finance/v2/ctokens/#reserve-factor
      supply_index: scaleDown(exchangeRateStored, 18 - 8 + tokens.underlyingInfo.decimal), // https://docs.compound.finance/v2/ctokens/#exchange-rate
      supply_apr: scaleDown(supplyRatePerBlock * BigInt(ETH_BLOCKS_PER_DAY*365), 18 - 2),
      borrowed_amount: borrow_amount,
      borrowed_amount_usd: 0.0,
      borrow_index: 0, // no borrow index in comp v2
      borrow_apr: scaleDown(borrowRatePerBlock * BigInt(ETH_BLOCKS_PER_DAY*365), 18 - 2),
      total_fees_usd: 0.0,
      user_fees_usd: 0.0,
      protocol_fees_usd: 0.0
    })
}

async function positionSnapshot(block: BlockParams, ctx: ContractContext<CToken, CTokenBoundContractView>) {
  const pool = pools.get(ctx.contract.address)!
  const tokens = poolInfo.get(ctx.contract.address)!
  
  // Get exchange rate once for all accounts
  const exchangeRateStored = await ctx.contract.exchangeRateStored()
  
  // Get all accounts first
  const accounts: Account[] = []
  for await (const account of ctx.store.listIterator(Account, [{
    field: "pool",
    op: "=",
    value: ctx.contract.address
  }])) {
    accounts.push(account)
  }

  // Process all accounts in parallel
  await Promise.all(accounts.map(async (accountEntity) => {
    const accountAddress = accountEntity.account
    
    // Get both balances in parallel
    const [borrowBalanceStored, balanceOf] = await Promise.all([
      ctx.contract.borrowBalanceStored(accountAddress),
      ctx.contract.balanceOf(accountAddress)
    ])

    const borrow_amount = scaleDown(borrowBalanceStored, tokens.underlyingInfo.decimal)
    const normalizeDecimals = 18 - 8 + tokens.underlyingInfo.decimal + tokens.receiptInfo.decimal
    const supplied_amount = scaleDown(balanceOf * exchangeRateStored, normalizeDecimals)

    ctx.eventLogger.emit('positionSnapshot', {
      timestamp: block.timestamp,
      chain_id: ctx.chainId,
      pool_address: pool.pool_address,
      underlying_token_address: pool.underlying_token_address,
      underlying_token_symbol: pool.underlying_token_symbol,
      user_address: accountAddress,
      supplied_amount: supplied_amount,
      supplied_amount_usd: 0.0,
      borrowed_amount: borrow_amount,
      borrowed_amount_usd: 0.0
    })
  }))
}

async function snapshots(block: BlockParams, ctx: ContractContext<CToken, CTokenBoundContractView>) {
    await poolSnapshot(block, ctx)
    await positionSnapshot(block, ctx)
}

const MINUTES_PER_DAY = 60 * 24
// 1 block every 13 seconds
const ETH_BLOCKS_PER_DAY = 6646

const poolTemplate = new CTokenProcessorTemplate()
  .onEventMint(onEvent)
  .onTimeInterval(snapshots, MINUTES_PER_DAY, ETH_BLOCKS_PER_DAY)

ComptrollerProcessor.bind({address: "0x3d9819210A31b4961b30EF54bE2aeD79B9c9Cd3B", startBlock: 7710671})
  .onEventMarketListed(async (event, ctx) => {
    await createPool(event, ctx)
    poolTemplate.bind({address: event.args.cToken, startBlock: event.blockNumber}, ctx)
  })
