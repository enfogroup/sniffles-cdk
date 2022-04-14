import { parseEnvString } from '@enfo/env-vars'
import * as SNS from 'aws-sdk/clients/sns'
// @ts-ignore
import take from 'ramda/src/take'

import { LogMessage } from '../filterLambda'

import { SNSEvent } from 'aws-lambda'

interface LogLine {
  message: string
}

const sns = new SNS()
const topic = parseEnvString('topic', { required: true })

// istanbul ignore next
export const publish = async (input: SNS.PublishInput): Promise<void> => {
  await sns.publish(input).promise()
}

export const handler = async (event: SNSEvent): Promise<string> => {
  const logMessage: LogMessage = JSON.parse(event.Records[0].Sns.Message)
  const { logEvents, owner, logGroup } = logMessage
  const logLine: LogLine = JSON.parse(logEvents[0].message)

  await publish({
    TopicArn: topic,
    Subject: take(100, `${owner} ${logGroup} ${logLine.message}`),
    Message: JSON.stringify(logMessage),
    MessageAttributes: {
      eventType: { DataType: 'String', StringValue: 'create' }
    }
  })
  return 'OK'
}
