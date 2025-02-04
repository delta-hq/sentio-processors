/* Autogenerated file. Do not edit manually. */
/* tslint:disable */
/* eslint-disable */

/* Generated types for 0x64213b0e4a52bac468d4ac3f140242f70714381653a1919a6d57cd49c628207a, original address 0x64213b0e4a52bac468d4ac3f140242f70714381653a1919a6d57cd49c628207a */

import { TypeDescriptor, ANY_TYPE } from "@typemove/move";
import { MoveCoder, TypedEventInstance } from "@typemove/sui";

import { defaultMoveCoder } from "@sentio/sdk/sui";

import {
  ZERO_ADDRESS,
  TypedDevInspectResults,
  getMoveCoder,
} from "@typemove/sui";
import {
  Transaction,
  TransactionArgument,
  TransactionObjectArgument,
} from "@mysten/sui/transactions";
import { SuiClient } from "@mysten/sui/client";
import {
  transactionArgumentOrObject,
  transactionArgumentOrVec,
  transactionArgumentOrPure,
  transactionArgumentOrPureU8,
  transactionArgumentOrPureU16,
  transactionArgumentOrPureU32,
  transactionArgumentOrPureU64,
  transactionArgumentOrPureU128,
  transactionArgumentOrPureU256,
  transactionArgumentOrPureBool,
  transactionArgumentOrPureString,
  transactionArgumentOrPureAddress,
} from "@typemove/sui";

import { CallFilter, MoveFetchConfig } from "@sentio/sdk/move";
import {
  SuiBindOptions,
  SuiBaseProcessor,
  SuiNetwork,
  TypedFunctionPayload,
  SuiContext,
} from "@sentio/sdk/sui";

import * as _0x2 from "@sentio/sdk/sui/builtin/0x2";

export namespace treasury {
  export interface Treasury {
    id: _0x2.object$.UID;
    version: bigint;
    funds: _0x2.bag.Bag;
  }

  export namespace Treasury {
    export const TYPE_QNAME =
      "0x64213b0e4a52bac468d4ac3f140242f70714381653a1919a6d57cd49c628207a::treasury::Treasury";

    const TYPE = new TypeDescriptor<Treasury>(Treasury.TYPE_QNAME);

    export function type(): TypeDescriptor<Treasury> {
      return TYPE.apply();
    }
  }

