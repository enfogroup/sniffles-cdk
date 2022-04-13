import { Duration, Stack } from 'aws-cdk-lib'
import { PolicyStatement } from 'aws-cdk-lib/aws-iam'
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs'
import { RetentionDays } from 'aws-cdk-lib/aws-logs'
import { Topic } from 'aws-cdk-lib/aws-sns'
import { Queue } from 'aws-cdk-lib/aws-sqs'
import { Construct } from 'constructs'
import { join } from 'path'
import { setupLambdaAlarms, setupQueueAlarms } from '../alarms'

/**
 * Properties needed when creating a new OpsGenieForwarder
 */
export interface OpsGenieForwarderProps {
  /**
   * SNS Topic to publish formatted logs to
   */
  opsGenieTopic: Topic
  /**
   * SNS Topic to publish internal alarms to
   */
  cloudWatchTopic: Topic
}

/**
 * Formats and forwards logs to an SNS Topic
 * Messages will be formatted to work with OpsGenie SNS hooks
 */
export class OpsGenieForwarder extends Stack {
  constructor (scope: Construct, id: string, props: OpsGenieForwarderProps) {
    super(scope, id)

    const lambda = this.setupLambda(props.opsGenieTopic)
    setupLambdaAlarms({
      idPrefix: 'OpsGenie',
      stack: this,
      lambda,
      topic: props.cloudWatchTopic
    })
    this.setupDLQ(props.cloudWatchTopic)
  }

  private setupDLQ (topic: Topic): Queue {
    const queue = new Queue(this, 'DLQ', {
      retentionPeriod: Duration.days(14)
    })
    setupQueueAlarms({
      stack: this,
      id: 'DLQAlarm',
      queue,
      topic
    })
    return queue
  }

  private setupLambda (topic: Topic): NodejsFunction {
    const lambda = new NodejsFunction(this, 'Forwarder', {
      entry: join(__dirname, 'forwarderLambda.ts'),
      handler: 'handler',
      memorySize: 128,
      timeout: Duration.seconds(3),
      logRetention: RetentionDays.ONE_YEAR,
      bundling: {
        minify: true,
        externalModules: ['aws-sdk'],
        sourceMap: false
      },
      environment: {
        topic: topic.topicArn
      }
    })

    lambda.addToRolePolicy(new PolicyStatement({
      actions: [
        'sns:Publish'
      ],
      resources: [
        topic.topicArn
      ]
    }))
    return lambda
  }
}
