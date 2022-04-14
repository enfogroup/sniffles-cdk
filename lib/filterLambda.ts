/* eslint-disable @typescript-eslint/no-explicit-any */
import { SSMCache } from '@enfo/aws-secrets'
import { parseEnvString, parseVariables, VariableType } from '@enfo/env-vars'
import { KinesisStreamEvent, KinesisStreamRecord } from 'aws-lambda'
import * as SNS from 'aws-sdk/clients/sns'
import { Option, tryCatch as optTryCatch, chain as optchain, map as optmap, getOrElse as optGetOrElse, none, some } from 'fp-ts/lib/Option'
import { apply as jspathApply } from 'jspath'

// @ts-ignore
import { anyPass, both, chain, cond, endsWith, filter, flip, gt, head, ifElse, includes, isEmpty, length, map, match, path, pathSatisfies, pipe, prop, startsWith, T, tail, tap, test, toString, trim, reject } from 'ramda'
import { gunzipSync } from 'zlib'

export interface LogEvent {
  readonly id: string
  readonly timestamp: number
  readonly message: string
}
export type LogEvents = LogEvent[]
export interface LogMessage {
  readonly messageType: string
  readonly owner: string
  readonly logGroup: string
  readonly logStream: string
  readonly subscriptionFilters: string[]
  readonly logEvents: LogEvents
  readonly logLink?: string
}
export type LogMessages = LogMessage[]

const { inclusions, topicArn, exclusions } = parseVariables<{
  inclusions: string,
  exclusions: string,
  topicArn: string
}>({
  variables: [
    {
      name: 'inclusions',
      type: VariableType.STRING,
      required: true
    },
    {
      name: 'exclusions',
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
  defaultTTL: 300
})
const sns = new SNS()
// istanbul ignore next
export const getInclusionPatterns = () =>
  ssmCache.getStringListParameter({ Name: inclusions })
    .then(map(trim))
// istanbul ignore next
export const getExclusionPatterns = () =>
  ssmCache.getStringListParameter({ Name: exclusions })
    .then(map(trim))
// istanbul ignore next
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
// istanbul ignore next
const toRegExp = pipe<any, string[], RegExp>(
  match(/^\/([^/]+)\/([gimsuy]*)$/),
  ([_, re, flags]: [string, string, string]) => new RegExp(re, flags)
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

// istanbul ignore next
export const publishLog = async (log: object) => {
  await sns.publish({
    TopicArn: topicArn,
    Message: JSON.stringify(log)
  }).promise()
}

export const
  toStringFn = includes
export const toRegExpFn = pipe<any, any, any>(toRegExp, test)
// istanbul ignore next
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
export const toMatcherFunction = cond([
  [test(/^\/[^/]+\/[gimsuy]*$/), toRegExpFn],
  [both(startsWith('{'), endsWith('}')), toJspathFn],
  [T, toStringFn]
])
const getPatternsFunctions = async () =>
  Promise.all([
    getInclusionPatterns().then(map(toMatcherFunction)),
    getExclusionPatterns().then(map(toMatcherFunction))
  ])

export const handler = (event: KinesisStreamEvent) =>
  getPatternsFunctions()
    // .then(tap(console.log))
    .then(([inclusionFunctions, exclusionFunctions]) => pipe<any, KinesisStreamRecord[], LogMessages, LogMessages, LogMessages, LogMessages, Promise<void>[], Promise<void[]>>(
      prop<string, any>('Records'),
      chain(parseRecord),
      filter(pathSatisfies(anyPass(inclusionFunctions))(['logEvents', 0, 'message'])) as unknown as (x: LogMessages) => LogMessages,
      reject(pathSatisfies(anyPass(exclusionFunctions))(['logEvents', 0, 'message'])) as unknown as (x: LogMessages) => LogMessages,
      tap((x: any[]) => console.log(`Found ${x.length} entries`)),
      map(publishLog),
      Promise.all.bind(Promise)
    )(event))
    // .then(tap(console.log))
    .then(() => 'OK')
    .catch(console.error)
