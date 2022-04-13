import { parseEnvString } from '@enfo/env-vars'
import SNS from 'aws-sdk/clients/sns'
import take from 'ramda/src/take'

import { LogMessage } from './filterLambda'

import { SNSEvent } from 'aws-lambda'

interface LogLine {
  message: string
}

const sns = new SNS()
const topic = parseEnvString('topic', { required: true })

export const handler = async (event: SNSEvent): Promise<string> => {
  const logMessage: LogMessage = JSON.parse(event.Records[0].Sns.Message)
  const { logEvents, owner, logGroup } = logMessage
  const logLine: LogLine = JSON.parse(logEvents[0].message)

  await sns.publish({
    TopicArn: topic,
    Subject: take(100, `${owner} ${logGroup} ${logLine.message}`),
    Message: JSON.stringify(logMessage),
    MessageAttributes: {
      eventType: { DataType: 'String', StringValue: 'create' }
    }
  }).promise()
  return 'OK'
}
