import { Duration } from 'aws-cdk-lib'
import { PolicyStatement } from 'aws-cdk-lib/aws-iam'
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs'
import { RetentionDays } from 'aws-cdk-lib/aws-logs'
import { Topic } from 'aws-cdk-lib/aws-sns'
import { Construct } from 'constructs'
import { join } from 'path'

/**
 * Properties needed when creating a new OpsGenieForwarder
 */
export interface OpsGenieForwarderProps {
  /**
   * SNS Topic to publish formatted logs to
   */
  topic: Topic
}

/**
 * Formats and forwards logs to an SNS Topic
 * Messages will be formatted to work with OpsGenie SNS hooks
 */
export class OpsGenieForwarder extends NodejsFunction {
  constructor (scope: Construct, id: string, props: OpsGenieForwarderProps) {
    super(scope, id, {
      entry: join(__dirname, 'code.ts'),
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
        topic: props.topic.topicArn
      }
    })

    this.addToRolePolicy(new PolicyStatement({
      actions: [
        'sns:Publish'
      ],
      resources: [
        props.topic.topicArn
      ]
    }))
  }
}
