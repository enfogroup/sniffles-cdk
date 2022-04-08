import { join } from 'path'

import { NodejsFunction, Topic as CompliantTopic } from '@enfo/aws-cdkompliance'

import { Construct } from 'constructs'
import { Stream } from 'aws-cdk-lib/aws-kinesis'
import { Duration, Stack } from 'aws-cdk-lib'
import { StringListParameter } from 'aws-cdk-lib/aws-ssm'
import { PolicyStatement, Role, ServicePrincipal } from 'aws-cdk-lib/aws-iam'
import { RetentionDays } from 'aws-cdk-lib/aws-logs'
import { StartingPosition } from 'aws-cdk-lib/aws-lambda'
import { Topic } from 'aws-cdk-lib/aws-sns'

export interface SnifflesProps {
  logGroupPatterns: string[]
  kinesisStream?: Stream
  snsTopic?: Topic
  errorPatterns: string[]
}

interface SetupSubscriberLambdaProps {
  kinesisArn: string
  patternsParameter: StringListParameter
  cloudWatchRole: string
}

interface SetupCoreLambdaProps {
  kinesisStream: Stream
  snsTopic: Topic
  patternsParameter: StringListParameter
}

export class Sniffles extends Construct {
  readonly kinesisStream: Stream
  readonly snsTopic: Topic
  constructor (scope: Construct, id: string, props: SnifflesProps) {
    super(scope, id)

    const logGroupPatternsParameter = this.setupLogGroupPatterns(props.logGroupPatterns)
    const errorPatternsParameter = this.setupErrorPatterns(props.errorPatterns)

    this.kinesisStream = this.setupKinesisStream(props.kinesisStream)
    const role = this.setupRoleForCloudWatch(this.kinesisStream)
    this.snsTopic = this.setupSnsTopic(props.snsTopic)

    this.setupSubscriberLambda({
      kinesisArn: this.kinesisStream.streamArn,
      patternsParameter: logGroupPatternsParameter,
      cloudWatchRole: role.roleArn
    })

    this.setupCoreLambda({
      kinesisStream: this.kinesisStream,
      patternsParameter: errorPatternsParameter,
      snsTopic: this.snsTopic
    })
  }

  private setupLogGroupPatterns (patterns: string[]): StringListParameter {
    return new StringListParameter(this, 'LogGroupPatterns', {
      stringListValue: patterns,
      description: 'Whitelisted log group patterns for Sniffles. Log groups matching the pattern will be subscribed for potential alarms.'
    })
  }

  private setupErrorPatterns (patterns: string[]): StringListParameter {
    return new StringListParameter(this, 'ErrorPatterns', {
      stringListValue: patterns,
      description: 'List of regular expressions used to match errors from log groups. For example "{.level = "error}"'
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

  private setupSnsTopic (existingTopic?: Topic): Topic {
    if (existingTopic) {
      return existingTopic
    }
    return new CompliantTopic(this, 'Topic', {})
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
        kinesisStream: props.kinesisArn,
        cloudWatchRole: props.cloudWatchRole,
        patternsName: props.patternsParameter.parameterName
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
        props.patternsParameter.parameterArn
      ]
    }))
    return lambda
  }

  private setupCoreLambda (props: SetupCoreLambdaProps): NodejsFunction {
    const lambda = new NodejsFunction(this, 'SubscriberLambda', {
      entry: join(__dirname, 'coreLambda.ts'),
      handler: 'handler',
      memorySize: 128,
      timeout: Duration.seconds(30),
      logRetention: RetentionDays.ONE_YEAR,
      bundling: {
        minify: true,
        externalModules: ['aws-sdk'],
        sourceMap: false
      },
      environment: {
        accountId: Stack.of(this).account,
        errorMessage: 'oh no',
        patternsName: props.patternsParameter.parameterName,
        topicArn: props.snsTopic.topicArn
      }
    })

    lambda.addEventSourceMapping('CoreLambdaSourceMapping', {
      eventSourceArn: props.kinesisStream.streamArn,
      batchSize: 10,
      maxBatchingWindow: Duration.seconds(10),
      retryAttempts: 3,
      parallelizationFactor: 1,
      startingPosition: StartingPosition.LATEST
    })

    lambda.addToRolePolicy(new PolicyStatement({
      actions: [
        'sns:Publish'
      ],
      resources: [
        props.snsTopic.topicArn
      ]
    }))

    lambda.addToRolePolicy(new PolicyStatement({
      actions: [
        'ssm:GetParameter'
      ],
      resources: [
        props.patternsParameter.parameterArn
      ]
    }))

    return lambda
  }
}
