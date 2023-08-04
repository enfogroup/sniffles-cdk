import { join } from 'path'

import { Construct } from 'constructs'
import { Stream, StreamEncryption } from 'aws-cdk-lib/aws-kinesis'
import { Duration, Stack } from 'aws-cdk-lib'
import { StringListParameter } from 'aws-cdk-lib/aws-ssm'
import { Effect, PolicyStatement, Role, ServicePrincipal } from 'aws-cdk-lib/aws-iam'
import { RetentionDays } from 'aws-cdk-lib/aws-logs'
import { Runtime, StartingPosition } from 'aws-cdk-lib/aws-lambda'
import { CfnTopic, Topic } from 'aws-cdk-lib/aws-sns'
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs'
import { QueueEncryption } from 'aws-cdk-lib/aws-sqs'
import { Queue, Topic as CompliantTopic } from '@enfo/aws-cdkompliance'
import { Rule, Schedule } from 'aws-cdk-lib/aws-events'
import { LambdaFunction } from 'aws-cdk-lib/aws-events-targets'
import { IKey, Key } from 'aws-cdk-lib/aws-kms'

import { QueueAlarms, FunctionAlarms } from './alarms'

/**
 * Properties needed to create a new Sniffles instance
 */
export interface SnifflesProps {
  /**
   * Regular expressions which will be used to match log groups
   * For example "^/aws/lambda/.*-prod-.*" would match lambda log groups with "-prod-" in their names
   * Defaults to ["^/aws/lambda/.*-prod-.*"]
   */
  readonly subscriptionInclusionPatterns?: string[]
  /**
   * Regular expressions which will be used to exclude log groups from matching
   * Defaults to ["^$"] (no matches)
   */
   readonly subscriptionExclusionPatterns?: string[]
  /**
   * Regular expressions which will be used to forward log messages
   * For example '{ .level = "error" }' would match objects logged with key level and value "error" present
   * Defaults to ['{ .level === "error" }']
   */
   readonly filterInclusionPatterns?: string[]
  /**
   * Regular expressions which will be used to exclude log messages from being matched
   * Defaults to ["^$"] (no matches)
   */
   readonly filterExclusionPatterns?: string[]
  /**
   * SNS topic to publish filter matches to
   * If no topic is supplied one will be generated
   */
   readonly errorLogTopic?: Topic
  /**
   * Optional Kinesis stream. Will be used to subscribe all matches from the subscribeLogGroups lambda
   * If no stream is supplied one will be created
   */
  readonly stream?: Stream
  /**
   * Optional topic used to send alarms to when internal Sniffles resources encounter issues
   * If no topic is supplied one will be created
   */
  readonly cloudWatchTopic?: Topic
}

interface SetupSubscriptionLambdaProps {
  kinesisStream: Stream
  inclusionPatterns: StringListParameter
  exclusionPatterns: StringListParameter
  cloudWatchRole: Role
}

interface SetupFilterLambdaProps {
  kinesisStream: Stream
  snsTopic: Topic
  inclusionPatterns: StringListParameter
  exclusionPatterns: StringListParameter
  deadLetterQueue: Queue
}

/**
 * Sniffles is a self contained solution for getting log based alarms to destinations of your choosing
 * An automatic Log subscriber will subscribe log groups to a Kinesis stream while another lambda will evaluate if a log row should raise an alarm or not
 * Check the README for more information!
 */
export class Sniffles extends Construct {
  /**
   * Kinesis stream used by Sniffles to handle all logs
   */
  readonly kinesisStream: Stream
  /**
   * Topic which all log alarms will be pushed to
   */
  readonly errorLogTopic: Topic
  /**
   * Topic which all internal Sniffles logic alarms will be pushed to
   */
  readonly cloudWatchTopic: Topic

  #defaultSnsKey: IKey | undefined

  // istanbul ignore next
  constructor (scope: Construct, id: string, props?: SnifflesProps) {
    super(scope, id)

    this.kinesisStream = this.setupKinesisStream(props?.stream)
    const role = this.setupRoleForCloudWatch(this.kinesisStream)

    this.errorLogTopic = this.setupSnsTopic('FilterLogsTopic', props?.errorLogTopic)
    this.cloudWatchTopic = this.setupSnsTopic('CloudWatchTopic', props?.cloudWatchTopic)

    const subscriptionLambda = this.subscriptionLambda({
      kinesisStream: this.kinesisStream,
      inclusionPatterns: this.setupLogGroupInclusionPatterns(props?.subscriptionInclusionPatterns),
      exclusionPatterns: this.setupLogGroupExclusionPatterns(props?.subscriptionExclusionPatterns),
      cloudWatchRole: role
    })
    new FunctionAlarms(this, 'SubscriptionAlarms', {
      fun: subscriptionLambda,
      topic: this.cloudWatchTopic
    })

    const filterDLQ = this.setupFilterDLQ(this.cloudWatchTopic)
    const filterLambda = this.setupFilterFunction({
      kinesisStream: this.kinesisStream,
      inclusionPatterns: this.setupFilterLogsInclusionPatterns(props?.filterInclusionPatterns),
      exclusionPatterns: this.setupFilterLogsExclusionPatterns(props?.filterExclusionPatterns),
      snsTopic: this.errorLogTopic,
      deadLetterQueue: filterDLQ
    })
    new FunctionAlarms(this, 'FilterAlarms', {
      fun: filterLambda,
      topic: this.cloudWatchTopic
    })
  }

