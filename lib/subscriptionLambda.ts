import { DescribeLogGroupsResponse, LogGroup, CloudWatchLogsClient, DescribeLogGroupsCommand, PutSubscriptionFilterCommand } from '@aws-sdk/client-cloudwatch-logs'
import { SSMCache } from '@enfo/aws-secrets'
import { parseEnvString, parseVariables, VariableType } from '@enfo/env-vars'
// @ts-ignore
import { tap, map, trim, pipe, concat, anyPass, filter, reject } from 'ramda'

const ssmCache = new SSMCache({
  region: parseEnvString('AWS_REGION', 'eu-west-1'),
  defaultTTL: 300
})
const cwl = new CloudWatchLogsClient({})
const { kinesisStream, inclusions, exclusions, cloudWatchRole } = parseVariables<{
  kinesisStream: string,
  inclusions: string,
  exclusions: string,
  cloudWatchRole: string
}>({
  variables: [
    {
      name: 'kinesisStream',
      type: VariableType.STRING,
      required: true
    },
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
      name: 'cloudWatchRole',
      type: VariableType.STRING,
      required: true
    }
  ]
})

// istanbul ignore next
const getInclusionPatterns = (): Promise<string[]> =>
  ssmCache.getStringListParameter({ Name: inclusions })
    .then(map(trim))
    .then(tap(console.log))
// istanbul ignore next
const getExclusionPatterns = (): Promise<string[]> =>
  ssmCache.getStringListParameter({ Name: exclusions })
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
// istanbul ignore next
const getLogGroups = (token?: string): Promise<LogGroup[]> =>
  cwl.send(new DescribeLogGroupsCommand({ nextToken: token }))
    .then(({ logGroups, nextToken }: DescribeLogGroupsResponse) =>
      !nextToken
        ? logGroups ?? []
        : getLogGroups(nextToken).then(concat(logGroups ?? [])))

// istanbul ignore next
export const getLogGroupsAndPatterns = (): Promise<[string[], string[], string[]]> =>
  Promise.all([
    getLogGroups()
      .then((logGroups: LogGroup[]): string[] => {
        return logGroups.reduce((acc: string[], curr: LogGroup): string[] => {
          if (!curr.logGroupName) {
            return acc
          }
          acc.push(curr.logGroupName)
          return acc
        }, [])
      }),
    getInclusionPatterns(),
    getExclusionPatterns()
  ])
export const filterLogGroups = ([logGroupNames, inclusionPatterns, exclusionPatterns]: [string[], string[], string[]]) =>
  pipe(
    reject(test(/[sS]niffles/)), // if anything in the Sniffle pipeline gets into the pipeline we'll get a feedback loop
    filter(anyPass(patternsToFunctions(inclusionPatterns))),
    reject(anyPass(patternsToFunctions(exclusionPatterns)))
  )(logGroupNames)
// istanbul ignore next
export const subscribeLogGroup = (logGroupName: string) =>
  cwl.send(new PutSubscriptionFilterCommand({
    logGroupName,
    roleArn: cloudWatchRole,
    filterPattern: '',
    filterName: 'LogsToKinesis',
    destinationArn: kinesisStream,
    distribution: 'Random'
  }))
    .catch(console.warn)

export const handler = (): Promise<string | void> =>
  getLogGroupsAndPatterns()
    .then(filterLogGroups)
    .then(tap(console.log))
    .then(map(subscribeLogGroup))
    .then(Promise.all.bind(Promise))
    .then(() => 'OK')
    .catch(console.error)
