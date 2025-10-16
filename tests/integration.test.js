const { FlowValidator } = require('../scripts/validate');
const { TemplateRenderer } = require('../scripts/render');
const { FlowNormalizer } = require('../scripts/normalize');
const fs = require('fs-extra');
const path = require('path');

describe('Contact Flow CI/CD System', () => {
    const testFlowsDir = path.join(__dirname, 'fixtures', 'flows');
    const testEnvDir = path.join(__dirname, 'fixtures', 'env');
    const testOutputDir = path.join(__dirname, 'output');

    beforeAll(async () => {
        // Setup test fixtures
        await setupTestFixtures();
    });

    afterAll(async () => {
        // Cleanup
        await fs.remove(testOutputDir);
    });

    describe('Flow Normalization', () => {
        test('should normalize flow JSON and remove noise', async () => {
            const normalizer = new FlowNormalizer();
            const rawFlow = {
                name: 'TestFlow',
                lastModifiedTime: 1634567890,
                createdBy: 'user@example.com',
                version: '1.2.3',
                content: {
                    actions: [
                        {
                            id: '12345678-1234-1234-1234-123456789012',
                            x: 123,
                            y: 456,
                            type: 'MessageParticipant'
                        }
                    ]
                }
            };

            const normalized = normalizer.normalize(rawFlow);

            // Check that noise is removed
            expect(normalized.lastModifiedTime).toBeUndefined();
            expect(normalized.createdBy).toBeUndefined();
            expect(normalized.version).toBeUndefined();

            // Check that coordinates are normalized
            expect(normalized.content.actions[0].x).toBe(120);
            expect(normalized.content.actions[0].y).toBe(460);
        });
    });

    describe('Template Rendering', () => {
        test('should render templates with environment tokens', async () => {
            const envConfig = {
                tokens: {
                    Lambda: {
                        AuthenticationAlias: 'arn:aws:lambda:us-east-1:123456789012:function:auth:LIVE'
                    },
                    Queue: {
                        Sales: 'arn:aws:connect:us-east-1:123456789012:instance/xxx/queue/yyy'
                    }
                }
            };

            const renderer = new TemplateRenderer(envConfig);
            const template = JSON.stringify({
                lambdaArn: '${Lambda.AuthenticationAlias}',
                queueArn: '${Queue.Sales}'
            });

            const rendered = renderer.render(template);
            const parsedResult = JSON.parse(rendered);

            expect(parsedResult.lambdaArn).toBe('arn:aws:lambda:us-east-1:123456789012:function:auth:LIVE');
            expect(parsedResult.queueArn).toBe('arn:aws:connect:us-east-1:123456789012:instance/xxx/queue/yyy');
        });

        test('should fail on unresolved tokens', async () => {
            const envConfig = { tokens: {} };
            const renderer = new TemplateRenderer(envConfig);
            const template = '{ "test": "${NonExistent.Token}" }';

            expect(() => {
                renderer.render(template);
            }).toThrow('Token not found: NonExistent.Token');
        });

        test('should validate ARN formats', async () => {
            const envConfig = {
                tokens: {
                    Lambda: {
                        BadArn: 'invalid-arn-format'
                    }
                }
            };

            const renderer = new TemplateRenderer(envConfig);
            const flowJson = {
                name: 'TestFlow',
                type: 'CONTACT_FLOW',
                content: {
                    lambdaArn: 'arn:aws:lambda:invalid-format'
                }
            };

            expect(() => {
                renderer.validateRenderedFlow(flowJson, 'TestFlow');
            }).toThrow();
        });
    });

    describe('Flow Validation', () => {
        test('should validate environment configuration schema', async () => {
            const validator = new FlowValidator();

            // Valid config
            const validConfig = {
                connect: {
                    instance_id: '12345678-1234-1234-1234-123456789012',
                    instance_arn: 'arn:aws:connect:us-east-1:123456789012:instance/12345678-1234-1234-1234-123456789012',
                    region: 'us-east-1'
                },
                tokens: {
                    Lambda: {
                        AuthAlias: 'arn:aws:lambda:us-east-1:123456789012:function:auth:LIVE'
                    }
                }
            };

            // This would normally validate against file, but we're testing the logic
            validator.validateConsistentRegion(validConfig, 'test.yaml');
            expect(validator.warnings.length).toBe(0);
        });

        test('should detect token usage in templates', async () => {
            const validator = new FlowValidator();
            const templateContent = JSON.stringify({
                lambda: '${Lambda.AuthAlias}',
                queue: '${Queue.Sales}',
                invalidToken: '${InvalidFormat}'
            });

            validator.validateTokenUsage(templateContent, 'TestFlow');

            // Debug: log all messages
            console.log('Errors:', validator.errors);
            console.log('Warnings:', validator.warnings);

            // Check that tokens were found and processed
            expect(validator.errors.length + validator.warnings.length).toBeGreaterThan(0);
        });
    });

    describe('Integration Tests', () => {
        test('should complete full flow processing pipeline', async () => {
            // 1. Create a test flow template
            const flowTemplate = {
                name: 'IntegrationTestFlow',
                type: 'CONTACT_FLOW',
                content: {
                    actions: [
                        {
                            type: 'InvokeLambdaFunction',
                            parameters: {
                                lambdaArn: '${Lambda.TestAlias}'
                            }
                        },
                        {
                            type: 'TransferParticipantToQueue',
                            parameters: {
                                queueId: '${Queue.TestQueue}'
                            }
                        }
                    ]
                }
            };

            // 2. Create environment config
            const envConfig = {
                connect: {
                    instance_id: '12345678-1234-1234-1234-123456789012',
                    instance_arn: 'arn:aws:connect:us-east-1:123456789012:instance/12345678-1234-1234-1234-123456789012',
                    region: 'us-east-1'
                },
                tokens: {
                    Lambda: {
                        TestAlias: 'arn:aws:lambda:us-east-1:123456789012:function:test:LIVE'
                    },
                    Queue: {
                        TestQueue: 'arn:aws:connect:us-east-1:123456789012:instance/12345678-1234-1234-1234-123456789012/queue/test-queue-id'
                    }
                }
            };

            // 3. Normalize
            const normalizer = new FlowNormalizer();
            const normalized = normalizer.normalize(flowTemplate);

            // 4. Render
            const renderer = new TemplateRenderer(envConfig);
            const templateStr = JSON.stringify(normalized);
            const rendered = renderer.render(templateStr);
            const renderedFlow = JSON.parse(rendered);

            // 5. Validate
            renderer.validateRenderedFlow(renderedFlow, 'IntegrationTestFlow');

            // 6. Check final result
            expect(renderedFlow.name).toBe('IntegrationTestFlow');
            expect(renderedFlow.content.actions[0].parameters.lambdaArn)
                .toBe('arn:aws:lambda:us-east-1:123456789012:function:test:LIVE');
            expect(renderedFlow.content.actions[1].parameters.queueId)
                .toBe('arn:aws:connect:us-east-1:123456789012:instance/12345678-1234-1234-1234-123456789012/queue/test-queue-id');
        });
    });

    async function setupTestFixtures() {
        // Create test directories
        await fs.ensureDir(testFlowsDir);
        await fs.ensureDir(testEnvDir);
        await fs.ensureDir(testOutputDir);

        // Create sample test flow
        const testFlowDir = path.join(testFlowsDir, 'TestFlow');
        await fs.ensureDir(testFlowDir);

        const sampleFlow = {
            name: 'TestFlow',
            type: 'CONTACT_FLOW',
            content: {
                actions: [
                    {
                        type: 'MessageParticipant',
                        parameters: {
                            text: 'Hello from ${Queue.TestQueue}'
                        }
                    }
                ]
            }
        };

        await fs.writeJson(path.join(testFlowDir, 'flow.json.tmpl'), sampleFlow, { spaces: 2 });

        // Create sample environment config
        const sampleEnvConfig = {
            connect: {
                instance_id: '12345678-1234-1234-1234-123456789012',
                instance_arn: 'arn:aws:connect:us-east-1:123456789012:instance/12345678-1234-1234-1234-123456789012',
                region: 'us-east-1'
            },
            tokens: {
                Queue: {
                    TestQueue: 'arn:aws:connect:us-east-1:123456789012:instance/12345678-1234-1234-1234-123456789012/queue/test'
                }
            }
        };

        const yaml = require('yaml');
        await fs.writeFile(
            path.join(testEnvDir, 'test.yaml'),
            yaml.stringify(sampleEnvConfig)
        );
    }
});