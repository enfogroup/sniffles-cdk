import { join } from 'path'

import { NodejsFunction } from '@enfo/aws-cdkompliance'

import { Construct } from 'constructs'
import { Stream } from 'aws-cdk-lib/aws-kinesis'
import { Duration } from 'aws-cdk-lib'
import { StringListParameter } from 'aws-cdk-lib/aws-ssm'
import { PolicyDocument, PolicyStatement, Role, ServicePrincipal } from 'aws-cdk-lib/aws-iam'

export interface SnifflesProps {
  logGroupPatterns: string[]
  kinesisStream?: Stream
}

interface SetupSubscriberLambdaProps {
  kinesisArn: string
  pattersName: string
  patternsArn: string
  cloudWatchRole: string
}

export class Sniffles extends Construct {
  constructor (scope: Construct, id: string, props: SnifflesProps) {
    super(scope, id)

    const logGroupPatternsParameter = this.setupLogGroupPatterns(props.logGroupPatterns)
    const kinesisStream = this.setupKinesisStream(props.kinesisStream)
    const role = this.setupRoleForCloudWatch(kinesisStream)
    this.setupSubscriberLambda({
      kinesisArn: kinesisStream.streamArn,
      pattersName: logGroupPatternsParameter.parameterName,
      patternsArn: logGroupPatternsParameter.parameterArn,
      cloudWatchRole: role.roleArn
    })
  }

  private setupLogGroupPatterns (patterns: string[]): StringListParameter {
    return new StringListParameter(this, 'LogGroupPatterns', {
      stringListValue: patterns,
      description: 'Whitelisted log group patterns for Sniffles. Log groups matching the pattern will be subscribed for potential alarms.'
    })
  }

  private setupKinesisStream (existingStream?: Stream): Stream {
    if (existingStream) {
      return existingStream
    }
    return new Stream(this, 'Stream', {
      shardCount: 1,
      retentionPeriod: Duration.hours(24)
    })
  }

  private setupRoleForCloudWatch (kinesisStream: Stream): Role {
    const role = new Role(this, 'CloudWatchRole', {
      assumedBy: new ServicePrincipal('logs.amazonaws.com')
    })
    kinesisStream.grantWrite(role)
    return role
  }

  private setupSubscriberLambda (props: SetupSubscriberLambdaProps): NodejsFunction {
    const passRoleStatement = new PolicyStatement({
      actions: [
        'iam:PassRole'
      ],
      resources: [
        props.cloudWatchRole
      ]
    })
    const cloudWatchStatement = new PolicyStatement({
      actions: [
        'logs:DescribeLogGroups',
        'logs:DescribeSubscriptionFilters',
        'logs:PutSubscriptionFilter'
      ],
      resources: [
        '*' // FIXME, narrow down
      ]
    })
    const ssmStatement = new PolicyStatement({
      actions: [
        'ssm:GetParameter'
      ],
      resources: [
        props.patternsArn
      ]
    })
    const role = new Role(this, 'SubscriberLambdaRole', {
      assumedBy: new ServicePrincipal('lambda.amazonaws.com'),
      inlinePolicies: {
        Permissions: new PolicyDocument({
          statements: [
            passRoleStatement,
            cloudWatchStatement,
            ssmStatement
          ]
        })
      }
    })
    return new NodejsFunction(this, 'SubscriberLambda', {
      entry: join(__dirname, 'lambdas/subscriber/handler.ts'),
      handler: 'handler',
      bundling: {
        minify: true,
        externalModules: ['aws-sdk'],
        sourceMap: false
      },
      environment: {
        ...props
      },
      role
    })
  }
}
