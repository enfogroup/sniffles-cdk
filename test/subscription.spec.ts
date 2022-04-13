import * as subscription from '../lib/subscriptionLambda'

describe('Subscription lambda', () => {
  afterEach(() => {
    jest.restoreAllMocks()
  })

  describe('handler', () => {
    it('should subscribe all matched log groups', async () => {
      jest.spyOn(subscription, 'getLogGroupsAndPatterns').mockResolvedValue([
        ['/aws/lambda/cool-prod-abc', '/aws/lambda/cool-prod-def', '/aws/lambda/cool-test-abc', '/aws/lambda/cool-test-def'],
        ['^/aws/lambda/.*-prod-.*'],
        []
      ])
      const subscribeMock = jest.spyOn(subscription, 'subscribeLogGroup').mockResolvedValue()

      const output = await subscription.handler()

      expect(output).toEqual('OK')
      expect(subscribeMock.mock.calls.length).toEqual(2)
      expect(subscribeMock.mock.calls[0][0]).toEqual('/aws/lambda/cool-prod-abc')
      expect(subscribeMock.mock.calls[1][0]).toEqual('/aws/lambda/cool-prod-def')
    })
  })

  describe('filterLogGroups', () => {
    it('should include everything from inclusions', () => {
      const output = subscription.filterLogGroups([
        ['nope', 'abc', 'abd', 'aaa', 'def', 'always'],
        ['^a[a-z]{2}$'],
        []
      ])

      expect(output).toEqual(['abc', 'abd', 'aaa'])
    })

    it('should exclude things from exclusions', () => {
      const output = subscription.filterLogGroups([
        ['nope', 'abc', 'abd', 'aaa', 'def', 'always'],
        ['.*'],
        ['^a[a-z]{2}$']
      ])

      expect(output).toEqual(['nope', 'def', 'always'])
    })

    it('should give exclusions priority over inclusions', () => {
      const output = subscription.filterLogGroups([
        ['abc', 'abd', 'def', 'always', 'aloha', 'aaa'],
        ['a[a-z]*'],
        ['^a[a-z]{2}$']
      ])

      expect(output).toEqual(['always', 'aloha'])
    })

    it('should remove everything with Sniffles in the name', () => {
      const output = subscription.filterLogGroups([
        ['Sniffles', 'SnifflesPrefix', 'InSnifflesFix', 'SuffixSniffles', 'sniffles', 'snifflesPrefix', 'in-sniffles-fix', 'suffix-sniffles'],
        ['.*'],
        ['^$']
      ])

      expect(output).toEqual([])
    })
  })
})
