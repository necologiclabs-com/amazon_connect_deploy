const { Stack, Duration, CustomResource } = require('aws-cdk-lib');
const { Function: LambdaFunction, Runtime, Code } = require('aws-cdk-lib/aws-lambda');
const { PolicyStatement, Effect } = require('aws-cdk-lib/aws-iam');
const { Provider } = require('aws-cdk-lib/custom-resources');
const fs = require('fs-extra');
const path = require('path');
const yaml = require('yaml');

class ConnectFlowStack extends Stack {
    constructor(scope, id, props) {
        super(scope, id, props);

        this.environment = props.environment;
        this.flowsPath = props.flowsPath;
        this.releaseTag = props.releaseTag;
        this.releaseDate = props.releaseDate;
        this.gitSha = props.gitSha;
        this.blueGreenDeployment = props.blueGreenDeployment;

        // Load environment configuration
        this.loadEnvironmentConfig();

        // Create the Connect flow management Lambda
        this.createConnectFlowHandler();

        // Deploy contact flows
        this.deployContactFlows();
    }

    loadEnvironmentConfig() {
        const envConfigPath = path.join(__dirname, '../../env', `${this.environment}.yaml`);

        if (!fs.existsSync(envConfigPath)) {
            throw new Error(`Environment config not found: ${envConfigPath}`);
        }

        const yamlContent = fs.readFileSync(envConfigPath, 'utf8');
        this.envConfig = yaml.parse(yamlContent);

        console.log(`Loaded environment config for: ${this.environment}`);
    }

    createConnectFlowHandler() {
        // Create Lambda function for managing Connect flows
        this.connectFlowHandler = new LambdaFunction(this, 'ConnectFlowHandler', {
            runtime: Runtime.NODEJS_18_X,
            handler: 'index.handler',
            code: Code.fromInline(this.getConnectFlowHandlerCode()),
            timeout: Duration.minutes(15),
            description: 'Manages Amazon Connect contact flows deployment',
        });

        // Grant necessary permissions
        this.connectFlowHandler.addToRolePolicy(
            new PolicyStatement({
                effect: Effect.ALLOW,
                actions: [
                    'connect:CreateContactFlow',
                    'connect:UpdateContactFlowContent',
                    'connect:UpdateContactFlowName',
                    'connect:DescribeContactFlow',
                    'connect:ListContactFlows',
                    'connect:DeleteContactFlow',
                    'connect:AssociateInstanceStorageConfig',
                    'connect:DisassociateInstanceStorageConfig',
                    'lambda:AddPermission',
                    'lambda:RemovePermission',
                    'lambda:GetFunction',
                ],
                resources: ['*'], // Scope down in production
            })
        );

        // Create custom resource provider
        this.connectFlowProvider = new Provider(this, 'ConnectFlowProvider', {
            onEventHandler: this.connectFlowHandler,
            logRetention: 14, // days
        });
    }

    deployContactFlows() {
        if (!fs.existsSync(this.flowsPath)) {
            console.warn(`Flows directory not found: ${this.flowsPath}`);
            return;
        }

        const flowFiles = fs.readdirSync(this.flowsPath)
            .filter(file => file.endsWith('.json'));

        console.log(`Found ${flowFiles.length} flow files to deploy`);

        flowFiles.forEach(flowFile => {
            this.deployContactFlow(flowFile);
        });
    }

