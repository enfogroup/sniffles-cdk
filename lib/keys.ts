import { Key } from '@enfo/aws-cdkompliance'
import { Effect, PolicyStatement, ServicePrincipal } from 'aws-cdk-lib/aws-iam'
import { IKey, KeyProps } from 'aws-cdk-lib/aws-kms'
import { Construct } from 'constructs'

export interface CloudWatchKeyAccessRightsProps {
  key: IKey
}

export class CloudWatchKeyAccessRights extends Construct {
  constructor (scope: Construct, id: string, props: CloudWatchKeyAccessRightsProps) {
    super(scope, id)

    props.key.addToResourcePolicy(new PolicyStatement({
      sid: 'allowCloudWatch',
      effect: Effect.ALLOW,
      actions: [
        'kms:Decrypt',
        'kms:GenerateDataKey*'
      ],
      principals: [
        new ServicePrincipal('cloudwatch.amazonaws.com')
      ],
      resources: [
        '*'
      ]
    }))
    props.key.addToResourcePolicy(new PolicyStatement({
      sid: 'allowCloudWatchSns',
      effect: Effect.ALLOW,
      actions: [
        'kms:Decrypt',
        'kms:GenerateDataKey*'
      ],
      principals: [
        new ServicePrincipal('sns.amazonaws.com')
      ],
      resources: [
        '*'
      ]
    }))
  }
}

export interface LogsKeyAccessRightsProps {
  key: IKey
}

export class LogsKeyAccessRights extends Construct {
  constructor (scope: Construct, id: string, props: CloudWatchKeyAccessRightsProps) {
    super(scope, id)

    props.key.addToResourcePolicy(new PolicyStatement({
      sid: 'allowLogsSns',
      effect: Effect.ALLOW,
      actions: [
        'kms:Decrypt',
        'kms:GenerateDataKey*'
      ],
      principals: [
        new ServicePrincipal('sns.amazonaws.com')
      ],
      resources: [
        '*'
      ]
    }))
    props.key.addToResourcePolicy(new PolicyStatement({
      sid: 'allowLogsLambda',
      effect: Effect.ALLOW,
      actions: [
        'kms:Decrypt',
        'kms:GenerateDataKey*'
      ],
      principals: [
        new ServicePrincipal('lambda.amazonaws.com')
      ],
      resources: [
        '*'
      ]
    }))
  }
}

export class SnifflesKey extends Key {
  constructor (scope: Construct, id: string, props: KeyProps) {
    super(scope, id, props)

    new CloudWatchKeyAccessRights(scope, 'CloudWatchAccessRights', {
      key: this
    })

    new LogsKeyAccessRights(scope, 'LogsAccessRights', {
      key: this
    })
  }
}
