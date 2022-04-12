import { join } from 'path'

import { Construct } from 'constructs'
import { Stream } from 'aws-cdk-lib/aws-kinesis'
import { Duration, Stack } from 'aws-cdk-lib'
import { StringListParameter } from 'aws-cdk-lib/aws-ssm'
import { PolicyStatement, Role, ServicePrincipal } from 'aws-cdk-lib/aws-iam'
import { MetricFilter, RetentionDays } from 'aws-cdk-lib/aws-logs'
import { StartingPosition } from 'aws-cdk-lib/aws-lambda'
import { Topic } from 'aws-cdk-lib/aws-sns'
import { Alarm, AlarmProps, ComparisonOperator, Metric, TreatMissingData } from 'aws-cdk-lib/aws-cloudwatch'
import { SnsAction } from 'aws-cdk-lib/aws-cloudwatch-actions'
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs'
import { Queue } from 'aws-cdk-lib/aws-sqs'

/**
 * Properties needed to create a new Sniffles instance
 */
export interface SnifflesProps {
  /**
   * Regular expressions which the subscription lambda should use to find log groups
   * For example "^/aws/lambda/.*-prod.*" would match log groups with "prod" in their names
   * Defaults to "^$" (no matches)
   */
  logGroupPatterns?: string[]
  /**
   * Log lines which the filter lambda should use to forward to errorLogTopic
   * For example '{ .level = 'error' }' would match logged rows with key "level" and value "error"
   * Another example could be "ERROR" which would match logged rows with "ERROR" in them
   * Defaults to ".*" (match everything)
   */
  filterInclusionPatterns?: string[]
  /**
   * Log lines which the filter lambda should block from being forwarded to errorLogTopic
   * For example '{ .level = 'error' }' would match logged rows with key "level" and value "error"
   * Another example could be "ERROR" which would match logged rows with "ERROR" in them
   * Defaults to "^$" (match nothing)
   */
  filterExclusionPatterns?: string[]
  /**
   * Optional Kinesis stream. Will be used to subscribe all matches from logGroupPatterns
   * If no stream is supplied one will be created
   */
  stream?: Stream
  /**
   * Optional topic which the filter lambda will write to when it finds matches
   * If no topic is supplied one will be created
   */
  errorLogTopic?: Topic
  /**
   * Optional topic used to send alarms to when internal Sniffles lambdas encounter issues
   * If no topic is supplied one will be created
   */
  cloudWatchTopic?: Topic
}

interface SetupSubscriptionLambdaProps {
  kinesisArn: string
  patternsParameter: StringListParameter
  cloudWatchRole: string
}

interface SetupFilterLambdaProps {
  kinesisStream: Stream
  snsTopic: Topic
  inclusionsParameter: StringListParameter
  exclusionsParameter: StringListParameter
  deadLetterQueue: Queue
}

interface SetupLambdaAlarmsProps {
  lambda: NodejsFunction
  topic: Topic
  idPrefix: string
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
  constructor (scope: Construct, id: string, props: SnifflesProps) {
    super(scope, id)

    const logGroupPatternsParameter = this.setupLogGroupPatterns(props.logGroupPatterns)
    const inclusionPatternsParameter = this.setupInclusionPatterns(props.filterInclusionPatterns)
    const exclusionsPatternsParameter = this.setupExclusionPatterns(props.filterExclusionPatterns)

    this.kinesisStream = this.setupKinesisStream(props.stream)
    const role = this.setupRoleForCloudWatch(this.kinesisStream)

    this.errorLogTopic = this.setupSnsTopic('ErrorLogTopic', props.errorLogTopic)
    this.cloudWatchTopic = this.setupSnsTopic('CloudWatchTopic', props.cloudWatchTopic)

    const subscriptionLambda = this.subscriptionLambda({
      kinesisArn: this.kinesisStream.streamArn,
      patternsParameter: logGroupPatternsParameter,
      cloudWatchRole: role.roleArn
    })
    this.setupLambdaMetricAlarms({
      lambda: subscriptionLambda,
      topic: this.errorLogTopic,
      idPrefix: 'Subscription'
    })

    const filterDLQ = this.setupFilterDLQ(this.cloudWatchTopic)
    const filterLambda = this.setupFilterLambda({
      kinesisStream: this.kinesisStream,
      inclusionsParameter: inclusionPatternsParameter,
      exclusionsParameter: exclusionsPatternsParameter,
      snsTopic: this.errorLogTopic,
      deadLetterQueue: filterDLQ
    })
    this.setupLambdaMetricAlarms({
      lambda: filterLambda,
      topic: this.errorLogTopic,
      idPrefix: 'Filter'
    })
  }

  private setupLogGroupPatterns (patterns: string[] = ['^$']): StringListParameter {
    return new StringListParameter(this, 'LogGroupPatterns', {
      stringListValue: patterns,
      description: 'Whitelisted log group patterns for Sniffles. Log groups matching the pattern will be subscribed for potential alarms.'
    })
  }