    deployContactFlow(flowFile) {
        const flowName = path.basename(flowFile, '.json');
        const flowPath = path.join(this.flowsPath, flowFile);

        if (!fs.existsSync(flowPath)) {
            throw new Error(`Flow file not found: ${flowPath}`);
        }

        const flowContent = fs.readJsonSync(flowPath);

        // Add deployment metadata
        const deploymentMetadata = {
            deployedAt: new Date().toISOString(),
            environment: this.environment,
            ...(this.releaseTag && { releaseTag: this.releaseTag }),
            ...(this.gitSha && { gitCommit: this.gitSha }),
        };

        // Merge metadata into flow content
        if (flowContent.metadata) {
            flowContent.metadata = { ...flowContent.metadata, ...deploymentMetadata };
        } else {
            flowContent.metadata = deploymentMetadata;
        }

        console.log(`Deploying contact flow: ${flowName}`);

        // Create custom resource for this flow
        const flowResource = new CustomResource(this, `ContactFlow-${flowName}`, {
            serviceToken: this.connectFlowProvider.serviceToken,
            properties: {
                FlowName: flowName,
                FlowContent: JSON.stringify(flowContent),
                InstanceId: this.envConfig.connect.instance_id,
                InstanceArn: this.envConfig.connect.instance_arn,
                Environment: this.environment,
                BlueGreenDeployment: this.blueGreenDeployment,
                LambdaArns: this.extractLambdaArns(flowContent),
                ReleaseTag: this.releaseTag || 'unknown',
                DeploymentMode: this.blueGreenDeployment ? 'blue-green' : 'direct',
            },
        });

        // Add dependencies and outputs
        flowResource.node.addMetadata('FlowFile', flowFile);
        flowResource.node.addMetadata('Environment', this.environment);
    }

