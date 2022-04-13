import { Duration } from 'aws-cdk-lib'
import { PolicyStatement } from 'aws-cdk-lib/aws-iam'
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs'
import { RetentionDays } from 'aws-cdk-lib/aws-logs'
import { Topic } from 'aws-cdk-lib/aws-sns'
import { Construct } from 'constructs'
import { join } from 'path'

export interface OpsGenieLambdaProps {
  topic: Topic
}

export class OpsGenieLambda extends NodejsFunction {
  constructor (scope: Construct, id: string, props: OpsGenieLambdaProps) {
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
