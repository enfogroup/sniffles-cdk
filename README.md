# Introduction

Sniffles is a solution for automatic formatting and forwarding of CloudWatch logs based alarms in AWS using the CDK. Log an error and have it forwarded to a destination of your choice such as OpsGenie.

# Installation

Sniffles requires the AWS CDK version 2.x. You install it by running

```bash
npm install @enfo/sniffles
```

# Getting started

Sniffles requires no configuration to get started, it is however recommend that inclusion and exclusion patterns for log groups and log filtering are modified to fulfil your needs. Due to Sniffles using AWS KMS keys for some of its resources you have to specify account and region when defining your stack, you can read about it [here](https://docs.aws.amazon.com/cdk/v2/guide/environments.html).

# How it works

Sniffles uses a Lambda Function to subscribe log groups matching regular expressions to a Kinesis stream. Log lines are then processed by a Lambda Function which uses regular expressions to evaluate if something is an error. Errors are published to an SNS topic which in turn can have subscriptions to services such as OpsGenie.

# Examples

## Basic usage

Example of forwarding logged errors and internal Sniffles errors to OpsGenie.

```typescript
import { OpsGenieForwarder, Sniffles, SnifflesKey } from '@enfo/sniffles'

import { Stack, StackProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { UrlSubscription } from 'aws-cdk-lib/aws-sns-subscriptions';
import { Topic } from 'aws-cdk-lib/aws-sns';
import { SnsEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';

export class MyCoolStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const { key } = new SnifflesKey(this, 'Key')

    const cloudWatchTopic = new Topic(this, 'CloudWatchTopic', {
      masterKey: key
    })
    cloudWatchTopic.addSubscription(new UrlSubscription('https://api.eu.opsgenie.com/v1/json/cloudwatch?apiKey=abc-123')

    const opsGenieTopic = new Topic(this, 'OpsGenieTopic', {
      masterKey: key
    })
    opsGenieTopic.addSubscription(new UrlSubscription('https://api.eu.opsgenie.com/v1/json/amazonsns?apiKey=def-456'))

    const errorLogTopic = new Topic(this, 'ErrorLogTopic', {
      masterKey: key
    })

    const sniffles = new Sniffles(this, 'Sniffles', {
      cloudWatchTopic,
      errorLogTopic
    })

    new OpsGenieForwarder(this, 'OpsGenie', {
      cloudWatchTopic,
      opsGenieTopic,
      errorLogTopic
    })
  }
}
```

The SnifflesKey Construct creates a CMK with a generous Key Policy. It allows usage by the services used within Sniffles.

## Skipping encryption

The previous example uses a KMS Key with a Key Policy set by Sniffles. You can also use SNS Topics with no encryption. Not encrypting your data at transit is discouraged though.

```typescript
import { OpsGenieForwarder, Sniffles, SnifflesKey } from '@enfo/sniffles'

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

    const errorLogTopic = new Topic(this, 'ErrorLogTopic')

    const sniffles = new Sniffles(this, 'Sniffles', {
      cloudWatchTopic,
      errorLogTopic
    })

    new OpsGenieForwarder(this, 'OpsGenie', {
      cloudWatchTopic,
      opsGenieTopic,
      errorLogTopic
    })
  }
}
```

If you wish to use the AWS Managed Key for SNS this will work for the *opsGenieTopic* and *errorLogTopic*, but not the *cloudWatchTopic*.

## Using your own KMS Key

Sniffles exposes Constructs which makes the necessary changes to an existing CMK. These Constructs are used by SnifflesKey under the hood.

```typescript
import { OpsGenieForwarder, Sniffles, CloudWatchKeyAccessRights, LogsKeyAccessRights } from '@enfo/sniffles'

import { Stack, StackProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { UrlSubscription } from 'aws-cdk-lib/aws-sns-subscriptions';
import { Topic } from 'aws-cdk-lib/aws-sns';
import { SnsEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';
import { Key } from 'aws-cdk-lib/aws-kms'

export class MyCoolStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // The key can be an existing Key that gets imported etc
    const key = new Key(this, 'Key')
    new CloudWatchKeyAccessRights(this, 'CWAccessRights', {
      key
    })
    new LogsKeyAccessRights(this, 'LogsAccessRights', {
      key
    })

    const cloudWatchTopic = new Topic(this, 'CloudWatchTopic', {
      masterKey: key
    })
    cloudWatchTopic.addSubscription(new UrlSubscription('https://api.eu.opsgenie.com/v1/json/cloudwatch?apiKey=abc-123')

    const opsGenieTopic = new Topic(this, 'OpsGenieTopic', {
      masterKey: key
    })
    opsGenieTopic.addSubscription(new UrlSubscription('https://api.eu.opsgenie.com/v1/json/amazonsns?apiKey=def-456'))

    const errorLogTopic = new Topic(this, 'ErrorLogTopic', {
      masterKey: key
    })

    const sniffles = new Sniffles(this, 'Sniffles', {
      cloudWatchTopic,
      errorLogTopic
    })

    new OpsGenieForwarder(this, 'OpsGenie', {
      cloudWatchTopic,
      opsGenieTopic,
      errorLogTopic
    })
  }
}
```

# Configuration options

All parameters are optional. Below you will find an example of a potential configuration.

```typescript
new Sniffles(this, 'Sniffles', {
  subscriptionInclusionPatterns: ['^/aws/lambda/prefix-.*'], // regular expressions for log groups which are of interest
  subscriptionExclusionPatterns: ['.*-test-.*'], // regular expressions for log groups which should be ignored. Trumps inclusionPatterns
  filterInclusionPatterns: ['{ .level === "error" }', '/ERROR/'], // regular expressions for log lines which are considered alarms
  filterExclusionPatterns: ['{ .someKey === "someValue" }'], // regular expressions for log lines which are considered safe. Trumps inclusionPatterns
  errorLogTopic: new Topic(this, 'ErrorLogTopic'), // topic to publish log lines considered errors to. If none is provided one will be created
  stream: new Stream(this, 'SubscriptionStream'), // kinesis stream which log groups will be subscribed to. If none is provided one will be created
  cloudWatchTopic: new Topic(this, 'CloudWatchTopic') // topic to publish internal errors to. If none is provided one will be created
})
```

# Feedback loop

Sniffles will refuse to subscribe any log groups with "sniffles" or "Sniffles" in the name. The purpose of this is to avoid a potential feedback loop.

# Log group exclusions

Sniffles is only capable of adding subscriptions, not removing them. Updating the log groups exclusion patterns to be stricter will not lead to subscriptions being removed. If you find yourself wanting to remove subscriptions we recommend you delete them manually or tear down the Sniffles Construct and deploy it again.

# Architecture

The Sniffles architecture is self contained and written to report internal errors that occur.

![Sniffles Architecture](https://github.com/enfogroup/sniffles-cdk/blob/master/media/sniffles.png)

Explanation of components:

* Subscriptions Lambda Function. Runs every 15 minutes looking for log groups to subscribe
* CloudWatch topic. Any internal error such as Lambda Functions crashing, unprocessable events etc will be published to this topic
* Kinesis stream. Used to process everything logged
* Filter Lambda Function. Receives all log lines and forwards those matching the error patterns to the Error Log Topic
* Error Log topic. Receives all log lines considered to be errors
* SSM parameters. Used to store config for Lambda Functions
* Queue. DLQ for Filter Lambda Function


# OpsGenie

Anything matched by the Filter Lambda Function will end up on the Error Log topic. You can use the OpsGenieForwarder Construct to format OpsGenie Alerts and forward them to OpsGenie. The OpsGenieForwarder makes assumptions about the logged format. If you are using a different format you can always write your own Forwarder.

```typescript
new OpsGenieForwarder(this, 'OpsGenie', {
  cloudWatchTopic: sniffles.cloudWatchTopic, // topic to report internal errors to
  opsGenieTopic, // topic to publish error log lines to
  errorLogTopic: sniffles.errorLogTopic // topic acting as event source
})
```

# Log format default

The error log format default is the one used by [@enfo/logger](https://www.npmjs.com/package/@enfo/logger):

```typescript
{
  level: 'error',
  message: 'Something informative',
  ...
}
```

# Error format

The subject reported to OpsGenie will be of the format "{awsAccountId} {logGroupName} {logLine.message}". Let us say you are running in account 111122223333 and logging to /aws/lambda/example with the following logged line

```typescript
{
  level: 'error',
  message: 'Something informative'
}
```

The subject will then be "111122223333 /aws/lambda/example Something informative". If you want a different format you will have to write your own forwarder.

# Architecture

The OpsGenieForwarder is self contained and written to report internal errors that occur.

![OpsGenieForwarder Architecture](https://github.com/enfogroup/sniffles-cdk/blob/master/media/opsGenieForwarder.png)

Explanation of components:

* Forwarder Lambda Function. Receives an error log line, formats it and forwards to an SNS topic
* Error Log topic. Used to invoke Forwarder Lambda Function
* CloudWatch topic. Any internal error such as Lambda Functions crashing, unprocessable events etc will be published to this topics
* OpsGenie topic. Used to publish formatted log lines
* Queue. DLQ for Forwarder Lambda Function

# Writing your own forwarder

Writing your own Forwarder is easy. Check the [Sniffles source code](https://github.com/enfogroup/sniffles-cdk) for guidance.

# Known issues

If no SNS Topics are supplied to the Sniffles construct the AWS Managed KMS Key for SNS will be used (alias/aws/sns). The AWS Managed KMS Keys are only created when needed. If the Key does not exist deployment of Sniffles will fail. You can generate the necessary Key in a region by using the AWS console, starting the process of creating an SNS topic and opening the Encryption section. This will force the Key to be generated. Please note that AWS Managed KMS Keys are regional.
