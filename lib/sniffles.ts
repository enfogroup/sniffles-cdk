import { join } from 'path'

import { NodejsFunction } from '@enfo/aws-cdkompliance'

import { Construct } from 'constructs'
import { Stream } from 'aws-cdk-lib/aws-kinesis'
import { Duration, Stack } from 'aws-cdk-lib'
import { StringListParameter } from 'aws-cdk-lib/aws-ssm'
import { PolicyStatement, Role, ServicePrincipal } from 'aws-cdk-lib/aws-iam'
import { RetentionDays } from 'aws-cdk-lib/aws-logs'

export interface SnifflesProps {
  logGroupPatterns: string[]
  kinesisStream?: Stream
}

interface SetupSubscriberLambdaProps {
  kinesisArn: string
  patternsName: string
  patternsArn: string
  cloudWatchRole: string
}

export class Sniffles extends Construct {
  readonly kinesisStream: Stream
  constructor (scope: Construct, id: string, props: SnifflesProps) {
    super(scope, id)

    const logGroupPatternsParameter = this.setupLogGroupPatterns(props.logGroupPatterns)
    this.kinesisStream = this.setupKinesisStream(props.kinesisStream)
    const role = this.setupRoleForCloudWatch(this.kinesisStream)
    this.setupSubscriberLambda({
      kinesisArn: this.kinesisStream.streamArn,
      patternsName: logGroupPatternsParameter.parameterName,
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
    const lambda = new NodejsFunction(this, 'SubscriberLambda', {
      entry: join(__dirname, 'subscriberLambda.ts'),
      handler: 'handler',
      memorySize: 128,
      timeout: Duration.seconds(900),
      logRetention: RetentionDays.ONE_YEAR,
      bundling: {
        minify: true,
        externalModules: ['aws-sdk'],
        sourceMap: false
      },
      environment: {
        ...props
      }
    })
    lambda.addToRolePolicy(new PolicyStatement({
      actions: [
        'iam:PassRole'
      ],
      resources: [
        props.cloudWatchRole
      ]
    }))
    lambda.addToRolePolicy(new PolicyStatement({
      actions: [
        'logs:DescribeLogGroups',
        'logs:DescribeSubscriptionFilters',
        'logs:PutSubscriptionFilter'
      ],
      resources: [
        `arn:aws:logs:*:${Stack.of(this).account}:log-group:*`
      ]
    }))
    lambda.addToRolePolicy(new PolicyStatement({
      actions: [
        'ssm:GetParameter'
      ],
      resources: [
        props.patternsArn
      ]
    }))
    return lambda
  }
}
