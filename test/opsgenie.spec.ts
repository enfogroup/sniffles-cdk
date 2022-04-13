import * as opsGenie from '../lib/opsGenie/forwarderLambda'
import { OpsGenieForwarder } from '../lib/opsGenie'

import '@aws-cdk/assert/jest'

import { SNSEvent } from 'aws-lambda'
import { LogMessage } from '../lib/filterLambda'
import { Stack } from 'aws-cdk-lib'
import { Topic } from 'aws-cdk-lib/aws-sns'
import { Match, Template } from 'aws-cdk-lib/assertions'

describe('OpsGenie lambda logic', () => {
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

describe('OpsGenie Forwarder Construct', () => {
  describe('Lambda', () => {
    it('should create a lambda', () => {
      const stack = new Stack()

      new OpsGenieForwarder(stack, 'Test', {
        opsGenieTopic: new Topic(stack, 'Topic'),
        cloudWatchTopic: new Topic(stack, 'CWTopic')
      })

      const template = Template.fromStack(stack)
      template.hasResourceProperties('AWS::Lambda::Function', Match.objectLike({
        Environment: {
          Variables: {
            topic: {}
          }
        }
      }))
    })
  })

  describe('CloudWatch', () => {
    it('should create alarms', () => {
      const stack = new Stack()
      new OpsGenieForwarder(stack, 'Test', {
        opsGenieTopic: new Topic(stack, 'Topic'),
        cloudWatchTopic: new Topic(stack, 'CWTopic')
      })

      expect(stack).toCountResources('AWS::CloudWatch::Alarm', 4) // 3 + 1 for the DLQ
    })

    it('should setup alarms for the DLQ', () => {
      const stack = new Stack()
      new OpsGenieForwarder(stack, 'Test', {
        opsGenieTopic: new Topic(stack, 'Topic'),
        cloudWatchTopic: new Topic(stack, 'CWTopic')
      })

      expect(stack).toHaveResource('AWS::CloudWatch::Alarm', {
        MetricName: 'ApproximateNumberOfMessagesDelayed'
      })
    })
  })

  describe('Queue', () => {
    it('should create a DLQ', () => {
      const stack = new Stack()
      new OpsGenieForwarder(stack, 'Test', {
        opsGenieTopic: new Topic(stack, 'Topic'),
        cloudWatchTopic: new Topic(stack, 'CWTopic')
      })

      expect(stack).toCountResources('AWS::SQS::Queue', 1)
    })
  })
})
