import { Duration, Stack } from 'aws-cdk-lib'
import { Effect, PolicyStatement } from 'aws-cdk-lib/aws-iam'
import { SnsEventSource } from 'aws-cdk-lib/aws-lambda-event-sources'
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs'
import { RetentionDays } from 'aws-cdk-lib/aws-logs'
import { CfnTopic, Topic } from 'aws-cdk-lib/aws-sns'
import { Queue } from '@enfo/aws-cdkompliance'
import { Construct } from 'constructs'
import { join } from 'path'

import { FunctionAlarms, QueueAlarms } from '../alarms'
import { QueueEncryption } from 'aws-cdk-lib/aws-sqs'
import { Runtime } from 'aws-cdk-lib/aws-lambda'

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
    const lambda = this.setupFunction(props.opsGenieTopic, queue)
    lambda.addEventSource(new SnsEventSource(props.errorLogTopic))
    new FunctionAlarms(this, 'OpsGenieAlarms', {
      fun: lambda,
      topic: props.cloudWatchTopic
    })

    const keyId = (props.errorLogTopic.node.defaultChild as CfnTopic).kmsMasterKeyId
    // istanbul ignore next
    if (keyId) {
      lambda.addToRolePolicy(new PolicyStatement({
        effect: Effect.ALLOW,
        actions: [
          'kms:Decrypt',
          'kms:DescribeKey'
        ],
        resources: [
          `arn:aws:kms:${Stack.of(this).region}:${Stack.of(this).account}:key/${keyId}`
        ]
      }))
    }
  }

  private setupDLQ (topic: Topic): Queue {
    const queue = new Queue(this, 'DLQ', {
      retentionPeriod: Duration.days(14),
      encryption: QueueEncryption.KMS_MANAGED
    })
    new QueueAlarms(this, 'DLQAlarms', {
      queue,
      topic
    })
    return queue
  }

  private setupFunction (topic: Topic, queue: Queue): NodejsFunction {
    const fun = new NodejsFunction(this, 'Forwarder', {
      entry: join(__dirname, 'forwarderLambda.ts'),
      handler: 'handler',
      runtime: Runtime.NODEJS_18_X,
      memorySize: 128,
      timeout: Duration.seconds(3),
      logRetention: RetentionDays.ONE_YEAR,
      bundling: {
        minify: true,
        externalModules: ['@aws-sdk/*'],
        sourceMap: false
      },
      environment: {
        topic: topic.topicArn
      },
      deadLetterQueue: queue
    })
    fun.addToRolePolicy(new PolicyStatement({
      actions: [
        'sns:Publish'
      ],
      resources: [
        topic.topicArn
      ]
    }))
    const keyId = (topic.node.defaultChild as CfnTopic).kmsMasterKeyId
    // istanbul ignore next
    if (keyId) {
      fun.addToRolePolicy(new PolicyStatement({
        effect: Effect.ALLOW,
        actions: [
          'kms:Encrypt'
        ],
        resources: [
          `arn:aws:kms:${Stack.of(this).region}:${Stack.of(this).account}:key/${keyId}`
        ]
      }))
    }
    return fun
  }
}
