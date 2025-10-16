#!/usr/bin/env node

/**
 * Contact Flow Normalization Script
 * Removes noise from exported Contact Flow JSON to make diffs readable
 */

const fs = require('fs-extra');
const path = require('path');
const { Command } = require('commander');
const yaml = require('yaml');

class FlowNormalizer {
    constructor() {
        this.noisePatterns = [
            // Remove timestamps and editor metadata
            /("lastModifiedTime":\s*\d+)/g,
            /("createdTime":\s*\d+)/g,
            /("lastModifiedBy":\s*"[^"]*")/g,
            /("createdBy":\s*"[^"]*")/g,

            // Normalize coordinates (round to nearest 10)
            /("x":\s*)(\d+)/g,
            /("y":\s*)(\d+)/g,

            // Remove volatile GUIDs that change between exports
            /("id":\s*"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")/g,
        ];
    }

    /**
     * Normalize contact flow JSON by removing noise and formatting consistently
     * @param {Object} flowJson - The contact flow JSON object
     * @returns {Object} Normalized flow JSON
     */
    normalize(flowJson) {
        // Create deep copy to avoid modifying original
        const normalized = JSON.parse(JSON.stringify(flowJson));

        // Remove metadata noise
        this.removeMetadataNoise(normalized);

        // Normalize coordinates
        this.normalizeCoordinates(normalized);

        // Sort objects for consistent ordering
        this.sortObjects(normalized);

        // Remove empty arrays and null values
        this.removeEmptyValues(normalized);

        return normalized;
    }

    /**
     * Remove metadata that creates unnecessary diffs
     */
    removeMetadataNoise(flowJson) {
        const fieldsToRemove = [
            'lastModifiedTime',
            'createdTime',
            'lastModifiedBy',
            'createdBy',
            'version'  // Version is managed by our system
        ];

        const removeFields = (obj) => {
            if (typeof obj === 'object' && obj !== null) {
                fieldsToRemove.forEach(field => {
                    delete obj[field];
                });

                Object.values(obj).forEach(value => {
                    if (typeof value === 'object') {
                        removeFields(value);
                    }
                });
            }
        };

        removeFields(flowJson);
    }

    /**
     * Normalize coordinates to reduce diff noise from slight movements
     */
    normalizeCoordinates(flowJson) {
        const normalizeCoord = (coord) => {
            if (typeof coord === 'number') {
                return Math.round(coord / 10) * 10;
            }
            return coord;
        };

        const processCoordinates = (obj) => {
            if (typeof obj === 'object' && obj !== null) {
                if ('x' in obj) obj.x = normalizeCoord(obj.x);
                if ('y' in obj) obj.y = normalizeCoord(obj.y);

                Object.values(obj).forEach(value => {
                    if (typeof value === 'object') {
                        processCoordinates(value);
                    }
                });
            }
        };

        processCoordinates(flowJson);
    }

    /**
     * Sort objects for consistent output
     */
    sortObjects(flowJson) {
        const sortObjectKeys = (obj) => {
            if (Array.isArray(obj)) {
                return obj.map(sortObjectKeys);
            } else if (typeof obj === 'object' && obj !== null) {
                const sorted = {};
                Object.keys(obj).sort().forEach(key => {
                    sorted[key] = sortObjectKeys(obj[key]);
                });
                return sorted;
            }
            return obj;
        };

        Object.keys(flowJson).sort().forEach(key => {
            const sorted = sortObjectKeys(flowJson[key]);
            delete flowJson[key];
            flowJson[key] = sorted;
        });
    }

    /**
     * Remove empty arrays and null values to clean output
     */
    removeEmptyValues(flowJson) {
        const cleanObject = (obj) => {
            if (Array.isArray(obj)) {
                return obj
                    .map(cleanObject)
                    .filter(item => item !== null && item !== undefined);
            } else if (typeof obj === 'object' && obj !== null) {
                const cleaned = {};
                Object.entries(obj).forEach(([key, value]) => {
                    const cleanedValue = cleanObject(value);
                    if (cleanedValue !== null &&
                        cleanedValue !== undefined &&
                        !(Array.isArray(cleanedValue) && cleanedValue.length === 0)) {
                        cleaned[key] = cleanedValue;
                    }
                });
                return cleaned;
            }
            return obj;
        };

        Object.keys(flowJson).forEach(key => {
            flowJson[key] = cleanObject(flowJson[key]);
        });
    }

    /**
     * Process all flow files in the flows directory
     */
    async processFlowsDirectory(flowsDir) {
        console.log(`Processing flows in directory: ${flowsDir}`);

        if (!await fs.pathExists(flowsDir)) {
            console.log('Flows directory does not exist. Skipping normalization.');
            return;
        }

        const entries = await fs.readdir(flowsDir, { withFileTypes: true });

        for (const entry of entries) {
            if (entry.isDirectory()) {
                const flowDir = path.join(flowsDir, entry.name);
                await this.processFlowDirectory(flowDir);
            }
        }
    }

    /**
     * Process a single flow directory
     */
    async processFlowDirectory(flowDir) {
        console.log(`Processing flow directory: ${flowDir}`);

        const flowFile = path.join(flowDir, 'flow.json');
        const templateFile = path.join(flowDir, 'flow.json.tmpl');

        if (await fs.pathExists(flowFile)) {
            console.log(`Normalizing: ${flowFile}`);
            const flowJson = await fs.readJson(flowFile);
            const normalized = this.normalize(flowJson);

            // Write normalized version back
            await fs.writeJson(flowFile, normalized, { spaces: 2 });

            // If template doesn't exist, create initial template
            if (!await fs.pathExists(templateFile)) {
                console.log(`Creating initial template: ${templateFile}`);
                await fs.writeJson(templateFile, normalized, { spaces: 2 });
            }
        }

        // Process flow modules
        const modulesDir = path.join(flowDir, 'modules');
        if (await fs.pathExists(modulesDir)) {
            const moduleFiles = await fs.readdir(modulesDir);
            for (const moduleFile of moduleFiles) {
                if (moduleFile.endsWith('.json')) {
                    const modulePath = path.join(modulesDir, moduleFile);
                    console.log(`Normalizing module: ${modulePath}`);

                    const moduleJson = await fs.readJson(modulePath);
                    const normalized = this.normalize(moduleJson);
                    await fs.writeJson(modulePath, normalized, { spaces: 2 });
                }
            }
        }
    }
}

// CLI Interface
const program = new Command();

program
    .name('normalize')
    .description('Normalize Contact Flow JSON files to reduce diff noise')
    .option('-d, --directory <path>', 'Directory containing flows', './flows')
    .option('-f, --file <path>', 'Single file to normalize')
    .option('-v, --verbose', 'Verbose output');

async function main(options) {
    try {
        const normalizer = new FlowNormalizer();

        if (options.file) {
            // Normalize single file
            console.log(`Normalizing single file: ${options.file}`);
            const flowJson = await fs.readJson(options.file);
            const normalized = normalizer.normalize(flowJson);
            await fs.writeJson(options.file, normalized, { spaces: 2 });
            console.log('Normalization completed for single file.');
        } else {
            // Normalize all flows in directory
            await normalizer.processFlowsDirectory(options.directory);
            console.log('Normalization completed for all flows.');
        }
    } catch (error) {
        console.error('Normalization failed:', error.message);
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

module.exports = { FlowNormalizer };