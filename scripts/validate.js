#!/usr/bin/env node

/**
 * Contact Flow Validation Script
 * Performs comprehensive validation of flow templates and configurations
 */

const fs = require('fs-extra');
const path = require('path');
const { Command } = require('commander');
const yaml = require('yaml');
const Joi = require('joi');

class FlowValidator {
    constructor() {
        this.errors = [];
        this.warnings = [];
    }

    /**
     * Validate all flows and configurations
     */
    async validateAll(flowsDir, envDir) {
        console.log('🔍 Starting comprehensive validation...');

        // Validate environment configurations
        await this.validateEnvironmentConfigs(envDir);

        // Validate flow templates
        await this.validateFlowTemplates(flowsDir);

        // Validate token completeness
        await this.validateTokenCompleteness(flowsDir, envDir);

        // Report results
        this.reportResults();

        return this.errors.length === 0;
    }

    /**
     * Validate environment configuration files
     */
    async validateEnvironmentConfigs(envDir) {
        console.log('Validating environment configurations...');

        const envFiles = ['dev.yaml', 'test.yaml', 'prod.yaml'];

        for (const envFile of envFiles) {
            const envPath = path.join(envDir, envFile);
            if (await fs.pathExists(envPath)) {
                await this.validateEnvironmentConfig(envPath);
            } else {
                this.addError(`Environment file not found: ${envFile}`);
            }
        }
    }

    /**
     * Validate a single environment configuration file
     */
    async validateEnvironmentConfig(envPath) {
        try {
            const yamlContent = await fs.readFile(envPath, 'utf8');
            const config = yaml.parse(yamlContent);

            // Define schema for environment configuration
            const envSchema = Joi.object({
                connect: Joi.object({
                    instance_id: Joi.string().uuid().required(),
                    instance_arn: Joi.string().pattern(/^arn:aws:connect:/).required(),
                    region: Joi.string().required()
                }).required(),

                tokens: Joi.object({
                    Lambda: Joi.object().pattern(
                        Joi.string(),
                        Joi.string().pattern(/^arn:aws:lambda:/)
                    ),
                    Queue: Joi.object().pattern(
                        Joi.string(),
                        Joi.string().pattern(/^arn:aws:connect:/)
                    ),
                    Prompt: Joi.object().pattern(
                        Joi.string(),
                        Joi.string().pattern(/^arn:aws:connect:/)
                    ),
                    Lex: Joi.object().pattern(
                        Joi.string(),
                        Joi.string().pattern(/^arn:aws:connect:/)
                    ),
                    PhoneNumber: Joi.object().pattern(
                        Joi.string(),
                        Joi.string().pattern(/^\+[1-9]\d{1,14}$/)
                    )
                }).required(),

                integration: Joi.object({
                    lambda_timeout: Joi.number().min(1).max(900),
                    lex_timeout: Joi.number().min(1).max(300),
                    queue_timeout: Joi.number().min(1).max(43200)
                }),

                monitoring: Joi.object({
                    cloudwatch_log_group: Joi.string(),
                    metrics_namespace: Joi.string(),
                    alert_sns_topic: Joi.string().pattern(/^arn:aws:sns:/)
                }),

                deployment: Joi.object({
                    rollback_enabled: Joi.boolean(),
                    health_check_duration: Joi.number().min(60),
                    canary_percentage: Joi.number().min(1).max(100),
                    full_deployment_delay: Joi.number().min(0)
                })
            });

            // Validate against schema
            const { error } = envSchema.validate(config, { allowUnknown: true });
            if (error) {
                this.addError(`Invalid environment config ${envPath}: ${error.message}`);
                return;
            }

            // Additional validations
            this.validateConsistentRegion(config, envPath);
            this.validateInstanceConsistency(config, envPath);

            console.log(`✅ Environment config valid: ${path.basename(envPath)}`);

        } catch (error) {
            this.addError(`Failed to validate environment config ${envPath}: ${error.message}`);
        }
    }

