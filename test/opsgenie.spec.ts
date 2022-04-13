import * as opsGenie from '../lib/opsGenie/forwarderLambda'

import { SNSEvent } from 'aws-lambda'
import { LogMessage } from '../lib/filterLambda'

describe('OpsGenie lambda', () => {
  describe('handler', () => {
    it('should extract and format input for sns publish', async () => {
      const logLine = {
        message: 'hello there'
      }
      const logMessage: LogMessage = {
        owner: '111122223333',
        logEvents: [{
          id: '123',
          timestamp: 1,
          message: JSON.stringify(logLine)
        }],
        logGroup: 'logGroup!'
      } as unknown as LogMessage
      const input: SNSEvent = {
        Records: [{
          Sns: {
            Message: JSON.stringify(logMessage)
          }
        }]
      } as unknown as SNSEvent
      const publishMock = jest.spyOn(opsGenie, 'publish').mockResolvedValue()

      const output = await opsGenie.handler(input)

      expect(output).toEqual('OK')
      expect(publishMock.mock.calls[0][0]).toMatchObject({
        Message: '{"owner":"111122223333","logEvents":[{"id":"123","timestamp":1,"message":"{\\"message\\":\\"hello there\\"}"}],"logGroup":"logGroup!"}',
        Subject: '111122223333 logGroup! hello there',
        MessageAttributes: {
          eventType: {
            DataType: 'String',
            StringValue: 'create'
          }
        }
      })
    })
  })
})
