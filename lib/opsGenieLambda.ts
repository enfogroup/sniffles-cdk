import { SNSEvent } from 'aws-lambda'
import SNS from 'aws-sdk/clients/sns'
import take from 'ramda/src/take'

import { LogMessage } from './filterLambda'

interface LogLine {
  message: string
}

const sns = new SNS()

export const handler = async (event: SNSEvent): Promise<string> => {
  const logMessage: LogMessage = JSON.parse(event.Records[0].Sns.Message)
  const { message, owner, logGroup } = logMessage
  const logLine: LogLine = JSON.parse(message)

  await sns.publish({
    Subject: take(100, `${owner} ${logGroup} ${logLine.message}`),
    Message: JSON.stringify(logMessage),
    MessageAttributes: {
      eventType: { DataType: 'String', StringValue: 'create' }
    }
  }).promise()
  return 'OK'
}
