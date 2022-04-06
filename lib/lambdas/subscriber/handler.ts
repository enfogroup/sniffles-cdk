import * as CloudWatchLogs from 'aws-sdk/clients/cloudwatchlogs'
import { SSMCache } from '@enfo/aws-secrets'

const logsClient = new CloudWatchLogs()
const ssmClient = new SSMCache({
  defaultTTL: 60,
  region: process.env.AWS_REGION! // FIXME
})

export const handler = async (): Promise<void> => {
  const [groups, patterns] = await Promise.all([
    getLogGroups(),
    ssmClient.getParameter({ Name: '' })
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