    /**
     * Validate that all ARNs use consistent region
     */
    validateConsistentRegion(config, envPath) {
        const region = config.connect.region;
        const arnRegex = /arn:aws:[^:]+:([^:]*)/;

        const checkArn = (arn, context) => {
            const match = arn.match(arnRegex);
            if (match && match[1] && match[1] !== region) {
                this.addWarning(`ARN region mismatch in ${envPath} (${context}): expected ${region}, got ${match[1]}`);
            }
        };

        // Check all ARNs in tokens
        if (config.tokens) {
            Object.entries(config.tokens).forEach(([tokenType, tokens]) => {
                if (typeof tokens === 'object') {
                    Object.entries(tokens).forEach(([tokenName, arn]) => {
                        if (typeof arn === 'string' && arn.startsWith('arn:aws:')) {
                            checkArn(arn, `${tokenType}.${tokenName}`);
                        }
                    });
                }
            });
        }
    }

    /**
     * Validate instance ID consistency across Connect ARNs
     */
    validateInstanceConsistency(config, envPath) {
        const instanceId = config.connect.instance_id;

        const checkConnectArn = (arn, context) => {
            if (arn.includes('/instance/') && !arn.includes(`/instance/${instanceId}`)) {
                this.addError(`Instance ID mismatch in ${envPath} (${context}): ARN doesn't match configured instance ID`);
            }
        };

        // Check Connect ARNs
        if (config.tokens) {
            ['Queue', 'Prompt', 'Lex'].forEach(tokenType => {
                if (config.tokens[tokenType]) {
                    Object.entries(config.tokens[tokenType]).forEach(([tokenName, arn]) => {
                        if (typeof arn === 'string' && arn.includes('arn:aws:connect:')) {
                            checkConnectArn(arn, `${tokenType}.${tokenName}`);
                        }
                    });
                }
            });
        }
    }

    /**
     * Validate flow template files
     */
    async validateFlowTemplates(flowsDir) {
        console.log('Validating flow templates...');

        if (!await fs.pathExists(flowsDir)) {
            this.addError(`Flows directory not found: ${flowsDir}`);
            return;
        }

        const entries = await fs.readdir(flowsDir, { withFileTypes: true });

        for (const entry of entries) {
            if (entry.isDirectory()) {
                await this.validateFlowDirectory(path.join(flowsDir, entry.name), entry.name);
            }
        }
    }

    /**
     * Validate a single flow directory
     */
    async validateFlowDirectory(flowDir, flowName) {
        const templateFile = path.join(flowDir, 'flow.json.tmpl');

        if (!await fs.pathExists(templateFile)) {
            this.addError(`Flow template not found: ${flowName}/flow.json.tmpl`);
            return;
        }

        try {
            // Validate template file is valid JSON
            const templateContent = await fs.readFile(templateFile, 'utf8');

            // Check if it can be parsed (with tokens, so may fail - that's ok)
            try {
                JSON.parse(templateContent);
            } catch (parseError) {
                // If it fails due to tokens, that's expected
                if (!templateContent.includes('${')) {
                    this.addError(`Invalid JSON in flow template ${flowName}: ${parseError.message}`);
                    return;
                }
            }

            // Validate token usage
            this.validateTokenUsage(templateContent, flowName);

            // Validate flow structure
            await this.validateFlowStructure(templateContent, flowName);

            console.log(`✅ Flow template valid: ${flowName}`);

        } catch (error) {
            this.addError(`Failed to validate flow template ${flowName}: ${error.message}`);
        }
    }

    /**
     * Validate token usage in template
     */
    validateTokenUsage(templateContent, flowName) {
        const tokenPattern = /\\$\\{([^}]+)\\}/g;
        const tokens = [];
        let match;

        while ((match = tokenPattern.exec(templateContent)) !== null) {
            tokens.push(match[1]);
        }

