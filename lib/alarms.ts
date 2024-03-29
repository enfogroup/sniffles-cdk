import { Duration, Stack } from 'aws-cdk-lib'
import { Alarm, AlarmProps, ComparisonOperator, Metric, TreatMissingData } from 'aws-cdk-lib/aws-cloudwatch'
import { SnsAction } from 'aws-cdk-lib/aws-cloudwatch-actions'
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs'
import { MetricFilter } from 'aws-cdk-lib/aws-logs'
import { Topic } from 'aws-cdk-lib/aws-sns'
import { Queue } from 'aws-cdk-lib/aws-sqs'
import { Construct } from 'constructs'

interface QueueAlarmsProps {
  queue: Queue
  topic: Topic
}

export class QueueAlarms extends Construct {
  constructor (scope: Construct, id: string, props: QueueAlarmsProps) {
    super(scope, id)

    const alarm = new Alarm(this, 'DLQAlarm', {
      evaluationPeriods: 60,
      threshold: 1,
      datapointsToAlarm: 1,
      comparisonOperator: ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: TreatMissingData.MISSING,
      metric: new Metric({
        namespace: 'AWS/SQS',
        metricName: 'ApproximateNumberOfMessagesDelayed',
        dimensionsMap: {
          QueueName: props.queue.queueName
        },
        period: Duration.minutes(1)
      })
    })
    alarm.addAlarmAction(new SnsAction(props.topic))
  }
}

interface FunctionAlarmsProps {
  fun: NodejsFunction
  topic: Topic
}

export class FunctionAlarms extends Construct {
  constructor (scope: Construct, id: string, props: FunctionAlarmsProps) {
    super(scope, id)

    const { fun, topic } = props
    const functionName = fun.functionName
    const account = Stack.of(this).account
    const region = Stack.of(this).region

    const alarms: Alarm[] = []

    const namespace = 'sniffles-log-errors'
    const logErrorsMetricName = functionName
    new MetricFilter(this, 'MetricFilter', {
      filterPattern: {
        logPatternString: '"ERROR"'
      },
      logGroup: fun.logGroup,
      metricName: logErrorsMetricName,
      metricValue: '1',
      metricNamespace: namespace
    })

    const logGroupLink = `https://${region}.console.aws.amazon.com/cloudwatch/home?region=${region}#logsV2:log-groups/log-group/$252Faws$252Flambda$252F${functionName}`
    const commonAlarmProps: Pick<AlarmProps, 'evaluationPeriods' | 'threshold' | 'datapointsToAlarm' | 'comparisonOperator' | 'treatMissingData'> = {
      evaluationPeriods: 1,
      threshold: 1,
      datapointsToAlarm: 1,
      comparisonOperator: ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: TreatMissingData.MISSING
    }

    alarms.push(new Alarm(this, 'LogErrorAlarm', {
      alarmName: `${functionName} logged an error`,
      alarmDescription: `Lambda function ${functionName} in ${account} logged an error. ${logGroupLink}/log-events$3FfilterPattern$3D$2522ERROR$2522`,
      ...commonAlarmProps,
      metric: new Metric({
        namespace,
        metricName: logErrorsMetricName,
        statistic: 'sum',
        period: Duration.minutes(1)
      })
    }))

    alarms.push(new Alarm(this, 'ThrottledAlarm', {
      alarmName: `${functionName} was throttled`,
      alarmDescription: `Lambda function ${functionName} in ${account} was throttled. ${logGroupLink}`,
      ...commonAlarmProps,
      metric: new Metric({
        namespace: 'AWS/Lambda',
        metricName: 'Throttles',
        statistic: 'sum',
        dimensionsMap: {
          FunctionName: functionName
        },
        period: Duration.minutes(1)
      })
    }))

    alarms.push(new Alarm(this, 'ErrorExitAlarm', {
      alarmName: `${functionName} exited with an error`,
      alarmDescription: `Lambda function ${functionName} in ${account} exited with an error. ${logGroupLink}`,
      ...commonAlarmProps,
      metric: new Metric({
        namespace: 'AWS/Lambda',
        metricName: 'Errors',
        statistic: 'sum',
        dimensionsMap: {
          FunctionName: functionName
        },
        period: Duration.minutes(1)
      })
    }))

    alarms.forEach((alarm: Alarm): void => alarm.addAlarmAction(new SnsAction(topic)))
  }
}
