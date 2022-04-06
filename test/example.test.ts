import '@aws-cdk/assert/jest'
import * as cdk from 'aws-cdk-lib'

// to be tested
import { ExampleConstruct, applyBucketSettings } from '../lib/example'

// tools
import { ABSENT } from '@aws-cdk/assert/lib/assertions/have-resource'
import { Bucket } from '@enfo/aws-cdkompliance'

describe('Test examples', () => {
  describe('Example construct', () => {
    it('should be possible to enable static website hosting', () => {
      const stack = new cdk.Stack()

      new ExampleConstruct(stack, 'EnableIndex', {
        bucketName: 'my-bucket',
        indexDocument: 'index.html'
      })

      expect(stack).toHaveResource('AWS::S3::Bucket', {
        WebsiteConfiguration: {
          IndexDocument: 'index.html'
        }
      })
    })

    it('should not enable static website hosting by default', () => {
      const stack = new cdk.Stack()

      new ExampleConstruct(stack, 'DisableIndex', {
        bucketName: 'my-bucket'
      })

      expect(stack).toHaveResource('AWS::S3::Bucket', {
        WebsiteConfiguration: ABSENT
      })
    })
  })

  describe('applyBucketSettings', () => {
    it('should set public access', () => {
      const stack = new cdk.Stack()
      const bucket = new Bucket(stack, 'TestBucket')

      expect(stack).toHaveResource('AWS::S3::Bucket', {
        LifecycleConfiguration: ABSENT
      })

      applyBucketSettings(bucket)

      expect(stack).toHaveResource('AWS::S3::Bucket', {
        LifecycleConfiguration: {
          Rules: [
            {
              Status: 'Enabled',
              Transitions: [
                {
                  StorageClass: 'GLACIER',
                  TransitionInDays: 30
                }
              ]
            }
          ]
        }
      })
    })
  })
})
