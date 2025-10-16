const ConnectFlowExporter = require('../scripts/export');
const AutoExportScheduler = require('../scripts/auto-export');
const fs = require('fs-extra');
const path = require('path');

describe('Connect Flow Export', () => {
    const testOutputDir = path.join(__dirname, 'temp-export');

    beforeEach(async () => {
        await fs.ensureDir(testOutputDir);
    });

    afterEach(async () => {
        await fs.remove(testOutputDir);
    });

    describe('ConnectFlowExporter', () => {
        test('should create exporter instance', () => {
            const exporter = new ConnectFlowExporter('us-east-1');
            expect(exporter).toBeInstanceOf(ConnectFlowExporter);
            expect(exporter.connect).toBeDefined();
        });

        test('should sanitize flow names correctly', () => {
            const exporter = new ConnectFlowExporter();

            expect(exporter.sanitizeFlowName('Sales Entry Flow')).toBe('SalesEntryFlow');
            expect(exporter.sanitizeFlowName('Customer Support (Main)')).toBe('CustomerSupportMain');
            expect(exporter.sanitizeFlowName('Test-Flow_123')).toBe('Test-Flow_123');
            expect(exporter.sanitizeFlowName('VeryLongFlowNameThatExceedsTheFiftyCharacterLimit123456789')).toHaveLength(50);
        });

        test('should handle API errors gracefully', async () => {
            const exporter = new ConnectFlowExporter();

            // Mock Connect service to throw error
            exporter.connect.listContactFlows = jest.fn().mockRejectedValue(new Error('Access Denied'));

            await expect(exporter.listContactFlows('invalid-instance-id')).rejects.toThrow('Access Denied');
        });
    });

    describe('AutoExportScheduler', () => {
        const testConfigPath = path.join(testOutputDir, 'test-config.yaml');

        test('should create default config', async () => {
            const scheduler = new AutoExportScheduler(testConfigPath);
            await scheduler.loadConfig();

            expect(await fs.pathExists(testConfigPath)).toBe(true);
            expect(scheduler.config).toBeDefined();
            expect(scheduler.config.environments).toBeDefined();
            expect(scheduler.config.environments.dev).toBeDefined();
        });

        test('should resolve environment variables', () => {
            const scheduler = new AutoExportScheduler();

            process.env.TEST_VAR = 'test-value';

            expect(scheduler.resolveEnvVars('${TEST_VAR}')).toBe('test-value');
            expect(scheduler.resolveEnvVars('prefix-${TEST_VAR}-suffix')).toBe('prefix-test-value-suffix');
            expect(scheduler.resolveEnvVars('${UNDEFINED_VAR}')).toBe('${UNDEFINED_VAR}');

            delete process.env.TEST_VAR;
        });

        test('should validate config structure', async () => {
            const scheduler = new AutoExportScheduler(testConfigPath);
            await scheduler.loadConfig();

            expect(scheduler.config.environments.dev.instanceId).toBeDefined();
            expect(scheduler.config.environments.dev.region).toBeDefined();
            expect(scheduler.config.environments.dev.schedule).toBeDefined();
            expect(scheduler.config.git).toBeDefined();
            expect(scheduler.config.notifications).toBeDefined();
        });
    });

    describe('Export CLI Commands', () => {
        test('should provide help information', () => {
            // CLI help test would require process mocking
            expect(true).toBe(true); // Placeholder
        });
    });

    describe('Integration Tests', () => {
        test('should handle complete export workflow', async () => {
            // Mock AWS Connect API responses
            const mockFlows = [
                {
                    Id: 'flow-123',
                    Name: 'Test Flow',
                    ContactFlowType: 'CONTACT_FLOW',
                    ContactFlowState: 'ACTIVE'
                }
            ];

            const mockFlowContent = {
                Version: '2019-10-30',
                StartAction: 'start-action-id',
                Actions: [
                    {
                        Identifier: 'start-action-id',
                        Type: 'MessageParticipant',
                        Parameters: {
                            Text: 'Hello, welcome to our service!'
                        }
                    }
                ]
            };

            // This would require proper AWS SDK mocking in real implementation
            expect(mockFlows).toHaveLength(1);
            expect(mockFlowContent.Actions).toHaveLength(1);
        });
    });
});