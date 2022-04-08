/* eslint-disable @typescript-eslint/no-explicit-any */
import { SSMCache } from '@enfo/aws-secrets'
import { parseEnvString, parseVariables, VariableType } from '@enfo/env-vars'
import { KinesisStreamEvent, KinesisStreamRecord } from 'aws-lambda'
import SNS from 'aws-sdk/clients/sns'
import { Option, tryCatch as optTryCatch, chain as optchain, map as optmap, getOrElse as optGetOrElse, none, some } from 'fp-ts/lib/Option'
import { apply as jspathApply } from 'jspath'

import anyPass from 'ramda/src/anyPass'
import both from 'ramda/src/both'
import chain from 'ramda/src/chain'
import cond from 'ramda/src/cond'
import drop from 'ramda/src/drop'
import endsWith from 'ramda/src/endsWith'
import filter from 'ramda/src/filter'
import flip from 'ramda/src/flip'
import gt from 'ramda/src/gt'
import head from 'ramda/src/head'
import ifElse from 'ramda/src/ifElse'
import includes from 'ramda/src/includes'
import isEmpty from 'ramda/src/isEmpty'
import length from 'ramda/src/length'
import lensProp from 'ramda/src/lensProp'
import map from 'ramda/src/map'
import match from 'ramda/src/match'
import path from 'ramda/src/path'
import pathSatisfies from 'ramda/src/pathSatisfies'
import pipe from 'ramda/src/pipe'
import prop from 'ramda/src/prop'
import set from 'ramda/src/set'
import split from 'ramda/src/split'
import startsWith from 'ramda/src/startsWith'
import T from 'ramda/src/T'
import tail from 'ramda/src/tail'
import take from 'ramda/src/take'
import tap from 'ramda/src/tap'
import test from 'ramda/src/test'
import toString from 'ramda/src/toString'
import trim from 'ramda/src/trim'
import { gunzipSync } from 'zlib'

interface LogEvent {
  readonly id: string
  readonly timestamp: number
  readonly message: string
}
type LogEvents = ReadonlyArray<LogEvent>
interface LogMessage {
  readonly messageType: string
  readonly owner: string
  readonly logGroup: string
  readonly logStream: string
  readonly subscriptionFilters: string[]
  readonly logEvents: LogEvents
  readonly logLink?: string
}
type LogMessages = ReadonlyArray<LogMessage>

const { accountId, errorMessage, patternsName, topicArn } = parseVariables<{
  accountId: string,
  errorMessage: string,
  patternsName: string,
  topicArn: string
}>({
  variables: [
    {
      name: 'accountId',
      type: VariableType.STRING,
      required: true
    },
    {
      name: 'errorMessage',
      type: VariableType.STRING,
      required: true
    },
    {
      name: 'patternsName',
      type: VariableType.STRING,
      required: true
    },
    {
      name: 'topicArn',
      type: VariableType.STRING,
      required: true
    }
  ]
})

const awsRegion = parseEnvString('AWS_REGION', 'eu-west-1')
const ssmCache = new SSMCache({
  region: awsRegion,
  defaultTTL: 60
})
const sns = new SNS()
const getWhitelist = () =>
  ssmCache.getStringListParameter({ Name: patternsName })
    .then(map(trim))
const groupMatch = (re: RegExp) =>
  pipe<any, string[], Option<string[]>>(
    match(re),
    ifElse(
      isEmpty,
      () => none,
      pipe<any, string[], Option<string[]>>(
        tail,
        some
      )
    )
  )
const toRegExp = pipe<any, string[], RegExp>(
  match(/^\/([^/]+)\/([gimsuy]*)$/),
  ([_, re, flags]) => new RegExp(re, flags)
)
const base64decode = (str: string) => Buffer.from(str, 'base64')
const unzip = (buf: Buffer) => {
  try {
    return gunzipSync(buf)
  } catch {
    return buf
  }
}
const parseRecord = pipe<any, string, Buffer, Buffer, string, LogMessage, LogMessages>(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  path(['kinesis', 'data']) as any,
  base64decode,
  unzip,
  toString,
  JSON.parse,
  (m: LogMessage) => map((logEvent: LogEvent) => ({ ...m, logEvents: [logEvent] }))(m.logEvents)
)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const parseMessage = (log: any) => {
  try {
    return JSON.parse(log.logEvents[0].message).message
  } catch (_) {
    return ''
  }
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const publishLog = (log: any) =>
  sns.publish({
    TopicArn: topicArn,
    Message: JSON.stringify(log),
    Subject: take(100, `${accountId} ${log.logGroup} ${parseMessage(log) || errorMessage}`),
    MessageAttributes: {
      eventType: { DataType: 'String', StringValue: 'create' }
    }
  }).promise()

export const
  toStringFn = includes
export const toRegExpFn = pipe<any, any, any>(toRegExp, test)
export const toJspathFn = (str: string) =>
  pipe<any, Option<string[]>, Option<string>, Option<any>, Option<any[]>, Option<number>, Option<boolean>, boolean>(
    groupMatch(/({[\s\S]+})/), // . doesn't match newlines, use [\s\S] instead
    optmap<string[], string>(head),
    optchain<string, any>((stringToParse: string) => optTryCatch(() => JSON.parse(stringToParse))),
    optmap<any, any[]>((message: any) => jspathApply(`.${str}`, message)),
    optmap<any[], number>(length),
    optmap<number, boolean>(flip(gt)(0)),
    optGetOrElse<boolean>(() => false)
  )
export const toWhitelistFn = cond([
  [test(/^\/[^/]+\/[gimsuy]*$/), toRegExpFn],
  [both(startsWith('{'), endsWith('}')), toJspathFn],
  [T, toStringFn]
])
export const getLogId = pipe<any, string, string[], string[], string>(
  path(['logEvents', 0, 'message']) as unknown as (x: LogMessage) => string,
  split('\t'),
  drop(1),
  head
)
export const addLogLink = (m: LogMessage) =>
  set(lensProp('logLink'), `https://${awsRegion}.console.aws.amazon.com/cloudwatch/home?region=${awsRegion}#logsV2:log-groups/log-group/${m.logGroup.replace(/\//g, '$252F')}/log-events$3FfilterPattern$3D$2522${getLogId(m)}$2522`, m)

export const handler = (event: KinesisStreamEvent) =>
  getWhitelist()
    // .then(tap(console.log))
    .then(map(toWhitelistFn))
    .then((whitelistFns) => pipe<any, KinesisStreamRecord[], LogMessages, LogMessages, LogMessages, LogMessages, Promise<SNS.Types.PublishResponse>[], Promise<SNS.Types.PublishResponse[]>>(
      prop<string, any>('Records'),
      chain(parseRecord),
      filter(pathSatisfies(anyPass(whitelistFns))(['logEvents', 0, 'message'])) as unknown as (x: LogMessages) => LogMessages,
      map(addLogLink),
      tap((x) => console.log(`Found ${x.length} entries`)),
      map(publishLog),
      Promise.all.bind(Promise)
    )(event))
    // .then(tap(console.log))
    .then(() => 'OK')
    .catch(console.error)