        // Check for valid token format
        tokens.forEach(token => {
            const parts = token.split('.');
            if (parts.length < 2) {
                this.addError(`Invalid token format in ${flowName}: \${${token}} (should be \${Service.Entity})`);
            }

            const [service, entity] = parts;
            const validServices = ['Lambda', 'Queue', 'Prompt', 'Lex', 'PhoneNumber'];
            if (!validServices.includes(service)) {
                this.addWarning(`Unknown service in token ${flowName}: ${service}`);
            }
        });
    }

    /**
     * Validate flow structure (basic checks)
     */
    async validateFlowStructure(templateContent, flowName) {
        // Check for required flow elements
        const requiredElements = ['StartFlowExecution', 'DisconnectParticipant'];

        requiredElements.forEach(element => {
            if (!templateContent.includes(element)) {
                this.addWarning(`Flow ${flowName} may be missing ${element} block`);
            }
        });

        // Check for potential issues
        if (templateContent.includes('DisconnectParticipant') &&
            templateContent.indexOf('DisconnectParticipant') < 100) {
            this.addWarning(`Flow ${flowName} may disconnect too early`);
        }
    }

    /**
     * Validate that all tokens used in templates are defined in environment configs
     */
    async validateTokenCompleteness(flowsDir, envDir) {
        console.log('Validating token completeness...');

        // Collect all tokens used in templates
        const usedTokens = await this.collectUsedTokens(flowsDir);

        // Check each environment
        const envFiles = ['dev.yaml', 'test.yaml', 'prod.yaml'];

        for (const envFile of envFiles) {
            const envPath = path.join(envDir, envFile);
            if (await fs.pathExists(envPath)) {
                await this.validateTokensInEnvironment(envPath, usedTokens, envFile);
            }
        }
    }

    /**
     * Collect all tokens used across all flow templates
     */
    async collectUsedTokens(flowsDir) {
        const tokens = new Set();
        const tokenPattern = /\\$\\{([^}]+)\\}/g;

        const entries = await fs.readdir(flowsDir, { withFileTypes: true });

        for (const entry of entries) {
            if (entry.isDirectory()) {
                const flowDir = path.join(flowsDir, entry.name);
                const templateFile = path.join(flowDir, 'flow.json.tmpl');

                if (await fs.pathExists(templateFile)) {
                    const content = await fs.readFile(templateFile, 'utf8');
                    let match;
                    while ((match = tokenPattern.exec(content)) !== null) {
                        tokens.add(match[1]);
                    }
                }
            }
        }

        return Array.from(tokens);
    }

    /**
     * Validate that all used tokens are defined in environment
     */
    async validateTokensInEnvironment(envPath, usedTokens, envFile) {
        try {
            const yamlContent = await fs.readFile(envPath, 'utf8');
            const config = yaml.parse(yamlContent);

            const definedTokens = this.flattenTokens(config.tokens || {});

            usedTokens.forEach(token => {
                if (!definedTokens.includes(token)) {
                    this.addError(`Token \${${token}} used in templates but not defined in ${envFile}`);
                }
            });

        } catch (error) {
            this.addError(`Failed to validate tokens in ${envFile}: ${error.message}`);
        }
    }

    /**
     * Flatten token object to dot notation array
     */
    flattenTokens(tokens, prefix = '') {
        const result = [];

        Object.entries(tokens).forEach(([key, value]) => {
            const fullKey = prefix ? `${prefix}.${key}` : key;

            if (typeof value === 'object' && value !== null) {
                result.push(...this.flattenTokens(value, fullKey));
            } else {
                result.push(fullKey);
            }
        });

        return result;
    }

    /**
     * Add error to the list
     */
    addError(message) {
        this.errors.push(message);
        console.log(`❌ ERROR: ${message}`);
    }

    /**
     * Add warning to the list
     */
    addWarning(message) {
        this.warnings.push(message);
        console.log(`⚠️  WARNING: ${message}`);
    }

    /**
     * Report validation results
     */
    reportResults() {
        console.log('\\n📊 Validation Results:');
        console.log(`❌ Errors: ${this.errors.length}`);
        console.log(`⚠️  Warnings: ${this.warnings.length}`);

        if (this.errors.length === 0) {
            console.log('\\n🎉 All validations passed!');
        } else {
            console.log('\\n💥 Validation failed. Please fix the errors above.');
        }
    }
}

// CLI Interface
const program = new Command();

program
    .name('validate')
    .description('Validate Contact Flow templates and configurations')
    .option('-f, --flows <directory>', 'Flows directory', './flows')
    .option('-e, --env <directory>', 'Environment configs directory', './env')
    .option('-v, --verbose', 'Verbose output');

async function main(options) {
    try {
        const validator = new FlowValidator();
        const isValid = await validator.validateAll(options.flows, options.env);

        if (!isValid) {
            process.exit(1);
        }

    } catch (error) {
        console.error('Validation failed:', error.message);
        if (options.verbose) {
            console.error(error.stack);
        }
        process.exit(1);
    }
}

if (require.main === module) {
    program.parse();
    const options = program.opts();
    main(options);
} module.exports = { FlowValidator };