  private setupInclusionPatterns (patterns: string[] = ['.*']): StringListParameter {
    return new StringListParameter(this, 'InclusionPatterns', {
      stringListValue: patterns,
      description: 'List of regular expressions used to match errors from log groups. For example "{.level = "error}"'
    })
  }

  private setupExclusionPatterns (patterns: string[] = ['^$']): StringListParameter {
    return new StringListParameter(this, 'ExclusionPatterns', {
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
    const messagesInQueueAlarm = new Alarm(this, 'DLQAlarm', {
      evaluationPeriods: 60,
      threshold: 1,
      datapointsToAlarm: 1,
      comparisonOperator: ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: TreatMissingData.MISSING,
      metric: new Metric({
        namespace: 'AWS/SQS',
        metricName: 'ApproximateNumberOfMessagesDelayed',
        dimensionsMap: {
          QueueName: queue.queueName
        }
      })
    })
    messagesInQueueAlarm.addAlarmAction(new SnsAction(topic))
    return queue
  }

  private subscriptionLambda (props: SetupSubscriptionLambdaProps): NodejsFunction {
    const lambda = new NodejsFunction(this, 'SubscriptionLambda', {
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

  private setupFilterLambda (props: SetupFilterLambdaProps): NodejsFunction {
    const lambda = new NodejsFunction(this, 'FilterLambda', {
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
        inclusions: props.inclusionsParameter.parameterName,
        exclusions: props.exclusionsParameter.parameterName,
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
        props.inclusionsParameter.parameterArn,
        props.exclusionsParameter.parameterArn
      ]
    }))

    return lambda
  }

  private setupLambdaMetricAlarms (props: SetupLambdaAlarmsProps): Alarm[] {
    const { lambda, topic, idPrefix } = props
    const functionName = lambda.functionName
    const account = Stack.of(this).account
    const region = Stack.of(this).region

    const alarms: Alarm[] = []

    const namespace = 'sniffles-log-errors'
    const logErrorsMetricName = functionName
    new MetricFilter(this, `${idPrefix}MetricFilter`, {
      filterPattern: {
        logPatternString: '"ERROR"'
      },
      logGroup: lambda.logGroup,
      metricName: logErrorsMetricName,
      metricValue: '1',
      metricNamespace: namespace
    })

    const logGroupLink = `https://${region}.console.aws.amazon.com/cloudwatch/home?region=${region}#logsV2:log-groups/log-group/$252Faws$252Flambda$252F${functionName}`
    const commonAlarmProps: Pick<AlarmProps, 'evaluationPeriods' | 'threshold' | 'datapointsToAlarm' | 'comparisonOperator' | 'treatMissingData'> = {
      evaluationPeriods: 60,
      threshold: 1,
      datapointsToAlarm: 1,
      comparisonOperator: ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: TreatMissingData.MISSING
    }

    alarms.push(new Alarm(this, `${idPrefix}LogErrorAlarm`, {
      alarmName: `${functionName} logged an error`,
      alarmDescription: `Lambda function ${functionName} in ${account} logged an error. ${logGroupLink}/log-events$3FfilterPattern$3D$2522ERROR$2522`,
      ...commonAlarmProps,
      metric: new Metric({
        namespace,
        metricName: logErrorsMetricName,
        statistic: 'sum'
      })
    }))

    alarms.push(new Alarm(this, `${idPrefix}ThrottledAlarm`, {
      alarmName: `${functionName} was throttled`,
      alarmDescription: `Lambda function ${functionName} in ${account} was throttled. ${logGroupLink}`,
      ...commonAlarmProps,
      metric: new Metric({
        namespace: 'AWS/Lambda',
        metricName: 'Throttles',
        statistic: 'sum',
        dimensionsMap: {
          FunctionName: functionName
        }
      })
    }))

    alarms.push(new Alarm(this, `${idPrefix}ErrorExitAlarm`, {
      alarmName: `${functionName} exited with an error`,
      alarmDescription: `Lambda function ${functionName} in ${account} exited with an error. ${logGroupLink}`,
      ...commonAlarmProps,
      metric: new Metric({
        namespace: 'AWS/Lambda',
        metricName: 'Errors',
        statistic: 'sum',
        dimensionsMap: {
          FunctionName: functionName
        }
      })
    }))

    alarms.forEach((alarm: Alarm): void => alarm.addAlarmAction(new SnsAction(topic)))
    return alarms
  }
}

export interface OpsGenieLambdaProps {
  topic: Topic
}

export class OpsGenieLambda extends NodejsFunction {
  constructor (scope: Construct, id: string, props: OpsGenieLambdaProps) {
    super(scope, id, {
      entry: join(__dirname, 'opsGenieLambda.ts'),
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
  }
}
