#!/usr/bin/env node

/**
 * Contact Flow Template Renderer
 * Replaces tokens in templates with actual values from environment maps
 */

const fs = require('fs-extra');
const path = require('path');
const { Command } = require('commander');
const yaml = require('yaml');
const _ = require('lodash');

class TemplateRenderer {
    constructor(envConfig) {
        this.envConfig = envConfig;
        this.tokenPattern = /\$\{([^}]+)\}/g;
    }

    /**
     * Load environment configuration from YAML file
     * @param {string} envFile - Path to environment YAML file
     * @returns {Object} Environment configuration
     */
    static async loadEnvironmentConfig(envFile) {
        try {
            const yamlContent = await fs.readFile(envFile, 'utf8');
            return yaml.parse(yamlContent);
        } catch (error) {
            throw new Error(`Failed to load environment config from ${envFile}: ${error.message}`);
        }
    }

    /**
     * Render template by replacing tokens with actual values
     * @param {string} template - Template content
     * @returns {string} Rendered content
     */
    render(template) {
        const rendered = template.replace(this.tokenPattern, (match, tokenPath) => {
            const value = this.resolveToken(tokenPath);
            if (value === undefined || value === null) {
                throw new Error(`Token not found: ${tokenPath}`);
            }
            return value;
        });

        // Validate that all tokens were resolved
        const remainingTokens = rendered.match(this.tokenPattern);
        if (remainingTokens) {
            throw new Error(`Unresolved tokens found: ${remainingTokens.join(', ')}`);
        }

        return rendered;
    }

    /**
     * Resolve token path to actual value from environment config
     * @param {string} tokenPath - Token path (e.g., "Lambda.InvokeAlias")
     * @returns {*} Resolved value
     */
    resolveToken(tokenPath) {
        const pathParts = tokenPath.split('.');
        let value = this.envConfig.tokens;

        for (const part of pathParts) {
            if (value && typeof value === 'object' && part in value) {
                value = value[part];
            } else {
                return undefined;
            }
        }

        return value;
    }

    /**
     * Render template file and write output
     * @param {string} templateFile - Path to template file
     * @param {string} outputFile - Path to output file
     */
    async renderFile(templateFile, outputFile) {
        try {
            console.log(`Rendering: ${templateFile} -> ${outputFile}`);

            const templateContent = await fs.readFile(templateFile, 'utf8');
            const renderedContent = this.render(templateContent);

            // Ensure output directory exists
            await fs.ensureDir(path.dirname(outputFile));

            // Parse and reformat as JSON for validation
            const parsedJson = JSON.parse(renderedContent);
            await fs.writeJson(outputFile, parsedJson, { spaces: 2 });

            console.log(`✅ Successfully rendered: ${outputFile}`);
        } catch (error) {
            console.error(`❌ Failed to render ${templateFile}:`, error.message);
            throw error;
        }
    }

    /**
     * Validate rendered flow JSON
     * @param {Object} flowJson - Parsed flow JSON
     * @param {string} flowName - Flow name for error reporting
     */
    validateRenderedFlow(flowJson, flowName) {
        const errors = [];

        // Check required fields
        const requiredFields = ['name', 'type', 'content'];
        requiredFields.forEach(field => {
            if (!flowJson[field]) {
                errors.push(`Missing required field: ${field}`);
            }
        });

        // Check for unresolved tokens
        const jsonStr = JSON.stringify(flowJson);
        const unresolvedTokens = jsonStr.match(this.tokenPattern);
        if (unresolvedTokens) {
            errors.push(`Unresolved tokens: ${unresolvedTokens.join(', ')}`);
        }

        // Validate ARN formats
        this.validateArns(flowJson, errors);

        // Validate E.164 phone numbers
        this.validatePhoneNumbers(flowJson, errors);

        if (errors.length > 0) {
            throw new Error(`Validation failed for ${flowName}:\n- ${errors.join('\n- ')}`);
        }
    }

    /**
     * Validate ARN formats in the flow
     */
    validateArns(obj, errors, path = '') {
        if (typeof obj === 'string') {
            if (obj.includes(':arn:aws:')) {
                const arnPattern = /^arn:aws:[a-zA-Z0-9-]+:[a-zA-Z0-9-]*:\d{12}:[a-zA-Z0-9-\/]+$/;
                if (!arnPattern.test(obj)) {
                    errors.push(`Invalid ARN format at ${path}: ${obj}`);
                }
            }
        } else if (typeof obj === 'object' && obj !== null) {
            Object.entries(obj).forEach(([key, value]) => {
                this.validateArns(value, errors, path ? `${path}.${key}` : key);
            });
        }
    }

    /**
     * Validate E.164 phone number formats
     */
    validatePhoneNumbers(obj, errors, path = '') {
        if (typeof obj === 'string') {
            if (obj.startsWith('+')) {
                const e164Pattern = /^\+[1-9]\d{1,14}$/;
                if (!e164Pattern.test(obj)) {
                    errors.push(`Invalid E.164 phone number at ${path}: ${obj}`);
                }
            }
        } else if (typeof obj === 'object' && obj !== null) {
            Object.entries(obj).forEach(([key, value]) => {
                this.validatePhoneNumbers(value, errors, path ? `${path}.${key}` : key);
            });
        }
    }

    /**
     * Process all flow templates in a directory
     */
    async processFlowsDirectory(flowsDir, outputDir) {
        console.log(`Processing flows from ${flowsDir} to ${outputDir}`);

        if (!await fs.pathExists(flowsDir)) {
            throw new Error(`Flows directory not found: ${flowsDir}`);
        }

        await fs.ensureDir(outputDir);

        const entries = await fs.readdir(flowsDir, { withFileTypes: true });
        const results = [];

        for (const entry of entries) {
            if (entry.isDirectory()) {
                const flowDir = path.join(flowsDir, entry.name);
                const result = await this.processFlowDirectory(flowDir, outputDir, entry.name);
                results.push(result);
            }
        }

        return results;
    }

    /**
     * Process a single flow directory
     */
    async processFlowDirectory(flowDir, outputDir, flowName) {
        console.log(`Processing flow: ${flowName}`);

        const templateFile = path.join(flowDir, 'flow.json.tmpl');
        const outputFile = path.join(outputDir, `${flowName}.json`);

        if (!await fs.pathExists(templateFile)) {
            console.warn(`⚠️  Template not found: ${templateFile}`);
            return { flowName, status: 'skipped', reason: 'No template file' };
        }

        try {
            await this.renderFile(templateFile, outputFile);

            // Validate rendered flow
            const renderedJson = await fs.readJson(outputFile);
            this.validateRenderedFlow(renderedJson, flowName);

            // Process modules if they exist
            const modulesDir = path.join(flowDir, 'modules');
            if (await fs.pathExists(modulesDir)) {
                await this.processModulesDirectory(modulesDir, outputDir, flowName);
            }

            return { flowName, status: 'success', outputFile };
        } catch (error) {
            return { flowName, status: 'error', error: error.message };
        }
    }

    /**
     * Process flow modules
     */
    async processModulesDirectory(modulesDir, outputDir, flowName) {
        const moduleFiles = await fs.readdir(modulesDir);
        const moduleOutputDir = path.join(outputDir, 'modules', flowName);
        await fs.ensureDir(moduleOutputDir);

        for (const moduleFile of moduleFiles) {
            if (moduleFile.endsWith('.tmpl')) {
                const moduleTemplatePath = path.join(modulesDir, moduleFile);
                const moduleName = path.basename(moduleFile, '.tmpl');
                const moduleOutputPath = path.join(moduleOutputDir, `${moduleName}.json`);

                await this.renderFile(moduleTemplatePath, moduleOutputPath);
            }
        }
    }
}

