import { NodejsFunction } from '@enfo/aws-cdkompliance'

import { Construct } from 'constructs'
import { Stream } from 'aws-cdk-lib/aws-kinesis'
import { Duration } from 'aws-cdk-lib'
import { StringListParameter } from 'aws-cdk-lib/aws-ssm'
import { Role, ServicePrincipal } from 'aws-cdk-lib/aws-iam'

export interface SnifflesProps {
  logGroupPatterns: string[]
}

interface SetupSubscriberLambdaProps {
  kinesisArn: string
  logGroupsParameter: string
  cloudWatchRole: string
}

export class Sniffles extends Construct {
  constructor (scope: Construct, id: string, props: SnifflesProps) {
    super(scope, id)

    const logGroupPatternsParameter = this.setupLogGroupPatterns(props.logGroupPatterns)
    const kinesisStream = this.setupKinesisStream()
    const role = this.setupRoleForCloudWatch()
    kinesisStream.grantWrite(role)
    const subscriberLambda = this.setupSubscriberLambda({
      kinesisArn: kinesisStream.streamArn,
      logGroupsParameter: logGroupPatternsParameter,
      cloudWatchRole: role.roleArn
    })
  }

  private setupLogGroupPatterns (patterns: string[]): string {
    return new StringListParameter(this, 'LogGroupPatterns', {
      stringListValue: patterns,
      description: 'Whitelisted log group patterns for Sniffles. Log groups matching the pattern will be subscribed for potential alarms.'
    }).parameterName
  }

  private setupKinesisStream (): Stream {
    return new Stream(this, 'Stream', {
      shardCount: 1,
      retentionPeriod: Duration.hours(24)
    })
  }

  private setupRoleForCloudWatch (): Role {
    return new Role(this, 'CloudWatchRole', {
      assumedBy: new ServicePrincipal('logs.amazon.com')
    })
  }

  private setupSubscriberLambda (props: SetupSubscriberLambdaProps): NodejsFunction {
    return new NodejsFunction(this, 'SubscriberLambda', {
      entry: './lambdas/subscriber/handler.ts',
      handler: 'handler',
      bundling: {
        minify: true
      },
      environment: {
        ...props
      }
    })
  }
}