  export namespace builder {
    export function assertVersion(
      tx: Transaction,
      args: [string | TransactionObjectArgument | TransactionArgument],
    ): TransactionArgument & [TransactionArgument] {
      const _args: any[] = [];
      _args.push(transactionArgumentOrObject(args[0], tx));

      // @ts-ignore
      return tx.moveCall({
        target:
          "0x64213b0e4a52bac468d4ac3f140242f70714381653a1919a6d57cd49c628207a::treasury::assert_version",
        arguments: _args,
      });
    }
    export function balanceOf<T0 = any>(
      tx: Transaction,
      args: [string | TransactionObjectArgument | TransactionArgument],
      typeArguments: [TypeDescriptor<T0> | string],
    ): TransactionArgument & [TransactionArgument] {
      const _args: any[] = [];
      _args.push(transactionArgumentOrObject(args[0], tx));

      // @ts-ignore
      return tx.moveCall({
        target:
          "0x64213b0e4a52bac468d4ac3f140242f70714381653a1919a6d57cd49c628207a::treasury::balance_of",
        arguments: _args,
        typeArguments: [
          typeof typeArguments[0] === "string"
            ? typeArguments[0]
            : typeArguments[0].getSignature(),
        ],
      });
    }
    export function deposit<T0 = any>(
      tx: Transaction,
      args: [
        string | TransactionObjectArgument | TransactionArgument,
        _0x2.coin.Coin<T0> | TransactionArgument,
      ],
      typeArguments: [TypeDescriptor<T0> | string],
    ): TransactionArgument & [TransactionArgument, TransactionArgument] {
      const _args: any[] = [];
      _args.push(transactionArgumentOrObject(args[0], tx));
      _args.push(transactionArgumentOrPure(args[1], tx));

      // @ts-ignore
      return tx.moveCall({
        target:
          "0x64213b0e4a52bac468d4ac3f140242f70714381653a1919a6d57cd49c628207a::treasury::deposit",
        arguments: _args,
        typeArguments: [
          typeof typeArguments[0] === "string"
            ? typeArguments[0]
            : typeArguments[0].getSignature(),
        ],
      });
    }
  }
  export namespace view {
    export async function assertVersion(
      client: SuiClient,
      args: [string],
    ): Promise<TypedDevInspectResults<[]>> {
      const tx = new Transaction();
      builder.assertVersion(tx, args);
      const inspectRes = await client.devInspectTransactionBlock({
        transactionBlock: tx,
        sender: ZERO_ADDRESS,
      });

      return (await getMoveCoder(client)).decodeDevInspectResult<[]>(
        inspectRes,
      );
    }
    export async function balanceOf<T0 = any>(
      client: SuiClient,
      args: [string],
      typeArguments: [TypeDescriptor<T0> | string],
    ): Promise<TypedDevInspectResults<[bigint]>> {
      const tx = new Transaction();
      builder.balanceOf(tx, args, typeArguments);
      const inspectRes = await client.devInspectTransactionBlock({
        transactionBlock: tx,
        sender: ZERO_ADDRESS,
      });

      return (await getMoveCoder(client)).decodeDevInspectResult<[bigint]>(
        inspectRes,
      );
    }
    export async function deposit<T0 = any>(
      client: SuiClient,
      args: [string, _0x2.coin.Coin<T0>],
      typeArguments: [TypeDescriptor<T0> | string],
    ): Promise<TypedDevInspectResults<[]>> {
      const tx = new Transaction();
      builder.deposit(tx, args, typeArguments);
      const inspectRes = await client.devInspectTransactionBlock({
        transactionBlock: tx,
        sender: ZERO_ADDRESS,
      });

      return (await getMoveCoder(client)).decodeDevInspectResult<[]>(
        inspectRes,
      );
    }
  }
}

const MODULES = JSON.parse(
  '[{"fileFormatVersion":6,"address":"0x64213b0e4a52bac468d4ac3f140242f70714381653a1919a6d57cd49c628207a","name":"treasury","friends":[],"structs":{"Treasury":{"abilities":{"abilities":["Key"]},"typeParameters":[],"fields":[{"name":"id","type":{"Struct":{"address":"0x2","module":"object","name":"UID","typeArguments":[]}}},{"name":"version","type":"U64"},{"name":"funds","type":{"Struct":{"address":"0x2","module":"bag","name":"Bag","typeArguments":[]}}}]}},"exposedFunctions":{"assert_version":{"visibility":"Public","isEntry":false,"typeParameters":[],"parameters":[{"Reference":{"Struct":{"address":"0x64213b0e4a52bac468d4ac3f140242f70714381653a1919a6d57cd49c628207a","module":"treasury","name":"Treasury","typeArguments":[]}}}],"return":[]},"balance_of":{"visibility":"Public","isEntry":false,"typeParameters":[{"abilities":[]}],"parameters":[{"MutableReference":{"Struct":{"address":"0x64213b0e4a52bac468d4ac3f140242f70714381653a1919a6d57cd49c628207a","module":"treasury","name":"Treasury","typeArguments":[]}}}],"return":["U64"]},"deposit":{"visibility":"Public","isEntry":false,"typeParameters":[{"abilities":[]}],"parameters":[{"MutableReference":{"Struct":{"address":"0x64213b0e4a52bac468d4ac3f140242f70714381653a1919a6d57cd49c628207a","module":"treasury","name":"Treasury","typeArguments":[]}}},{"Struct":{"address":"0x2","module":"coin","name":"Coin","typeArguments":[{"TypeParameter":0}]}}],"return":[]}}}]',
);

export function loadAllTypes(coder: MoveCoder) {
  _0x2.loadAllTypes(coder);
  for (const m of Object.values(MODULES)) {
    coder.load(
      m as any,
      "0x64213b0e4a52bac468d4ac3f140242f70714381653a1919a6d57cd49c628207a",
    );
  }
}

loadAllTypes(defaultMoveCoder(SuiNetwork.MAIN_NET));