// CLI Interface
const program = new Command();

program
    .name('render')
    .description('Render Contact Flow templates with environment-specific values')
    .requiredOption('-e, --env <environment>', 'Environment (dev|test|prod)')
    .option('-o, --output <directory>', 'Output directory', './dist')
    .option('-f, --flows <directory>', 'Flows directory', './flows')
    .option('-c, --config <file>', 'Environment config file (auto-detected if not provided)')
    .option('-v, --verbose', 'Verbose output');

async function main(options) {
    try {
        // Determine config file path
        const configFile = options.config || path.join('./env', `${options.env}.yaml`);

        if (!await fs.pathExists(configFile)) {
            throw new Error(`Environment config file not found: ${configFile}`);
        }

        // Load environment configuration
        console.log(`Loading environment config: ${configFile}`);
        const envConfig = await TemplateRenderer.loadEnvironmentConfig(configFile);

        // Create renderer
        const renderer = new TemplateRenderer(envConfig);

        // Set up output directory
        const outputDir = path.join(options.output, options.env);

        // Process flows
        console.log(`Rendering flows for environment: ${options.env}`);
        const results = await renderer.processFlowsDirectory(options.flows, outputDir);

        // Report results
        const successful = results.filter(r => r.status === 'success');
        const failed = results.filter(r => r.status === 'error');
        const skipped = results.filter(r => r.status === 'skipped');

        console.log('\\n📊 Rendering Results:');
        console.log(`✅ Successful: ${successful.length}`);
        console.log(`❌ Failed: ${failed.length}`);
        console.log(`⚠️  Skipped: ${skipped.length}`);

        if (failed.length > 0) {
            console.log('\\n❌ Failed flows:');
            failed.forEach(result => {
                console.log(`  - ${result.flowName}: ${result.error}`);
            });
            process.exit(1);
        }

        console.log(`\\n🎉 All flows rendered successfully to: ${outputDir}`);

    } catch (error) {
        console.error('Rendering failed:', error.message);
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
}

module.exports = { TemplateRenderer };