
/* Autogenerated file. Do not edit manually. */
/* tslint:disable */
/* eslint-disable */
import type { String, Int, BigInt, Float, ID, Bytes, Timestamp, Boolean } from '@sentio/sdk/store'
import { Entity, Required, One, Many, Column, ListColumn, AbstractEntity } from '@sentio/sdk/store'
import { BigDecimal } from '@sentio/bigdecimal'
import { DatabaseSchema } from '@sentio/sdk'







interface PoolTokenStateConstructorInput {
  id: ID;
  timestamp: BigInt;
  pool_address: String;
  token_index: Int;
  token_address: String;
  token_symbol: String;
  token_amount: BigDecimal;
  token_amount_usd?: BigDecimal;
  volume_amount: BigDecimal;
  volume_usd?: BigDecimal;
  fee_rate: BigDecimal;
  total_fees_usd?: BigDecimal;
  user_fees_usd?: BigDecimal;
  protocol_fees_usd?: BigDecimal;
}
@Entity("PoolTokenState")
export class PoolTokenState extends AbstractEntity  {

	@Required
	@Column("ID")
	id: ID

	@Required
	@Column("BigInt")
	timestamp: BigInt

	@Required
	@Column("String")
	pool_address: String

	@Required
	@Column("Int")
	token_index: Int

	@Required
	@Column("String")
	token_address: String

	@Required
	@Column("String")
	token_symbol: String

	@Required
	@Column("BigDecimal")
	token_amount: BigDecimal

	@Column("BigDecimal")
	token_amount_usd?: BigDecimal

	@Required
	@Column("BigDecimal")
	volume_amount: BigDecimal

	@Column("BigDecimal")
	volume_usd?: BigDecimal

	@Required
	@Column("BigDecimal")
	fee_rate: BigDecimal

	@Column("BigDecimal")
	total_fees_usd?: BigDecimal

	@Column("BigDecimal")
	user_fees_usd?: BigDecimal

	@Column("BigDecimal")
	protocol_fees_usd?: BigDecimal
  constructor(data: PoolTokenStateConstructorInput) {super()}
  
}


interface PoolInfoConstructorInput {
  id: ID;
  fee_rate?: BigDecimal;
  current_tick?: BigDecimal;
  tick_spacing?: BigDecimal;
  symbol_0?: String;
  symbol_1?: String;
  decimals_0?: Int;
  decimals_1?: Int;
  token_0?: String;
  token_1?: String;
}
@Entity("PoolInfo")
export class PoolInfo extends AbstractEntity  {

	@Required
	@Column("ID")
	id: ID

	@Column("BigDecimal")
	fee_rate?: BigDecimal

	@Column("BigDecimal")
	current_tick?: BigDecimal

	@Column("BigDecimal")
	tick_spacing?: BigDecimal

	@Column("String")
	symbol_0?: String

	@Column("String")
	symbol_1?: String

	@Column("Int")
	decimals_0?: Int

	@Column("Int")
	decimals_1?: Int

	@Column("String")
	token_0?: String

	@Column("String")
	token_1?: String
  constructor(data: PoolInfoConstructorInput) {super()}
  
}


interface UserStateConstructorInput {
  id: ID;
  user: String;
}
@Entity("UserState")
export class UserState extends AbstractEntity  {

	@Required
	@Column("ID")
	id: ID

	@Required
	@Column("String")
	user: String
  constructor(data: UserStateConstructorInput) {super()}
  
}


interface UserPoolConstructorInput {
  id: ID;
  user_address: String;
  pool_address: String;
  amount_0: BigDecimal;
  amount_1: BigDecimal;
  amount_0_in_range: BigDecimal;
  amount_1_in_range: BigDecimal;
}
@Entity("UserPool")
export class UserPool extends AbstractEntity  {

	@Required
	@Column("ID")
	id: ID

	@Required
	@Column("String")
	user_address: String

	@Required
	@Column("String")
	pool_address: String

	@Required
	@Column("BigDecimal")
	amount_0: BigDecimal

	@Required
	@Column("BigDecimal")
	amount_1: BigDecimal

	@Required
	@Column("BigDecimal")
	amount_0_in_range: BigDecimal

	@Required
	@Column("BigDecimal")
	amount_1_in_range: BigDecimal
  constructor(data: UserPoolConstructorInput) {super()}
  
}


interface UserPositionConstructorInput {
  id: ID;
  user_address: String;
  position_id: String;
  pool_address: String;
  timestamp: BigInt;
  amount_0: BigDecimal;
  amount_1: BigDecimal;
  amount_usd: BigDecimal;
  lower_tick: BigDecimal;
  upper_tick: BigDecimal;
  liquidity: BigDecimal;
}
@Entity("UserPosition")
export class UserPosition extends AbstractEntity  {

	@Required
	@Column("ID")
	id: ID

	@Required
	@Column("String")
	user_address: String

	@Required
	@Column("String")
	position_id: String

	@Required
	@Column("String")
	pool_address: String

	@Required
	@Column("BigInt")
	timestamp: BigInt

	@Required
	@Column("BigDecimal")
	amount_0: BigDecimal

	@Required
	@Column("BigDecimal")
	amount_1: BigDecimal

	@Required
	@Column("BigDecimal")
	amount_usd: BigDecimal

	@Required
	@Column("BigDecimal")
	lower_tick: BigDecimal

	@Required
	@Column("BigDecimal")
	upper_tick: BigDecimal

	@Required
	@Column("BigDecimal")
	liquidity: BigDecimal
  constructor(data: UserPositionConstructorInput) {super()}
  
}


const source = `type PoolTokenState @entity {
  id: ID!
  timestamp: BigInt!
  pool_address: String!
  token_index: Int!
  token_address: String!
  token_symbol: String!
  token_amount: BigDecimal!
  token_amount_usd: BigDecimal
  volume_amount: BigDecimal!
  volume_usd: BigDecimal
  fee_rate: BigDecimal!
  total_fees_usd: BigDecimal
  user_fees_usd: BigDecimal
  protocol_fees_usd: BigDecimal
}

type PoolInfo @entity {
  id: ID!
  fee_rate: BigDecimal
  current_tick: BigDecimal
  tick_spacing: BigDecimal
  symbol_0: String
  symbol_1: String
  decimals_0: Int
  decimals_1: Int
  token_0: String
  token_1: String
}

type UserState @entity {
  id: ID!
  user: String!
}

type UserPool @entity {
  id: ID! # user-position id
  user_address: String!
  pool_address: String!
  amount_0: BigDecimal!
  amount_1: BigDecimal!
  amount_0_in_range: BigDecimal!
  amount_1_in_range: BigDecimal!
}

type UserPosition @entity {
  id: ID! # position ID
  user_address: String!
  position_id: String!
  pool_address: String!
  timestamp: BigInt!
  amount_0: BigDecimal!
  amount_1: BigDecimal!
  amount_usd: BigDecimal!
  lower_tick: BigDecimal!
  upper_tick: BigDecimal!
  liquidity: BigDecimal!
}
`
DatabaseSchema.register({
  source,
  entities: {
    "PoolTokenState": PoolTokenState,
		"PoolInfo": PoolInfo,
		"UserState": UserState,
		"UserPool": UserPool,
		"UserPosition": UserPosition
  }
})
