# Introduction

Sniffles is a solution for automatic formatting and forwarding of CloudWatch logs based alarms in AWS using the CDK. Log an error and have it forwarded to a destination of your choice such as OpsGenie.

## Installation

Sniffles requires the AWS CDK version 2.x. You install it by running

```bash
npm install @enfo/sniffles
```

## Getting started

Sniffles requires no configuration to get started, it is however recommend that inclusion and exclusion patterns for log groups and log filtering are modified to fulfil your needs.

### How it works

Sniffles uses a lambda to subscribe log groups matching regular expressions to a Kinesis stream. Log lines are then processed by a lambda which uses regular expressions to evaluate if something is an error. Errors are published to an SNS topic which in turn can have subscriptions to services such as OpsGenie.

### Simple example

Example of forwarding logged errors and internal Sniffles errors to OpsGenie:

```typescript
import { OpsGenieForwarder, Sniffles } from '@enfo/sniffles'

import { Stack, StackProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { UrlSubscription } from 'aws-cdk-lib/aws-sns-subscriptions';
import { Topic } from 'aws-cdk-lib/aws-sns';
import { SnsEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';

export class MyCoolStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const cloudWatchTopic = new Topic(this, 'CloudWatchTopic')
    cloudWatchTopic.addSubscription(new UrlSubscription('https://api.eu.opsgenie.com/v1/json/cloudwatch?apiKey=abc-123')
    const opsGenieTopic = new Topic(this, 'OpsGenieTopic')
    opsGenieTopic.addSubscription(new UrlSubscription('https://api.eu.opsgenie.com/v1/json/amazonsns?apiKey=def-456'))

    const sniffles = new Sniffles(this, 'Sniffles', {
      cloudWatchTopic
    })

    new OpsGenieForwarder(this, 'OpsGenie', {
      cloudWatchTopic: sniffles.cloudWatchTopic,
      opsGenieTopic,
      errorLogTopic: sniffles.errorLogTopic
    })
  }
}
```

### Configuration options

All parameters on all levels are optional. Below you will find an example of a potential configuration.

```typescript
new Sniffles(this, 'Sniffles', {
  subscribeLogGroupsProps: {
    inclusionPatterns: ['^/aws/lambda/prefix-.*'], // regular expressions for log groups which are of interest
    exclusionPatterns: ['.*-test-.*'] // regular expressions for log groups which should be ignored. Trumps inclusionPatterns
  },
  filterLogsProps: {
    inclusionPatterns: ['{ .level === "error" }', '/ERROR/'], // regular expressions for log lines which are considered alarms
    exclusionPatterns: ['{ .someKey === "someValue" }'], // regular expressions for log lines which are considered safe. Trumps inclusionPatterns
    topic: new Topic(this, 'ErrorLogTopic') // topic to publish log lines considered errors to. If none is provided one will be created
  },
  stream: new Stream(this, 'SubscriptionStream'), // kinesis stream which log groups will be subscribed to. If none is provided one will be created
  cloudWatchTopic: new Topic(this, 'CloudWatchTopic') // topic to publish internal errors to. If none is provided one will be created
})
```

### Feedback loop

Sniffles will refuse to subscribe any log groups with "sniffles" or "Sniffles" in the name. The purpose of this is to avoid a potential feedback loop.

### Log group exclusions

Sniffles is only capable of adding subscriptions, not removing them. Updating the log groups exclusion patterns to be stricter will not lead to subscriptions being removed. If you find yourself wanting to remove subscriptions we recommend you delete them manually or tear down the Sniffles Construct and deploy it again.

## Architecture

The Sniffles architecture is self contained and written to report internal errors that occur.

![Sniffles Architecture](https://github.com/enfogroup/sniffles-cdk/blob/master/media/sniffles.png)

Explanation of components:

* Subscriptions lambda. Runs every 15 minutes looking for log groups to subscribe
* CloudWatch topic. Any internal error such as lambdas crashing, unprocessable events etc will be published to this topic
* Kinesis stream. Used to process everything logged
* Filter lambda. Receives all log lines and forwards those matching the error patterns to the Error Log Topic
* Error Log topic. Receives all log lines considered to be errors
* SSM parameters. Used to store config for lambdas
* Queue. DLQ for Filter lambda


## OpsGenie

Anything matched by the Filter lambda will end up on the Error Log topic. You can use the OpsGenieForwarder Construct to format OpsGenie Alerts and forward them to OpsGenie. The OpsGenieForwarder makes assumptions about the logged format. If you are using a different format you can always write your own Forwarder.

```typescript
new OpsGenieForwarder(this, 'OpsGenie', {
  cloudWatchTopic: sniffles.cloudWatchTopic, // topic to report internal errors to
  opsGenieTopic, // topic to publish error log lines to
  errorLogTopic: sniffles.errorLogTopic // topic acting as event source
})
```

### Log format default

The error log format default is the one used by [@enfo/logger](https://www.npmjs.com/package/@enfo/logger):

```typescript
{
  level: 'error',
  message: 'Something informative',
  ...
}
```

### Error format

The subject reported to OpsGenie will be of the format "{awsAccountId} {logGroupName} {logLine.message}". Let us say you are running in account 111122223333 and logging to /aws/lambda/example with the following logged line

```typescript
{
  level: 'error',
  message: 'Something informative'
}
```

The subject will then be "111122223333 /aws/lambda/example Something informative". If you want a different format you will have to write your own forwarder.

### Architecture

The OpsGenieForwarder is self contained and written to report internal errors that occur.

![OpsGenieForwarder Architecture](https://github.com/enfogroup/sniffles-cdk/blob/master/media/opsGenieForwarder.png)

Explanation of components:

* Forwarder lambda. Receives an error log line, formats it and forwards to an SNS topic
* Error Log topic. Used to invoke Forwarder lambda
* CloudWatch topic. Any internal error such as lambdas crashing, unprocessable events etc will be published to this topics
* OpsGenie topic. Used to publish formatted log lines
* Queue. DLQ for Forwarder lambda

### Writing your own forwarder

Writing your own Forwarder is easy. Check the [Sniffles source code](https://github.com/enfogroup/sniffles-cdk) for guidance.
