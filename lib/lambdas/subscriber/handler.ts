import * as CloudWatchLogs from 'aws-sdk/clients/cloudwatchlogs'
import { SSMCache } from '@enfo/aws-secrets'
import { parseEnvString, VariableType } from '@enfo/env-vars'
import { parseVariables } from '@enfo/env-vars/clients/parse'

const logsClient = new CloudWatchLogs()
const ssmClient = new SSMCache({
  defaultTTL: 60,
  region: parseEnvString('AWS_REGION', 'eu-west-1')
})

const env = parseVariables<{
  kinesisArn: string,
  logGroupsParameter: string,
  cloudWatchRole: string
}>({
  variables: [
    {
      type: VariableType.STRING,
      name: 'kinesisArn',
      required: true
    },
    {
      type: VariableType.STRING,
      name: 'logGroupsParameter',
      required: true
    },
    {
      type: VariableType.STRING,
      name: 'cloudWatchRole',
      required: true
    }
  ]
})

export const handler = async (): Promise<void> => {
  const [groups, patterns] = await Promise.all([
    getLogGroups(),
    ssmClient.getParameter({ Name: env.logGroupsParameter })
  ])
}

const getLogGroups = async (): Promise<string[]> => {
  const groups: string[] = []
  let nextToken
  let logGroups: CloudWatchLogs.DescribeLogGroupsResponse['logGroups']
  while (true) {
    ({ logGroups, nextToken } = await logsClient.describeLogGroups({ nextToken }).promise())
    if (logGroups) {
      groups.push(...logGroups.map((group) => group.logGroupName || ''))
    }
    if (!nextToken) {
      return groups
    }
  }
}
