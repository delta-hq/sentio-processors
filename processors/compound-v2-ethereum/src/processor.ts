import { ContractContext, EthChainId } from "@sentio/sdk/eth";
import { ComptrollerProcessor, CTokenProcessorTemplate } from "./types/eth/index.js";
import { AccrueInterestEvent, BorrowEvent, CToken, CTokenBoundContractView, CTokenContext, getCTokenContract, MintEvent, RedeemEvent, RepayBorrowEvent, TransferEvent } from "./types/eth/ctoken.js";
import { token } from '@sentio/sdk/utils'
import { ComptrollerContext, MarketListedEvent } from "./types/eth/comptroller.js";
import { BigDecimal, scaleDown } from "@sentio/sdk";
import { BlockParams } from 'ethers/providers'
import { Account, Pool } from "./schema/store.js";

// Constants
const MINUTES_PER_DAY = 60 * 24;
const ETH_BLOCKS_PER_DAY = 6646;
const CETHER_ADDRESS = '0x4ddc2d193948926d02f9b1fe9e1daa0718270ed5'.toLowerCase();
const ETH_ADDRESS = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
const COMPTROLLER_ADDRESS = '0x3d9819210A31b4961b30EF54bE2aeD79B9c9Cd3B'.toLowerCase();
const COMPTROLLER_START_BLOCK = 7710671;
const MANTISSA_ONE = BigInt(1e18);

// Address helpers
function normalizeAddress(address: string): string {
  return address.toLowerCase();
}

function areAddressesEqual(address1: string, address2: string): boolean {
  return normalizeAddress(address1) === normalizeAddress(address2);
}

function normalizeAddressField(address: string | null | undefined): string {
  if (!address) {
    throw new Error('Address cannot be null or undefined');
  }
  return normalizeAddress(address);
}

// Helper functions
async function getOrCreateAccount(userAddress: string, poolAddress: string, ctx: CTokenContext): Promise<Account> {
  const normalizedUser = normalizeAddress(userAddress);
  const normalizedPool = normalizeAddress(poolAddress);
  const id = `${normalizedUser}-${normalizedPool}`;
  
  let account = await ctx.store.get(Account, id);
  if (!account) {
    await getOrCreatePool(normalizedPool, ctx);
    account = new Account({
      id,
      account: normalizedUser,
      poolID: normalizedPool,
      cTokenBalance: BigInt(0),
      borrowsNew: BigInt(0),
      lastAccountBorrowIndex: MANTISSA_ONE
    });
  }
  await ctx.store.upsert(account);
  return account;
}

async function getOrCreatePool(poolAddress: string, ctx: CTokenContext): Promise<Pool> {
  const normalizedAddress = normalizeAddress(poolAddress);
  let pool = await ctx.store.get(Pool, normalizedAddress);
  
  if (!pool) {
    // Get token info
    const isCEther = areAddressesEqual(normalizedAddress, CETHER_ADDRESS);
    let underlyingAddress: string;
    let underlyingInfo: token.TokenInfo;
    
    if (isCEther) {
      underlyingAddress = ETH_ADDRESS;
      underlyingInfo = {
        symbol: 'ETH',
        name: 'Ethereum',
        decimal: 18
      };
    } else {
      const cTokenContract = getCTokenContract(ctx.chainId, normalizedAddress);
      underlyingAddress = normalizeAddress(await cTokenContract.underlying());
      underlyingInfo = await token.getERC20TokenInfo(ctx, underlyingAddress);
    }
    
    const receiptInfo = await token.getERC20TokenInfo(ctx, normalizedAddress);

    pool = new Pool({
      id: normalizedAddress,
      borrowIndex: MANTISSA_ONE,
      chainId: Number(ctx.chainId),
      creationBlockNumber: BigInt(ctx.blockNumber),
      creationTimestamp: BigInt(ctx.timestamp.toUTCString()),
      underlyingTokenAddress: underlyingAddress,
      underlyingTokenSymbol: underlyingInfo.symbol,
      underlyingTokenDecimals: underlyingInfo.decimal,
      receiptTokenAddress: normalizedAddress,
      receiptTokenSymbol: receiptInfo.symbol,
      receiptTokenDecimals: receiptInfo.decimal,
      poolType: 'supply_pool'
    });
    await ctx.store.upsert(pool);
  }
  return pool;
}

