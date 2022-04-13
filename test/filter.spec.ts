import * as filter from '../lib/filterLambda'

import { KinesisStreamEvent, KinesisStreamRecord } from 'aws-lambda'
import { checkAllMocksCalled } from './tools'

describe('Filter lambda', () => {
  afterEach(() => {
    jest.restoreAllMocks()
  })

  describe('handler', () => {
    const buildKinesisRecord = (data: object): KinesisStreamRecord => {
      return {
        kinesis: {
          data: Buffer.from(JSON.stringify({
            logEvents: [{
              message: JSON.stringify(data)
            }]
          })).toString('base64')
        }
      } as unknown as KinesisStreamRecord
    }

    const buildInput = (data: object[]): KinesisStreamEvent => {
      const input: KinesisStreamEvent = {
        Records: data.map(buildKinesisRecord)
      } as KinesisStreamEvent
      return input
    }

    it('should match a single log line', async () => {
      const input = buildInput([{ level: 'error' }])
      const mocks = [
        jest.spyOn(filter, 'getInclusionPatterns').mockResolvedValue(['{ .level === "error" }']),
        jest.spyOn(filter, 'getExclusionPatterns').mockResolvedValue(['^$'])
      ]
      const publishLogMock = jest.spyOn(filter, 'publishLog').mockResolvedValue()

      const output = await filter.handler(input)

      expect(output).toEqual('OK')
      expect(publishLogMock.mock.calls).toEqual([
        [{ logEvents: [{ message: '{"level":"error"}' }] }]
      ])
      checkAllMocksCalled(mocks, 1)
    })

    it('should match multiple log lines', async () => {
      const input = buildInput([{ level: 'error', a: 42 }, { level: 'error', b: 4711 }])
      const mocks = [
        jest.spyOn(filter, 'getInclusionPatterns').mockResolvedValue(['{ .level === "error" }']),
        jest.spyOn(filter, 'getExclusionPatterns').mockResolvedValue(['^$'])
      ]
      const publishLogMock = jest.spyOn(filter, 'publishLog').mockResolvedValue()

      const output = await filter.handler(input)

      expect(output).toEqual('OK')
      expect(publishLogMock.mock.calls).toEqual([
        [{ logEvents: [{ message: '{"level":"error","a":42}' }] }],
        [{ logEvents: [{ message: '{"level":"error","b":4711}' }] }]
      ])
      checkAllMocksCalled(mocks, 1)
    })

    it('should not match anything', async () => {
      const input = buildInput([{ level: 'info' }])
      const mocks = [
        jest.spyOn(filter, 'getInclusionPatterns').mockResolvedValue(['{ .level === "error" }']),
        jest.spyOn(filter, 'getExclusionPatterns').mockResolvedValue(['^$'])
      ]
      const publishLogMock = jest.spyOn(filter, 'publishLog').mockResolvedValue()

      const output = await filter.handler(input)

      expect(output).toEqual('OK')
      expect(publishLogMock.mock.calls).toEqual([])
      checkAllMocksCalled(mocks, 1)
    })

    it('should use exclusions', async () => {
      const input = buildInput([{ level: 'error', a: 42 }, { level: 'error', b: 4711 }])
      const mocks = [
        jest.spyOn(filter, 'getInclusionPatterns').mockResolvedValue(['{ .level === "error" }']),
        jest.spyOn(filter, 'getExclusionPatterns').mockResolvedValue(['{ .b === 4711 }'])
      ]
      const publishLogMock = jest.spyOn(filter, 'publishLog').mockResolvedValue()

      const output = await filter.handler(input)

      expect(output).toEqual('OK')
      expect(publishLogMock.mock.calls).toEqual([
        [{ logEvents: [{ message: '{"level":"error","a":42}' }] }]
      ])
      checkAllMocksCalled(mocks, 1)
    })
  })
})
