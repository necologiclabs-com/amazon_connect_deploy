// Global test setup
global.console = {
    ...console,
    // Suppress console output during tests unless needed
    log: jest.fn(),
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
};

// Mock AWS SDK for tests
jest.mock('aws-sdk', () => ({
    Connect: jest.fn().mockImplementation(() => ({
        createContactFlow: jest.fn().mockReturnValue({
            promise: () => Promise.resolve({
                ContactFlowArn: 'arn:aws:connect:us-east-1:123456789012:instance/test/contact-flow/test-flow'
            })
        }),
        updateContactFlowContent: jest.fn().mockReturnValue({
            promise: () => Promise.resolve({})
        }),
        describeContactFlow: jest.fn().mockReturnValue({
            promise: () => Promise.resolve({
                ContactFlow: {
                    State: 'ACTIVE'
                }
            })
        })
    })),
    Lambda: jest.fn().mockImplementation(() => ({
        addPermission: jest.fn().mockReturnValue({
            promise: () => Promise.resolve({})
        }),
        removePermission: jest.fn().mockReturnValue({
            promise: () => Promise.resolve({})
        })
    }))
}));

// Set test environment variables
process.env.NODE_ENV = 'test';
process.env.AWS_REGION = 'us-east-1';
process.env.CDK_DEFAULT_REGION = 'us-east-1';
process.env.CDK_DEFAULT_ACCOUNT = '123456789012';