  private setupLogGroupInclusionPatterns (patterns: string[] = ['^/aws/lambda/.*-prod-.*']): StringListParameter {
    return new StringListParameter(this, 'LogGroupInclusionPatterns', {
      stringListValue: patterns
    })
  }

  private setupLogGroupExclusionPatterns (patterns: string[] = ['^$']): StringListParameter {
    return new StringListParameter(this, 'LogGroupExclusionPatterns', {
      stringListValue: patterns
    })
  }

  private setupFilterLogsInclusionPatterns (patterns: string[] = ['{ .level === "error" }']): StringListParameter {
    return new StringListParameter(this, 'FilterLogsInclusionPatterns', {
      stringListValue: patterns
    })
  }

  private setupFilterLogsExclusionPatterns (patterns: string[] = ['^$']): StringListParameter {
    return new StringListParameter(this, 'FilterLogsExclusionPatterns', {
      stringListValue: patterns
    })
  }

  private setupKinesisStream (existingStream?: Stream): Stream {
    if (existingStream) {
      return existingStream
    }
    return new Stream(this, 'Stream', {
      shardCount: 1,
      retentionPeriod: Duration.hours(24),
      encryption: StreamEncryption.MANAGED
    })
  }

  private setupRoleForCloudWatch (kinesisStream: Stream): Role {
    const role = new Role(this, 'CloudWatchRole', {
      assumedBy: new ServicePrincipal('logs.amazonaws.com')
    })
    kinesisStream.grantWrite(role)
    return role
  }

  private getDefaultSnsKey (): IKey {
    this.#defaultSnsKey ??= Key.fromLookup(this, 'DefaultSnsKey', {
      aliasName: 'alias/aws/sns'
    })
    return this.#defaultSnsKey
  }

  private setupSnsTopic (id: string, existingTopic?: Topic): Topic {
    if (existingTopic) {
      return existingTopic
    }
    return new CompliantTopic(this, id, {
      masterKey: this.getDefaultSnsKey()
    })
  }

  private setupFilterDLQ (topic: Topic): Queue {
    const queue = new Queue(this, 'FilterDLQ', {
      retentionPeriod: Duration.days(14),
      encryption: QueueEncryption.KMS_MANAGED
    })
    new QueueAlarms(this, 'DLQAlarms', {
      queue,
      topic
    })
    return queue
  }

  private subscriptionLambda (props: SetupSubscriptionLambdaProps): NodejsFunction {
    const lambda = new NodejsFunction(this, 'SnifflesSubscribeLogGroups', {
      entry: join(__dirname, 'subscriptionLambda.ts'),
      handler: 'handler',
      runtime: Runtime.NODEJS_18_X,
      memorySize: 128,
      timeout: Duration.seconds(900),
      logRetention: RetentionDays.ONE_YEAR,
      bundling: {
        minify: true,
        externalModules: ['@aws-sdk/*'],
        sourceMap: false
      },
      environment: {
        kinesisStream: props.kinesisStream.streamArn,
        cloudWatchRole: props.cloudWatchRole.roleArn,
        inclusions: props.inclusionPatterns.parameterName,
        exclusions: props.exclusionPatterns.parameterName
      }
    })
    const eventRule = new Rule(this, 'scheduleRule', {
      schedule: Schedule.rate(Duration.minutes(15))
    })
    eventRule.addTarget(new LambdaFunction(lambda))
    lambda.addToRolePolicy(new PolicyStatement({
      actions: [
        'iam:PassRole'
      ],
      resources: [
        props.cloudWatchRole.roleArn
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
        props.inclusionPatterns.parameterArn,
        props.exclusionPatterns.parameterArn
      ]
    }))
    return lambda
  }

  private setupFilterFunction (props: SetupFilterLambdaProps): NodejsFunction {
    const fun = new NodejsFunction(this, 'SnifflesFilterLogs', {
      entry: join(__dirname, 'filterLambda.ts'),
      handler: 'handler',
      runtime: Runtime.NODEJS_18_X,
      memorySize: 128,
      timeout: Duration.seconds(30),
      logRetention: RetentionDays.ONE_YEAR,
      bundling: {
        minify: true,
        externalModules: ['@aws-sdk/*'],
        sourceMap: false
      },
      environment: {
        inclusions: props.inclusionPatterns.parameterName,
        exclusions: props.exclusionPatterns.parameterName,
        topicArn: props.snsTopic.topicArn
      },
      deadLetterQueue: props.deadLetterQueue
    })

    fun.addEventSourceMapping('FilterLambdaSourceMapping', {
      eventSourceArn: props.kinesisStream.streamArn,
      batchSize: 10,
      maxBatchingWindow: Duration.seconds(10),
      retryAttempts: 3,
      parallelizationFactor: 1,
      startingPosition: StartingPosition.LATEST
    })

    props.kinesisStream.grantRead(fun)

    fun.addToRolePolicy(new PolicyStatement({
      actions: [
        'sns:Publish'
      ],
      resources: [
        props.snsTopic.topicArn
      ]
    }))

    const keyArn = (props.snsTopic.node.defaultChild as CfnTopic).kmsMasterKeyId
    if (keyArn) {
      fun.addToRolePolicy(new PolicyStatement({
        effect: Effect.ALLOW,
        actions: [
          'kms:Encrypt',
          'kms:GenerateDataKey*'
        ],
        resources: [
          keyArn
        ]
      }))
    }

    fun.addToRolePolicy(new PolicyStatement({
      actions: [
        'ssm:GetParameter'
      ],
      resources: [
        props.inclusionPatterns.parameterArn,
        props.exclusionPatterns.parameterArn
      ]
    }))

    return fun
  }
}
