const { FlowValidator } = require('../scripts/validate');
const { TemplateRenderer } = require('../scripts/render');
const { FlowNormalizer } = require('../scripts/normalize');

describe('Basic Functionality Tests', () => {

    test('FlowNormalizer should be importable', () => {
        expect(FlowNormalizer).toBeDefined();
        const normalizer = new FlowNormalizer();
        expect(normalizer).toBeInstanceOf(FlowNormalizer);
    });

    test('TemplateRenderer should be importable', () => {
        expect(TemplateRenderer).toBeDefined();
        const config = { tokens: {} };
        const renderer = new TemplateRenderer(config);
        expect(renderer).toBeInstanceOf(TemplateRenderer);
    });

    test('FlowValidator should be importable', () => {
        expect(FlowValidator).toBeDefined();
        const validator = new FlowValidator();
        expect(validator).toBeInstanceOf(FlowValidator);
    });

    test('Template rendering with simple token', () => {
        const config = {
            tokens: {
                Test: {
                    Value: 'hello-world'
                }
            }
        };

        const renderer = new TemplateRenderer(config);
        const template = '{"message": "${Test.Value}"}';
        const result = renderer.render(template);

        expect(result).toBe('{"message": "hello-world"}');
    });

    test('Flow normalization basic test', () => {
        const normalizer = new FlowNormalizer();
        const flow = {
            name: 'TestFlow',
            lastModifiedTime: 12345,
            createdBy: 'test-user',
            content: {
                x: 123,
                y: 456
            }
        };

        const normalized = normalizer.normalize(flow);

        // Check noise removal
        expect(normalized.lastModifiedTime).toBeUndefined();
        expect(normalized.createdBy).toBeUndefined();

        // Check coordinate normalization
        expect(normalized.content.x).toBe(120);
        expect(normalized.content.y).toBe(460);
    });
});