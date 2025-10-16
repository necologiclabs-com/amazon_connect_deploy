#!/usr/bin/env node

const { program } = require('commander');
const AWS = require('aws-sdk');
const fs = require('fs-extra');
const path = require('path');
const yaml = require('yaml');

class ConnectFlowExporter {
    constructor(region = 'us-east-1') {
        this.connect = new AWS.Connect({ region });
    }

    /**
     * Connect インスタンスの全Contact Flowsを取得
     */
    async listContactFlows(instanceId) {
        try {
            const params = {
                InstanceId: instanceId,
                ContactFlowTypes: ['CONTACT_FLOW', 'CUSTOMER_QUEUE', 'CUSTOMER_HOLD', 'CUSTOMER_WHISPER', 'AGENT_HOLD', 'AGENT_WHISPER', 'OUTBOUND_WHISPER', 'AGENT_TRANSFER', 'QUEUE_TRANSFER']
            };

            const result = await this.connect.listContactFlows(params).promise();
            return result.ContactFlowSummaryList;
        } catch (error) {
            console.error('❌ Error listing contact flows:', error.message);
            throw error;
        }
    }

    /**
     * 特定Contact Flowの詳細とコンテンツを取得
     */
    async getContactFlowContent(instanceId, contactFlowId) {
        try {
            // フロー詳細を取得
            const flowDetails = await this.connect.describeContactFlow({
                InstanceId: instanceId,
                ContactFlowId: contactFlowId
            }).promise();

            // フローコンテンツ（JSON）を取得
            const flowContent = await this.connect.getContactFlowContent({
                InstanceId: instanceId,
                ContactFlowId: contactFlowId
            }).promise();

            return {
                details: flowDetails.ContactFlow,
                content: JSON.parse(flowContent.Content)
            };
        } catch (error) {
            console.error(`❌ Error getting contact flow ${contactFlowId}:`, error.message);
            throw error;
        }
    }

    /**
     * フロー名を安全なファイル名に変換
     */
    sanitizeFlowName(flowName) {
        return flowName
            .replace(/[^a-zA-Z0-9-_]/g, '') // 特殊文字を除去
            .replace(/\s+/g, '_')           // スペースをアンダースコアに
            .substring(0, 50);              // 長さ制限
    }

    /**
     * 単一フローのエクスポート
     */
    async exportSingleFlow(instanceId, contactFlowId, outputDir = 'flows') {
        try {
            console.log(`📥 Exporting contact flow: ${contactFlowId}`);

            const { details, content } = await this.getContactFlowContent(instanceId, contactFlowId);
            const flowName = this.sanitizeFlowName(details.Name);
            const flowDir = path.join(outputDir, flowName);

            // ディレクトリ作成
            await fs.ensureDir(flowDir);

            // Contact Flow JSONを保存
            const contentPath = path.join(flowDir, 'flow.json');
            await fs.writeJson(contentPath, content, { spaces: 2 });

            // メタデータを保存
            const metadataPath = path.join(flowDir, 'metadata.yaml');
            const metadata = {
                name: details.Name,
                id: details.Id,
                arn: details.Arn,
                type: details.Type,
                state: details.State,
                description: details.Description || '',
                tags: details.Tags || {},
                exportedAt: new Date().toISOString(),
                exportedBy: 'connect-flow-exporter'
            };
            await fs.writeFile(metadataPath, yaml.stringify(metadata));

            console.log(`✅ Exported: ${flowName}`);
            console.log(`   📄 Content: ${contentPath}`);
            console.log(`   📋 Metadata: ${metadataPath}`);

            return {
                flowName,
                contentPath,
                metadataPath,
                metadata
            };
        } catch (error) {
            console.error(`❌ Failed to export flow ${contactFlowId}:`, error.message);
            throw error;
        }
    }

    /**
     * 全フローのエクスポート
     */
    async exportAllFlows(instanceId, outputDir = 'flows', filters = {}) {
        try {
            console.log(`🚀 Starting export from Connect instance: ${instanceId}`);

            const flows = await this.listContactFlows(instanceId);
            console.log(`📋 Found ${flows.length} contact flows`);

            // フィルター適用
            let filteredFlows = flows;
            if (filters.types && filters.types.length > 0) {
                filteredFlows = flows.filter(flow => filters.types.includes(flow.ContactFlowType));
            }
            if (filters.names && filters.names.length > 0) {
                filteredFlows = filteredFlows.filter(flow =>
                    filters.names.some(name => flow.Name.toLowerCase().includes(name.toLowerCase()))
                );
            }
            if (filters.states && filters.states.length > 0) {
                filteredFlows = filteredFlows.filter(flow => filters.states.includes(flow.ContactFlowState));
            }

            console.log(`🎯 Exporting ${filteredFlows.length} filtered flows`);

            const results = [];
            for (const flow of filteredFlows) {
                try {
                    const result = await this.exportSingleFlow(instanceId, flow.Id, outputDir);
                    results.push({
                        success: true,
                        flow: flow,
                        result: result
                    });
                } catch (error) {
                    console.error(`⚠️ Failed to export ${flow.Name}: ${error.message}`);
                    results.push({
                        success: false,
                        flow: flow,
                        error: error.message
                    });
                }
            }

            // サマリー出力
            const successful = results.filter(r => r.success);
            const failed = results.filter(r => !r.success);

            console.log(`\n📊 Export Summary:`);
            console.log(`   ✅ Successful: ${successful.length}`);
            console.log(`   ❌ Failed: ${failed.length}`);

            if (failed.length > 0) {
                console.log(`\n❌ Failed exports:`);
                failed.forEach(f => {
                    console.log(`   - ${f.flow.Name}: ${f.error}`);
                });
            }

            // エクスポートサマリーファイル作成
            const summaryPath = path.join(outputDir, 'export-summary.yaml');
            const summary = {
                exportedAt: new Date().toISOString(),
                instanceId: instanceId,
                totalFlows: flows.length,
                filteredFlows: filteredFlows.length,
                successful: successful.length,
                failed: failed.length,
                results: results.map(r => ({
                    flowName: r.flow.Name,
                    flowId: r.flow.Id,
                    flowType: r.flow.ContactFlowType,
                    success: r.success,
                    error: r.error || null,
                    outputPath: r.success ? r.result.contentPath : null
                }))
            };
            await fs.writeFile(summaryPath, yaml.stringify(summary));
            console.log(`\n📄 Export summary saved: ${summaryPath}`);

            return results;
        } catch (error) {
            console.error('❌ Export failed:', error.message);
            throw error;
        }
    }

