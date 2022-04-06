# Introduction

This is a template for a CDK NPM package. It should assist you in setting up Constructs and general CDK Construct functions. Have fun!s

## Installed packages

This is a list of installed packages and their purpose.

* cdk - hopefully obvious
* husky - git hooks
* pinst - disables installation of husky for the published package (will break things when installing the published package otherwise)
* commitlint - enforces commit message format

## CDK functionality examples

There are examples of how to build functionality sing the CDK in this template.

### ExampleConstruct

The ExampleConstruct takes and extension of cdk.StackProps and creates resources. This could be used as a basis for other Constructs.

### applyBucketSettings

This function takes an S3 Bucket Construct as input and applies some settings. This could be used as a basis for other CDK functions applying different settings.

## Working with tests

The package includes a small test suite. The main goal of the test suite is to check the logic present via props. If you are having trouble running the tests you can try deleting node modules, deleting package-lock.json and reinstalling everything. The CDK is very wonky when it comes to potential module mismatches.
