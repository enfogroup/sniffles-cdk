import { join } from 'path'

import { Key, NodejsFunction, Topic as CompliantTopic } from '@enfo/aws-cdkompliance'

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

export interface SnifflesProps {
  logGroupPatterns: string[]
  kinesisStream?: Stream
  opsGenieSnsTopic?: Topic
  cloudWatchSnsTopic?: Topic
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

interface SetupLambdaAlarmsProps {
  lambda: NodejsFunction
  topic: Topic
  idPrefix: string
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
    this.snsTopic = this.setupSnsTopic(props.opsGenieSnsTopic)

    const subscriberLambda = this.setupSubscriberLambda({
      kinesisArn: this.kinesisStream.streamArn,
      patternsParameter: logGroupPatternsParameter,
      cloudWatchRole: role.roleArn
    })
    this.setupLambdaMetricAlarms({
      lambda: subscriberLambda,
      topic: this.snsTopic, // FIXME
      idPrefix: 'Subscriber'
    })

    const coreLambda = this.setupCoreLambda({
      kinesisStream: this.kinesisStream,
      patternsParameter: errorPatternsParameter,
      snsTopic: this.snsTopic
    })
    this.setupLambdaMetricAlarms({
      lambda: coreLambda,
      topic: this.snsTopic, // FIXME
      idPrefix: 'Core'
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
    return new CompliantTopic(this, 'Topic', {
      masterKey: new Key(this, 'SnsKey')
    })
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
    const lambda = new NodejsFunction(this, 'CoreLambda', {
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
