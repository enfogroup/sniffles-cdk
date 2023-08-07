import * as keys from '../lib/keys'

import '@aws-cdk/assert/jest'
import { Stack } from 'aws-cdk-lib'
import { Key } from 'aws-cdk-lib/aws-kms'

/**
 * Not the cleanest tests
 * Positions within Statement array matters
 * SnifflesKey tests casually ignores SNS being added twice
 */
describe('Keys', () => {
  describe('CloudWatchAccessKeyAccessRights', () => {
    it('should grant access for CloudWatch', () => {
      const stack = new Stack()
      const key = new Key(stack, 'Key')
      new keys.CloudWatchKeyAccessRights(stack, 'AccessRights', {
        key
      })

      expect(stack).toHaveResourceLike('AWS::KMS::Key', {
        KeyPolicy: {
          Statement: [
            {},
            {
              Action: [
                'kms:Decrypt',
                'kms:GenerateDataKey*'
              ],
              Effect: 'Allow',
              Principal: {
                Service: 'cloudwatch.amazonaws.com'
              },
              Resource: '*'
            }
          ]
        }
      })
    })

    it('should grant access for SNS', () => {
      const stack = new Stack()
      const key = new Key(stack, 'Key')
      new keys.CloudWatchKeyAccessRights(stack, 'AccessRights', {
        key
      })

      expect(stack).toHaveResourceLike('AWS::KMS::Key', {
        KeyPolicy: {
          Statement: [
            {},
            {},
            {
              Action: [
                'kms:Decrypt',
                'kms:GenerateDataKey*'
              ],
              Effect: 'Allow',
              Principal: {
                Service: 'sns.amazonaws.com'
              },
              Resource: '*'
            }
          ]
        }
      })
    })
  })

  describe('LogsKeyAccessRights', () => {
    it('should grant access for SNS', () => {
      const stack = new Stack()
      const key = new Key(stack, 'Key')
      new keys.LogsKeyAccessRights(stack, 'AccessRights', {
        key
      })

      expect(stack).toHaveResourceLike('AWS::KMS::Key', {
        KeyPolicy: {
          Statement: [
            {},
            {
              Action: [
                'kms:Decrypt',
                'kms:GenerateDataKey*'
              ],
              Effect: 'Allow',
              Principal: {
                Service: 'sns.amazonaws.com'
              },
              Resource: '*'
            }
          ]
        }
      })
    })

    it('should grant access for Lambda', () => {
      const stack = new Stack()
      const key = new Key(stack, 'Key')
      new keys.LogsKeyAccessRights(stack, 'AccessRights', {
        key
      })

      expect(stack).toHaveResourceLike('AWS::KMS::Key', {
        KeyPolicy: {
          Statement: [
            {},
            {},
            {
              Action: [
                'kms:Decrypt',
                'kms:GenerateDataKey*'
              ],
              Effect: 'Allow',
              Principal: {
                Service: 'lambda.amazonaws.com'
              },
              Resource: '*'
            }
          ]
        }
      })
    })
  })

  describe('SnifflesKey', () => {
    it('should grant access for CloudWatch', () => {
      const stack = new Stack()
      new keys.SnifflesKey(stack, 'Key')

      expect(stack).toHaveResourceLike('AWS::KMS::Key', {
        KeyPolicy: {
          Statement: [
            {},
            {
              Action: [
                'kms:Decrypt',
                'kms:GenerateDataKey*'
              ],
              Effect: 'Allow',
              Principal: {
                Service: 'cloudwatch.amazonaws.com'
              },
              Resource: '*'
            }
          ]
        }
      })
    })

    it('should grant access for SNS', () => {
      const stack = new Stack()
      new keys.SnifflesKey(stack, 'Key')

      expect(stack).toHaveResourceLike('AWS::KMS::Key', {
        KeyPolicy: {
          Statement: [
            {},
            {},
            {
              Action: [
                'kms:Decrypt',
                'kms:GenerateDataKey*'
              ],
              Effect: 'Allow',
              Principal: {
                Service: 'sns.amazonaws.com'
              },
              Resource: '*'
            }
          ]
        }
      })
    })

    it('should grant access for Lambda', () => {
      const stack = new Stack()
      new keys.SnifflesKey(stack, 'Key')
      expect(stack).toHaveResourceLike('AWS::KMS::Key', {
        KeyPolicy: {
          Statement: [
            {},
            {},
            {},
            {},
            {
              Action: [
                'kms:Decrypt',
                'kms:GenerateDataKey*'
              ],
              Effect: 'Allow',
              Principal: {
                Service: 'lambda.amazonaws.com'
              },
              Resource: '*'
            }
          ]
        }
      })
    })
  })
})