    extractLambdaArns(flowContent) {
        const lambdaArns = [];
        const flowStr = JSON.stringify(flowContent);

        // Find all Lambda ARNs in the flow content
        const lambdaArnPattern = /arn:aws:lambda:[^"\\s]+/g;
        const matches = flowStr.match(lambdaArnPattern);

        if (matches) {
            matches.forEach(arn => {
                if (!lambdaArns.includes(arn)) {
                    lambdaArns.push(arn);
                }
            });
        }

        return lambdaArns;
    }

    getConnectFlowHandlerCode() {
        return `
const AWS = require('aws-sdk');
const connect = new AWS.Connect();
const lambda = new AWS.Lambda();

exports.handler = async (event) => {
  console.log('Event:', JSON.stringify(event, null, 2));
  
  const { RequestType, ResourceProperties } = event;
  const {
    FlowName,
    FlowContent,
    InstanceId,
    InstanceArn,
    Environment,
    BlueGreenDeployment,
    LambdaArns,
    ReleaseTag,
    DeploymentMode
  } = ResourceProperties;

  try {
    let physicalResourceId;
    let responseData = {};

    switch (RequestType) {
      case 'Create':
        physicalResourceId = await handleCreate(FlowName, FlowContent, InstanceId, InstanceArn, LambdaArns, ReleaseTag);
        responseData = { ContactFlowArn: physicalResourceId, FlowName };
        break;
        
      case 'Update':
        physicalResourceId = event.PhysicalResourceId;
        await handleUpdate(physicalResourceId, FlowName, FlowContent, InstanceId, LambdaArns, BlueGreenDeployment, ReleaseTag);
        responseData = { ContactFlowArn: physicalResourceId, FlowName };
        break;
        
      case 'Delete':
        if (!BlueGreenDeployment) {
          await handleDelete(event.PhysicalResourceId, InstanceId);
        }
        physicalResourceId = event.PhysicalResourceId;
        break;
    }

    return {
      Status: 'SUCCESS',
      PhysicalResourceId: physicalResourceId,
      Data: responseData
    };
  } catch (error) {
    console.error('Error:', error);
    return {
      Status: 'FAILED',
      PhysicalResourceId: event.PhysicalResourceId || 'failed',
      Reason: error.message
    };
  }
};

async function handleCreate(flowName, flowContent, instanceId, instanceArn, lambdaArns, releaseTag) {
  console.log(\`Creating contact flow: \${flowName}\`);
  
  // Setup Lambda permissions first
  await setupLambdaPermissions(lambdaArns, instanceArn);
  
  // Create contact flow with versioned name for Blue/Green
  const versionedName = \`\${flowName}-\${releaseTag || new Date().getTime()}\`;
  
  const params = {
    InstanceId: instanceId,
    Name: versionedName,
    Type: 'CONTACT_FLOW',
    Content: flowContent,
    Description: \`Deployed via CDK - Release: \${releaseTag || 'unknown'}\`,
    Tags: {
      Environment: process.env.ENVIRONMENT || 'unknown',
      DeployedBy: 'CDK',
      ReleaseTag: releaseTag || 'unknown',
      DeployedAt: new Date().toISOString()
    }
  };
  
  const result = await connect.createContactFlow(params).promise();
  console.log(\`Created contact flow: \${result.ContactFlowArn}\`);
  
  return result.ContactFlowArn;
}

async function handleUpdate(contactFlowArn, flowName, flowContent, instanceId, lambdaArns, blueGreenDeployment, releaseTag) {
  console.log(\`Updating contact flow: \${contactFlowArn}\`);
  
  // Setup Lambda permissions
  await setupLambdaPermissions(lambdaArns, \`arn:aws:connect:\${process.env.AWS_REGION}:\${process.env.AWS_ACCOUNT_ID}:instance/\${instanceId}\`);
  
  if (blueGreenDeployment) {
    // For Blue/Green, create new version instead of updating
    return await handleCreate(flowName, flowContent, instanceId, contactFlowArn.split('/')[0], lambdaArns, releaseTag);
  } else {
    // Direct update
    const contactFlowId = contactFlowArn.split('/').pop();
    
    const params = {
      InstanceId: instanceId,
      ContactFlowId: contactFlowId,
      Content: flowContent
    };
    
    await connect.updateContactFlowContent(params).promise();
    console.log(\`Updated contact flow content: \${contactFlowArn}\`);
  }
}

async function handleDelete(contactFlowArn, instanceId) {
  if (!contactFlowArn || contactFlowArn === 'failed') {
    console.log('No contact flow to delete');
    return;
  }
  
  console.log(\`Deleting contact flow: \${contactFlowArn}\`);
  
  // Note: In production, you might want to keep flows for audit purposes
  // This is just for development/testing environments
  
  try {
    const contactFlowId = contactFlowArn.split('/').pop();
    
    const params = {
      InstanceId: instanceId,
      ContactFlowId: contactFlowId
    };
    
    // Check if flow is in use before deleting
    const flowInfo = await connect.describeContactFlow({
      InstanceId: instanceId,
      ContactFlowId: contactFlowId
    }).promise();
    
    if (flowInfo.ContactFlow.State === 'ACTIVE') {
      console.log('Contact flow is active, not deleting');
      return;
    }
    
    // Proceed with deletion only if not active
    // await connect.deleteContactFlow(params).promise();
    console.log('Contact flow deletion skipped for safety');
    
  } catch (error) {
    console.log(\`Could not delete contact flow: \${error.message}\`);
    // Don't fail the stack deletion for this
  }
}

async function setupLambdaPermissions(lambdaArns, instanceArn) {
  for (const lambdaArn of lambdaArns) {
    try {
      console.log(\`Setting up permissions for Lambda: \${lambdaArn}\`);
      
      const functionName = lambdaArn.split(':')[6];
      const statementId = \`connect-invoke-\${Date.now()}\`;
      
      const params = {
        FunctionName: functionName,
        StatementId: statementId,
        Action: 'lambda:InvokeFunction',
        Principal: 'connect.amazonaws.com',
        SourceArn: instanceArn
      };
      
      await lambda.addPermission(params).promise();
      console.log(\`Added permission for Lambda: \${functionName}\`);
      
    } catch (error) {
      console.log(\`Permission setup failed for \${lambdaArn}: \${error.message}\`);
      // Continue with others even if one fails
    }
  }
}
    `;
    }
}

module.exports = { ConnectFlowStack };