function createEventLog(
  ctx: CTokenContext, 
  eventType: string, 
  userAddress: string, 
  takerAddress: string,
  tokenAddress: string, 
  amount: BigDecimal, 
  logIndex: number
) {
  return {
    timestamp: ctx.timestamp,
    chain_id: ctx.chainId,
    block_number: ctx.blockNumber,
    log_index: logIndex,
    transaction_hash: normalizeAddress(ctx.transactionHash!),
    user_address: normalizeAddress(userAddress),
    taker_address: normalizeAddress(takerAddress),
    pool_address: normalizeAddress(ctx.address),
    token_address: normalizeAddress(tokenAddress),
    amount,
    amount_usd: 0.0,
    event_type: eventType
  };
}

async function onEvent(event: MintEvent | BorrowEvent | RedeemEvent | RepayBorrowEvent, ctx: CTokenContext) {
  const args = event.args.toObject();
  const pool = await getOrCreatePool(event.address, ctx);
  
  const amount = scaleDown(
    event.name === 'Mint' ? args.mintAmount : 
    event.name === 'Redeem' ? args.redeemAmount : 
    event.name === 'Borrow' ? args.borrowAmount :
    args.repayAmount,
    pool.underlyingTokenDecimals
  );

  const userAddress = 
    event.name === 'Mint' ? args.minter :
    event.name === 'Redeem' ? args.redeemer :
    event.name === 'Borrow' ? args.borrower :
    args.payer;

  ctx.eventLogger.emit(event.name, createEventLog(
    ctx,
    event.name === 'Mint' ? 'deposit' :
    event.name === 'Redeem' ? 'withdrawal' :
    event.name === 'Borrow' ? 'borrow' :
    'repay',
    userAddress,
    event.name === 'RepayBorrow' ? args.borrower : userAddress,
    pool.underlyingTokenAddress,
    amount,
    event.index
  ));

  if (event.name === 'RepayBorrow' || event.name === 'Borrow') {
    const borrower = await getOrCreateAccount(args.borrower, event.address, ctx);
    borrower.borrowsNew = args.accountBorrows;
    borrower.lastAccountBorrowIndex = pool.borrowIndex;
    await ctx.store.upsert(borrower);
  }
}

async function onTransfer(event: TransferEvent, ctx: CTokenContext) {
  const args = event.args.toObject();
  const { from, to, amount } = args;
  const poolAddress = normalizeAddress(event.address);
  const fromAddress = normalizeAddress(from);
  const toAddress = normalizeAddress(to);

  if (!areAddressesEqual(fromAddress, poolAddress)) {
    const sender = await getOrCreateAccount(fromAddress, poolAddress, ctx);
    sender.cTokenBalance -= amount;
    await ctx.store.upsert(sender);
  }
  
  if (!areAddressesEqual(toAddress, poolAddress)) {
    const receiver = await getOrCreateAccount(toAddress, poolAddress, ctx);
    receiver.cTokenBalance += amount;
    await ctx.store.upsert(receiver);
  }
}

