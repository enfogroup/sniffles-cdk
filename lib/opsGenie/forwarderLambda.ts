import { parseEnvString } from '@enfo/env-vars'
// @ts-ignore
import { take } from 'ramda'
import { SNSClient, PublishInput, PublishCommand } from '@aws-sdk/client-sns'
import { SNSEvent } from 'aws-lambda'

import { LogMessage } from '../filterLambda'

interface LogLine {
  message: string
}

const sns = new SNSClient({})
const topic = parseEnvString('topic', { required: true })

// istanbul ignore next
export const publish = async (input: PublishInput): Promise<void> => {
  await sns.send(new PublishCommand(input))
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
