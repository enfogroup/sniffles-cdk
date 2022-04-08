import CloudWatchLogs from 'aws-sdk/clients/cloudwatchlogs'
import { SSMCache } from '@enfo/aws-secrets'
import { parseEnvString, parseVariables, VariableType } from '@enfo/env-vars'

import tap from 'ramda/src/tap'
import map from 'ramda/src/map'
import trim from 'ramda/src/trim'
import pipe from 'ramda/src/pipe'
import concat from 'ramda/src/concat'
import anyPass from 'ramda/src/anyPass'
import filter from 'ramda/src/filter'
import reject from 'ramda/src/reject'

const ssmCache = new SSMCache({
  region: parseEnvString('AWS_REGION', 'eu-west-1'),
  defaultTTL: 60
})
const cwl = new CloudWatchLogs()
const { kinesisArn, patternsName, cloudWatchRole } = parseVariables<{
  kinesisArn: string,
  patternsName: string,
  cloudWatchRole: string
}>({
  variables: [
    {
      name: 'kinesisArn',
      type: VariableType.STRING,
      required: true
    },
    {
      name: 'patternsName',
      type: VariableType.STRING,
      required: true
    },
    {
      name: 'cloudWatchRole',
      type: VariableType.STRING,
      required: true
    }
  ]
})

const getPatterns = (): Promise<string[]> =>
  ssmCache.getStringListParameter({ Name: patternsName })
    .then(map(trim))
    .then(tap(console.log))
const toRegExp = (str: string) => new RegExp(str)
const test = (re: RegExp) => (str: string) => re.test(str)
const patternsToFunctions = map(
  pipe(
    toRegExp,
    test
  )
)
const getLogGroups = (token?: string): Promise<CloudWatchLogs.LogGroup[]> =>
  cwl.describeLogGroups({ nextToken: token }).promise()
    .then(({ logGroups, nextToken }) =>
      !nextToken
        ? logGroups ?? []
        : getLogGroups(nextToken).then(concat(logGroups ?? [])))
const getLogGroupsAndPatterns = (): Promise<[string[], string[]]> =>
  Promise.all([
    getLogGroups()
      .then((logGroups: CloudWatchLogs.LogGroup[]): string[] => {
        return logGroups.reduce((acc: string[], curr: CloudWatchLogs.LogGroup): string[] => {
          if (!curr.logGroupName) {
            return acc
          }
          acc.push(curr.logGroupName)
          return acc
        }, [])
      }),
    getPatterns()
  ])
const filterLogGroups = ([logGroupNames, patterns]: [string[], string[]]) =>
  pipe(
    reject(test(/Sniffles/)), // if anything in the Sniffle pipeline gets into the pipeline we'll get a feedback loop
    filter(anyPass(patternsToFunctions(patterns)))
  )(logGroupNames)
const subscribeLogGroup = (logGroupName: string) =>
  cwl.putSubscriptionFilter({
    logGroupName,
    roleArn: cloudWatchRole,
    filterPattern: '',
    filterName: 'LogsToKinesis',
    destinationArn: kinesisArn,
    distribution: 'Random'
  }).promise()
    .catch(console.warn)

exports.handler = (): Promise<string | void> =>
  getLogGroupsAndPatterns()
    .then(filterLogGroups)
    .then(tap(console.log))
    .then(map(subscribeLogGroup))
    .then(Promise.all.bind(Promise))
    .then(() => 'OK')
    .catch(console.error)