async function poolSnapshot(block: BlockParams, ctx: ContractContext<CToken, CTokenBoundContractView>) {
  const pool = await getOrCreatePool(ctx.contract.address, ctx);

  const [
    totalBorrows,
    totalSupply,
    exchangeRateStored,
    reserveFactorMantissa,
    supplyRatePerBlock,
    borrowRatePerBlock
  ] = await Promise.all([
    ctx.contract.totalBorrows(),
    ctx.contract.totalSupply(),
    ctx.contract.exchangeRateStored(),
    ctx.contract.reserveFactorMantissa(),
    ctx.contract.supplyRatePerBlock(),
    ctx.contract.borrowRatePerBlock()
  ]);

  const borrowAmount = scaleDown(totalBorrows, pool.underlyingTokenDecimals);
  const normalizeDecimals = 18 - 8 + pool.underlyingTokenDecimals + pool.receiptTokenDecimals;
  const suppliedAmount = scaleDown(totalSupply * exchangeRateStored, normalizeDecimals);

  ctx.eventLogger.emit('poolSnapshot', {
    timestamp: block.timestamp,
    chain_id: ctx.chainId,
    pool_address: pool.id,
    underlying_token_address: pool.underlyingTokenAddress,
    underlying_token_symbol: pool.underlyingTokenSymbol,
    available_amount: suppliedAmount.minus(borrowAmount),
    available_amount_usd: 0.0,
    supplied_amount: suppliedAmount,
    supplied_amount_usd: 0.0,
    collateral_amount: 0.0,
    collateral_amount_usd: 0.0,
    collateral_factor: scaleDown(reserveFactorMantissa, 18-2),
    supply_index: scaleDown(exchangeRateStored, 18 - 8 + pool.underlyingTokenDecimals),
    supply_apr: scaleDown(supplyRatePerBlock * BigInt(ETH_BLOCKS_PER_DAY*365), 18 - 2),
    borrowed_amount: borrowAmount,
    borrowed_amount_usd: 0.0,
    borrow_index: pool.borrowIndex,
    borrow_apr: scaleDown(borrowRatePerBlock * BigInt(ETH_BLOCKS_PER_DAY*365), 18 - 2),
    total_fees_usd: 0.0,
    user_fees_usd: 0.0,
    protocol_fees_usd: 0.0
  });
}

async function positionSnapshot(block: BlockParams, ctx: ContractContext<CToken, CTokenBoundContractView>) {
  const pool = await getOrCreatePool(ctx.contract.address, ctx);
  const exchangeRateStored = await ctx.contract.exchangeRateStored();
  
  const accounts = await ctx.store.list(Account, [{
    field: "poolID",
    op: "=",
    value: normalizeAddress(ctx.contract.address)
  }]);

  await Promise.all(accounts.map(async (account) => {
    const normalizeDecimals = 18 - 8 + pool.underlyingTokenDecimals + pool.receiptTokenDecimals;
    const suppliedAmount = scaleDown(account.cTokenBalance * exchangeRateStored, normalizeDecimals);
    const borrowAmount = scaleDown(account.borrowsNew * pool.borrowIndex / account.lastAccountBorrowIndex, pool.underlyingTokenDecimals);

    if (!suppliedAmount.isZero() || !borrowAmount.isZero()) {
      ctx.eventLogger.emit('positionSnapshot', {
        timestamp: block.timestamp,
        chain_id: ctx.chainId,
        pool_address: pool.id,
        underlying_token_address: pool.underlyingTokenAddress,
        underlying_token_symbol: pool.underlyingTokenSymbol,
        user_address: account.account,
        supplied_amount: suppliedAmount,
        supplied_amount_usd: 0.0,
        borrowed_amount: borrowAmount,
        borrowed_amount_usd: 0.0
      });
    }
  }));
}

async function onAccrueInterest(event: AccrueInterestEvent, ctx: CTokenContext) {
  const args = event.args.toObject();
  const pool = await getOrCreatePool(event.address, ctx);
  pool.borrowIndex = args.borrowIndex;
  await ctx.store.upsert(pool);
}

async function snapshots(block: BlockParams, ctx: ContractContext<CToken, CTokenBoundContractView>) {
  await Promise.all([
    poolSnapshot(block, ctx),
    positionSnapshot(block, ctx)
  ]);
}

// Processor setup
const poolTemplate = new CTokenProcessorTemplate()
  .onEventMint(onEvent)
  .onEventRedeem(onEvent)
  .onEventBorrow(onEvent)
  .onEventRepayBorrow(onEvent)
  .onEventAccrueInterest(onAccrueInterest)
  .onEventTransfer(onTransfer)
  .onTimeInterval(snapshots, MINUTES_PER_DAY, MINUTES_PER_DAY);

ComptrollerProcessor.bind({
  address: COMPTROLLER_ADDRESS,
  startBlock: COMPTROLLER_START_BLOCK
}).onEventMarketListed(async (event, ctx) => {
  poolTemplate.bind({
    address: event.args.cToken,
    startBlock: event.blockNumber
  }, ctx);
});
