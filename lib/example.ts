import { Bucket } from '@enfo/aws-cdkompliance'
import { Duration, StackProps } from 'aws-cdk-lib'
import { LifecycleRule, StorageClass } from 'aws-cdk-lib/aws-s3'
import { Construct } from 'constructs'

/**
 * Props for ExampleConstruct
 */
export interface ExampleConstructProps extends StackProps {
  /**
   * Name of S3 bucket
   */
  bucketName: string;
  /**
   * Optional name of index document enabling static website hosting
   */
  indexDocument?: string;
}

/**
 * Example construct which will create an S3 bucket based on user input
 */
export class ExampleConstruct extends Construct {
  constructor (scope: Construct, id: string, props: ExampleConstructProps) {
    super(scope, id)

    new Bucket(scope, id + 'Bucket', {
      bucketName: props.bucketName,
      websiteIndexDocument: props.indexDocument
    })
  }
}

/**
 * Example function which applies settings to an S3 bucket
 * @param bucket
 * S3 Bucket
 */
export const applyBucketSettings = (bucket: Bucket): void => {
  const rule: LifecycleRule = {
    transitions: [
      {
        storageClass: StorageClass.GLACIER,
        transitionAfter: Duration.days(30)
      }
    ]
  }
  bucket.addLifecycleRule(rule)
}
