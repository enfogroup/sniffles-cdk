import { Duration } from 'aws-cdk-lib'
import { PolicyStatement } from 'aws-cdk-lib/aws-iam'
import { SnsEventSource } from 'aws-cdk-lib/aws-lambda-event-sources'
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
  readonly opsGenieTopic: Topic
  /**
   * SNS Topic to publish internal alarms to
   */
  readonly cloudWatchTopic: Topic
  /**
   * SNS Topic which filtered log lines are published to. Will be used as an event source
   */
  readonly errorLogTopic: Topic
}

/**
 * Formats and forwards logs to an SNS Topic
 * Messages will be formatted to work with OpsGenie SNS hooks
 */
export class OpsGenieForwarder extends Construct {
  constructor (scope: Construct, id: string, props: OpsGenieForwarderProps) {
    super(scope, id)

    const queue = this.setupDLQ(props.cloudWatchTopic)
    const lambda = this.setupLambda(props.opsGenieTopic, queue)
    lambda.addEventSource(new SnsEventSource(props.errorLogTopic))
    setupLambdaAlarms({
      idPrefix: 'OpsGenie',
      stack: this,
      lambda,
      topic: props.cloudWatchTopic
    })
  }

  private setupDLQ (topic: Topic): Queue {
    const queue = new Queue(this, 'DLQ', {
      retentionPeriod: Duration.days(14)
    })
    setupQueueAlarms({
      stack: this,
      id: 'DLQAlarms',
      queue,
      topic
    })
    return queue
  }

  private setupLambda (topic: Topic, queue: Queue): NodejsFunction {
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
      },
      deadLetterQueue: queue
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