    /**
     * 増分エクスポート（変更されたフローのみ）
     */
    async exportIncremental(instanceId, outputDir = 'flows', lastExportTime) {
        try {
            console.log(`🔄 Incremental export since: ${lastExportTime}`);

            const flows = await this.listContactFlows(instanceId);
            const modifiedFlows = [];

            for (const flow of flows) {
                const flowDir = path.join(outputDir, this.sanitizeFlowName(flow.Name));
                const metadataPath = path.join(flowDir, 'metadata.yaml');

                if (await fs.pathExists(metadataPath)) {
                    const metadata = yaml.parse(await fs.readFile(metadataPath, 'utf8'));
                    const lastExported = new Date(metadata.exportedAt);

                    if (lastExported < new Date(lastExportTime)) {
                        modifiedFlows.push(flow);
                    }
                } else {
                    // メタデータファイルが存在しない = 新規フロー
                    modifiedFlows.push(flow);
                }
            }

            console.log(`📋 Found ${modifiedFlows.length} modified flows`);

            if (modifiedFlows.length === 0) {
                console.log('✅ No changes detected');
                return [];
            }

            const results = [];
            for (const flow of modifiedFlows) {
                try {
                    const result = await this.exportSingleFlow(instanceId, flow.Id, outputDir);
                    results.push({ success: true, flow, result });
                } catch (error) {
                    console.error(`⚠️ Failed to export ${flow.Name}: ${error.message}`);
                    results.push({ success: false, flow, error: error.message });
                }
            }

            return results;
        } catch (error) {
            console.error('❌ Incremental export failed:', error.message);
            throw error;
        }
    }
}

// CLI設定
if (require.main === module) {
    program
        .version('1.0.0')
        .description('Amazon Connect Contact Flow Exporter');

    program
        .command('export')
        .description('Export contact flows from Amazon Connect')
        .requiredOption('-i, --instance-id <instanceId>', 'Connect instance ID')
        .option('-o, --output <dir>', 'Output directory', 'flows')
        .option('-r, --region <region>', 'AWS region', 'us-east-1')
        .option('--flow-id <flowId>', 'Export specific flow by ID')
        .option('--types <types>', 'Filter by flow types (comma-separated)', (value) => value.split(','))
        .option('--names <names>', 'Filter by flow names containing (comma-separated)', (value) => value.split(','))
        .option('--states <states>', 'Filter by flow states (comma-separated)', (value) => value.split(','))
        .option('--incremental [since]', 'Incremental export since timestamp (ISO 8601)')
        .action(async (options) => {
            try {
                const exporter = new ConnectFlowExporter(options.region);

                if (options.flowId) {
                    // 単一フローエクスポート
                    await exporter.exportSingleFlow(options.instanceId, options.flowId, options.output);
                } else if (options.incremental) {
                    // 増分エクスポート
                    const since = options.incremental === true ?
                        new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString() : // 24時間前
                        options.incremental;
                    await exporter.exportIncremental(options.instanceId, options.output, since);
                } else {
                    // 全フローエクスポート
                    const filters = {
                        types: options.types,
                        names: options.names,
                        states: options.states
                    };
                    await exporter.exportAllFlows(options.instanceId, options.output, filters);
                }
            } catch (error) {
                console.error('❌ Export failed:', error.message);
                process.exit(1);
            }
        });

    program
        .command('list')
        .description('List contact flows in Amazon Connect')
        .requiredOption('-i, --instance-id <instanceId>', 'Connect instance ID')
        .option('-r, --region <region>', 'AWS region', 'us-east-1')
        .option('--format <format>', 'Output format (table|json|yaml)', 'table')
        .action(async (options) => {
            try {
                const exporter = new ConnectFlowExporter(options.region);
                const flows = await exporter.listContactFlows(options.instanceId);

                if (options.format === 'json') {
                    console.log(JSON.stringify(flows, null, 2));
                } else if (options.format === 'yaml') {
                    console.log(yaml.stringify(flows));
                } else {
                    // テーブル形式
                    console.log('📋 Contact Flows:');
                    console.log('');
                    flows.forEach(flow => {
                        console.log(`📞 ${flow.Name}`);
                        console.log(`   ID: ${flow.Id}`);
                        console.log(`   Type: ${flow.ContactFlowType}`);
                        console.log(`   State: ${flow.ContactFlowState}`);
                        console.log('');
                    });
                }
            } catch (error) {
                console.error('❌ List failed:', error.message);
                process.exit(1);
            }
        });

    program.parse(process.argv);
}

module.exports = ConnectFlowExporter;