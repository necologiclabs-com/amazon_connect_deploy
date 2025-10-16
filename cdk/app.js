#!/usr/bin/env node

const { App } = require('aws-cdk-lib');
const { ConnectFlowStack } = require('./lib/connect-flow-stack');

const app = new App();

// Get context values
const environment = app.node.tryGetContext('environment') || 'dev';
const flowsPath = app.node.tryGetContext('flowsPath') || '../dist/dev';
const releaseTag = app.node.tryGetContext('releaseTag');
const releaseDate = app.node.tryGetContext('releaseDate');
const gitSha = app.node.tryGetContext('gitSha');
const blueGreenDeployment = app.node.tryGetContext('blueGreenDeployment') === 'true';

console.log(`Deploying for environment: ${environment}`);
console.log(`Flows path: ${flowsPath}`);
if (releaseTag) console.log(`Release tag: ${releaseTag}`);

// Create stack
new ConnectFlowStack(app, `ConnectFlowStack-${environment}`, {
    environment,
    flowsPath,
    releaseTag,
    releaseDate,
    gitSha,
    blueGreenDeployment,
    env: {
        // Use environment variables or default values
        account: process.env.CDK_DEFAULT_ACCOUNT,
        region: process.env.CDK_DEFAULT_REGION || 'us-east-1',
    },
    stackName: `amazon-connect-flows-${environment}`,
    description: `Amazon Connect Contact Flows for ${environment} environment`,
    tags: {
        Environment: environment,
        Project: 'amazon-connect-deploy',
        ManagedBy: 'CDK',
        ...(releaseTag && { ReleaseTag: releaseTag }),
        ...(gitSha && { GitCommit: gitSha }),
    },
});

app.synth();