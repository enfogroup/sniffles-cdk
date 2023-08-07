import { Key as CompliantKey } from '@enfo/aws-cdkompliance'
import { Effect, PolicyStatement, ServicePrincipal } from 'aws-cdk-lib/aws-iam'
import { IKey, Key, KeyProps } from 'aws-cdk-lib/aws-kms'
import { Construct } from 'constructs'

export interface CloudWatchKeyAccessRightsProps {
  /**
   * Customer Managed KMS Key
   */
  readonly key: IKey
}

/**
 * Updates the Key Policy of a CMK to allow usage by CloudWatch and SNS
 */
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
  /**
   * Customer Managed KMS Key
   */
  readonly key: IKey
}

/**
 * Updates the Key Policy of a CMK to allow usage by SNS and Lambda
 */
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

/**
 * Creates a KMS Key which can be used when creating SNS Topics for a Sniffles instance
 */
export class SnifflesKey extends Construct {
  public readonly key: Key

  constructor (scope: Construct, id: string, props?: KeyProps) {
    super(scope, id)

    this.key = new CompliantKey(this, 'Key', props)

    new CloudWatchKeyAccessRights(scope, 'CloudWatchAccessRights', {
      key: this.key
    })

    new LogsKeyAccessRights(scope, 'LogsAccessRights', {
      key: this.key
    })
  }
}
