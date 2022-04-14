import { Sniffles } from '../lib/sniffles'

import '@aws-cdk/assert/jest'
import { Stack } from 'aws-cdk-lib'
import { Stream } from 'aws-cdk-lib/aws-kinesis'
import { Topic } from 'aws-cdk-lib/aws-sns'
import { Match, Template } from 'aws-cdk-lib/assertions'

describe('Sniffles', () => {
  describe('SSM', () => {
    it('should create parameters', () => {
      const stack = new Stack()
      new Sniffles(stack, 'Test', {})

      expect(stack).toCountResources('AWS::SSM::Parameter', 4)
    })

    it('should be possible to set values to log group inclusions', () => {
      const stack = new Stack()
      new Sniffles(stack, 'Test', {
        subscriptionInclusionPatterns: ['abc', 'def', 'ghi']
      })

      expect(stack).toHaveResource('AWS::SSM::Parameter', {
        Value: 'abc,def,ghi'
      })
    })

    it('should be possible to set values to log group exclusions', () => {
      const stack = new Stack()
      new Sniffles(stack, 'Test', {
        subscriptionExclusionPatterns: ['abc', 'def', 'ghi']
      })

      expect(stack).toHaveResource('AWS::SSM::Parameter', {
        Value: 'abc,def,ghi'
      })
    })

    it('should be possible to set values to filter inclusions', () => {
      const stack = new Stack()
      new Sniffles(stack, 'Test', {
        filterInclusionPatterns: ['abc', 'def', 'ghi']
      })

      expect(stack).toHaveResource('AWS::SSM::Parameter', {
        Value: 'abc,def,ghi'
      })
    })

    it('should be possible to set values to filter exclusions', () => {
      const stack = new Stack()
      new Sniffles(stack, 'Test', {
        filterExclusionPatterns: ['abc', 'def', 'ghi']
      })

      expect(stack).toHaveResource('AWS::SSM::Parameter', {
        Value: 'abc,def,ghi'
      })
    })
  })

  describe('Kinesis', () => {
    it('should create a Kinesis stream if none is provided', () => {
      const stack = new Stack()
      new Sniffles(stack, 'Test', {})

      expect(stack).toCountResources('AWS::Kinesis::Stream', 1)
    })

    it('should use the provided Kinesis stream', () => {
      const stack = new Stack()
      new Sniffles(stack, 'Test', {
        stream: new Stream(stack, 'Stream', {
          streamName: 'hello-there'
        })
      })

      expect(stack).toCountResources('AWS::Kinesis::Stream', 1)
      expect(stack).toHaveResource('AWS::Kinesis::Stream', {
        Name: 'hello-there'
      })
    })
  })

  describe('IAM', () => {
    it('should create a role for CloudWatch', () => {
      const stack = new Stack()
      new Sniffles(stack, 'Test', {})

      expect(stack).toHaveResource('AWS::IAM::Role', {
        AssumeRolePolicyDocument: {
          Statement: [
            {
              Action: 'sts:AssumeRole',
              Effect: 'Allow',
              Principal: {
                Service: {
                  'Fn::Join': [
                    '',
                    [
                      'logs.',
                      {
                        Ref: 'AWS::Region'
                      },
                      '.',
                      {
                        Ref: 'AWS::URLSuffix'
                      }
                    ]
                  ]
                }
              }
            }
          ],
          Version: '2012-10-17'
        }
      })
    })
  })

  describe('SNS', () => {
    it('should create topics for cloudwatch and filter if none are provided', () => {
      const stack = new Stack()
      new Sniffles(stack, 'Test', {})

      expect(stack).toCountResources('AWS::SNS::Topic', 2)
    })

    it('should use the cloudwatch topic if supplied', () => {
      const stack = new Stack()
      new Sniffles(stack, 'Test', {
        cloudWatchTopic: new Topic(stack, 'Topic', {
          topicName: 'cloudwatch'
        })
      })

      expect(stack).toCountResources('AWS::SNS::Topic', 2)
      expect(stack).toHaveResource('AWS::SNS::Topic', {
        TopicName: 'cloudwatch'
      })
    })

    it('should use the filter topic if supplied', () => {
      const stack = new Stack()
      new Sniffles(stack, 'Test', {
        errorLogTopic: new Topic(stack, 'Topic', {
          topicName: 'filter'
        })
      })

      expect(stack).toCountResources('AWS::SNS::Topic', 2)
      expect(stack).toHaveResource('AWS::SNS::Topic', {
        TopicName: 'filter'
      })
    })
  })

  describe('Queue', () => {
    it('should create a DLQ', () => {
      const stack = new Stack()
      new Sniffles(stack, 'Test', {})

      expect(stack).toCountResources('AWS::SQS::Queue', 1)
    })

    it('should setup alarms for the DLQ', () => {
      const stack = new Stack()
      new Sniffles(stack, 'Test', {})

      expect(stack).toHaveResource('AWS::CloudWatch::Alarm', {
        MetricName: 'ApproximateNumberOfMessagesDelayed'
      })
    })
  })

  describe('Lambda', () => {
    it('should create a subscription lambda', () => {
      const stack = new Stack()
      new Sniffles(stack, 'Test', {})

      const template = Template.fromStack(stack)
      template.hasResourceProperties('AWS::Lambda::Function', Match.objectLike({
        Environment: {
          Variables: {
            kinesisStream: {},
            cloudWatchRole: {},
            inclusions: {},
            exclusions: {}
          }
        }
      }))
    })

    it('should create a filter lambda', () => {
      const stack = new Stack()
      new Sniffles(stack, 'Test', {})

      const template = Template.fromStack(stack)
      template.hasResourceProperties('AWS::Lambda::Function', Match.objectLike({
        Environment: {
          Variables: {
            inclusions: {},
            exclusions: {},
            topicArn: {}
          }
        }
      }))
    })

    it('should create alarms for both lambdas', () => {
      const stack = new Stack()
      new Sniffles(stack, 'Test', {})

      expect(stack).toCountResources('AWS::CloudWatch::Alarm', 7) // 2*3 + 1 for the DLQ, not a great test
    })
  })
})
