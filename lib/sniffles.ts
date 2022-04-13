import { join } from 'path'

import { Construct } from 'constructs'
import { Stream } from 'aws-cdk-lib/aws-kinesis'
import { Duration, Stack } from 'aws-cdk-lib'
import { StringListParameter } from 'aws-cdk-lib/aws-ssm'
import { PolicyStatement, Role, ServicePrincipal } from 'aws-cdk-lib/aws-iam'
import { RetentionDays } from 'aws-cdk-lib/aws-logs'
import { StartingPosition } from 'aws-cdk-lib/aws-lambda'
import { Topic } from 'aws-cdk-lib/aws-sns'
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs'
import { Queue } from 'aws-cdk-lib/aws-sqs'
import { Rule, Schedule } from 'aws-cdk-lib/aws-events'
import { LambdaFunction } from 'aws-cdk-lib/aws-events-targets'

import { setupLambdaAlarms, setupQueueAlarms } from './alarms'

/**
 * Properties needed to create a new Sniffles instance
 */
export interface SnifflesProps {
  /**
   * Properties for subscribeLogGroups lambda
   */
  subscribeLogGroupsProps?: {
    /**
     * Regular expressions which will be used to match log groups
     * For example "^/aws/lambda/.*-prod-.*" would match lambda log groups with "-prod-" in their names
     * Defaults to "^/aws/lambda/.*-prod-.*"
     */
    inclusionPatterns?: string[]
    /**
     * Regular expressions which will be used to exclude log groups from matching
     * Defaults to "^$" (no matches)
     */
    exclusionPatterns?: string[]
  }
  /**
   * Properties for filterLogs lambda
   */
  filterLogsProps?: {
    /**
     * Regular expressions which will be used to forward log messages
     * For example '{ .level = "error" }' would match objects logged with key level and value "error" present
     * Defaults to '{ .level === "error" }'
     */
    inclusionPatterns?: string[]
    /**
     * Regular expressions which will be used to exclude log messages from being matched
     * Defaults to "^$" (no matches)
     */
    exclusionPatterns?: string[]
    /**
     * SNS topic to publish matches to
     * If no topic is supplied one will be generated
     */
    topic?: Topic
  }
  /**
   * Optional Kinesis stream. Will be used to subscribe all matches from the subscribeLogGroups lambda
   * If no stream is supplied one will be created
   */
  stream?: Stream
  /**
   * Optional topic used to send alarms to when internal Sniffles resources encounter issues
   * If no topic is supplied one will be created
   */
  cloudWatchTopic?: Topic
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
  // istanbul ignore next
  constructor (scope: Construct, id: string, props?: SnifflesProps) {
    super(scope, id)

    this.kinesisStream = this.setupKinesisStream(props?.stream)
    const role = this.setupRoleForCloudWatch(this.kinesisStream)

    this.errorLogTopic = this.setupSnsTopic('FilterLogsTopic', props?.filterLogsProps?.topic)
    this.cloudWatchTopic = this.setupSnsTopic('CloudWatchTopic', props?.cloudWatchTopic)

    const subscriptionLambda = this.subscriptionLambda({
      kinesisStream: this.kinesisStream,
      inclusionPatterns: this.setupLogGroupInclusionPatterns(props?.subscribeLogGroupsProps?.inclusionPatterns),
      exclusionPatterns: this.setupLogGroupExclusionPatterns(props?.subscribeLogGroupsProps?.exclusionPatterns),
      cloudWatchRole: role
    })
    setupLambdaAlarms({
      stack: this,
      lambda: subscriptionLambda,
      topic: this.cloudWatchTopic,
      idPrefix: 'Subscription'
    })

    const filterDLQ = this.setupFilterDLQ(this.cloudWatchTopic)
    const filterLambda = this.setupFilterLambda({
      kinesisStream: this.kinesisStream,
      inclusionPatterns: this.setupFilterLogsInclusionPatterns(props?.filterLogsProps?.inclusionPatterns),
      exclusionPatterns: this.setupFilterLogsExclusionPatterns(props?.filterLogsProps?.exclusionPatterns),
      snsTopic: this.errorLogTopic,
      deadLetterQueue: filterDLQ
    })
    setupLambdaAlarms({
      stack: this,
      lambda: filterLambda,
      topic: this.cloudWatchTopic,
      idPrefix: 'Filter'
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

  private setupSnsTopic (id: string, existingTopic?: Topic): Topic {
    if (existingTopic) {
      return existingTopic
    }
    return new Topic(this, id, {})
  }

  private setupFilterDLQ (topic: Topic): Queue {
    const queue = new Queue(this, 'FilterDLQ', {
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

  private subscriptionLambda (props: SetupSubscriptionLambdaProps): NodejsFunction {
    const lambda = new NodejsFunction(this, 'SnifflesSubscribeLogGroups', {
      entry: join(__dirname, 'subscriptionLambda.ts'),
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

  private setupFilterLambda (props: SetupFilterLambdaProps): NodejsFunction {
    const lambda = new NodejsFunction(this, 'SnifflesFilterLogs', {
      entry: join(__dirname, 'filterLambda.ts'),
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
        inclusions: props.inclusionPatterns.parameterName,
        exclusions: props.exclusionPatterns.parameterName,
        topicArn: props.snsTopic.topicArn
      },
      deadLetterQueue: props.deadLetterQueue
    })

    lambda.addEventSourceMapping('FilterLambdaSourceMapping', {
      eventSourceArn: props.kinesisStream.streamArn,
      batchSize: 10,
      maxBatchingWindow: Duration.seconds(10),
      retryAttempts: 3,
      parallelizationFactor: 1,
      startingPosition: StartingPosition.LATEST
    })

    props.kinesisStream.grantRead(lambda)

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
        props.inclusionPatterns.parameterArn,
        props.exclusionPatterns.parameterArn
      ]
    }))

    return lambda
  }
}
