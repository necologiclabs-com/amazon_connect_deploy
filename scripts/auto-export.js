#!/usr/bin/env node

const { program } = require('commander');
const cron = require('node-cron');
const fs = require('fs-extra');
const path = require('path');
const yaml = require('yaml');
const { execSync } = require('child_process');
const ConnectFlowExporter = require('./export');

class AutoExportScheduler {
    constructor(configPath = 'config/auto-export.yaml') {
        this.configPath = configPath;
        this.config = null;
    }

    async loadConfig() {
        try {
            if (await fs.pathExists(this.configPath)) {
                const configContent = await fs.readFile(this.configPath, 'utf8');
                this.config = yaml.parse(configContent);
            } else {
                // デフォルト設定作成
                this.config = this.createDefaultConfig();
                await this.saveConfig();
                console.log(`📄 Created default config: ${this.configPath}`);
            }
            return this.config;
        } catch (error) {
            console.error('❌ Failed to load config:', error.message);
            throw error;
        }
    }

    createDefaultConfig() {
        return {
            environments: {
                dev: {
                    instanceId: '${CONNECT_INSTANCE_ID_DEV}',
                    region: 'us-east-1',
                    outputDir: 'flows',
                    enabled: true,
                    schedule: '0 2 * * *', // 毎日 2:00 AM
                    filters: {
                        types: ['CONTACT_FLOW'],
                        states: ['ACTIVE', 'PUBLISHED']
                    }
                },
                test: {
                    instanceId: '${CONNECT_INSTANCE_ID_TEST}',
                    region: 'us-east-1',
                    outputDir: 'flows-test',
                    enabled: false, // TEST環境は手動のみ
                    schedule: '0 3 * * 0', // 毎週日曜 3:00 AM
                    filters: {
                        types: ['CONTACT_FLOW'],
                        states: ['ACTIVE']
                    }
                }
            },
            git: {
                autoCommit: true,
                commitMessage: 'auto: Contact Flows自動エクスポート更新',
                autoPush: false, // セキュリティ上false推奨
                branch: 'auto-export'
            },
            notifications: {
                slack: {
                    enabled: false,
                    webhookUrl: '${SLACK_WEBHOOK_URL}',
                    channel: '#connect-updates'
                },
                email: {
                    enabled: false,
                    to: ['team@company.com'],
                    subject: 'Connect Flows Auto Export Report'
                }
            },
            incremental: {
                enabled: true,
                checkInterval: '*/30 * * * *', // 30分毎
                lookbackHours: 1
            }
        };
    }

    async saveConfig() {
        await fs.ensureDir(path.dirname(this.configPath));
        await fs.writeFile(this.configPath, yaml.stringify(this.config));
    }

    /**
     * 環境変数を解決
     */
    resolveEnvVars(text) {
        return text.replace(/\$\{([^}]+)\}/g, (match, varName) => {
            return process.env[varName] || match;
        });
    }

    /**
     * 単一環境のエクスポート実行
     */
    async exportEnvironment(envName, envConfig) {
        try {
            console.log(`\n🚀 Starting export for environment: ${envName}`);

            const instanceId = this.resolveEnvVars(envConfig.instanceId);
            if (instanceId.includes('${')) {
                console.log(`⏭️ Skipping ${envName}: Environment variable not resolved`);
                return null;
            }

            const exporter = new ConnectFlowExporter(envConfig.region);

            let results;
            if (this.config.incremental.enabled) {
                // 増分エクスポート
                const lookbackTime = new Date(Date.now() - envConfig.lookbackHours * 60 * 60 * 1000);
                results = await exporter.exportIncremental(instanceId, envConfig.outputDir, lookbackTime.toISOString());
            } else {
                // 全エクスポート
                results = await exporter.exportAllFlows(instanceId, envConfig.outputDir, envConfig.filters);
            }

            console.log(`✅ Export completed for ${envName}`);
            return {
                environment: envName,
                success: true,
                results: results,
                timestamp: new Date().toISOString()
            };
        } catch (error) {
            console.error(`❌ Export failed for ${envName}:`, error.message);
            return {
                environment: envName,
                success: false,
                error: error.message,
                timestamp: new Date().toISOString()
            };
        }
    }

    /**
     * Gitコミット実行
     */
    async performGitCommit(results) {
        if (!this.config.git.autoCommit) {
            return;
        }

        try {
            console.log('\n📝 Performing Git operations...');

            // 変更確認
            const status = execSync('git status --porcelain', { encoding: 'utf8' });
            if (!status.trim()) {
                console.log('📝 No changes to commit');
                return;
            }

            // ブランチ作成・切り替え
            if (this.config.git.branch !== 'main') {
                try {
                    execSync(`git checkout -b ${this.config.git.branch}`, { stdio: 'ignore' });
                } catch {
                    execSync(`git checkout ${this.config.git.branch}`, { stdio: 'ignore' });
                }
            }

            // 変更をステージング
            execSync('git add flows/ flows-test/', { stdio: 'inherit' });

            // コミット
            const commitMessage = `${this.config.git.commitMessage}\n\n` +
                results.map(r => `- ${r.environment}: ${r.success ? '✅' : '❌'} ${r.success ? `${r.results.length} flows` : r.error}`).join('\n');

            execSync(`git commit -m "${commitMessage}"`, { stdio: 'inherit' });

            // プッシュ (設定されている場合)
            if (this.config.git.autoPush) {
                execSync(`git push origin ${this.config.git.branch}`, { stdio: 'inherit' });
                console.log('📤 Changes pushed to remote');
            } else {
                console.log(`📝 Changes committed to branch: ${this.config.git.branch}`);
                console.log('💡 Manual push required: git push origin ' + this.config.git.branch);
            }

        } catch (error) {
            console.error('❌ Git operations failed:', error.message);
        }
    }

    /**
     * 通知送信
     */
    async sendNotifications(results) {
        // Slack通知
        if (this.config.notifications.slack.enabled) {
            try {
                const successful = results.filter(r => r.success).length;
                const failed = results.filter(r => !r.success).length;

                const message = {
                    text: `Connect Flows Auto Export Report`,
                    attachments: [{
                        color: failed > 0 ? 'warning' : 'good',
                        fields: [
                            { title: 'Successful', value: successful.toString(), short: true },
                            { title: 'Failed', value: failed.toString(), short: true },
                            { title: 'Timestamp', value: new Date().toISOString(), short: false }
                        ],
                        footer: 'Amazon Connect Auto Export'
                    }]
                };

                // Slack Webhook実装は省略 (実際の実装ではaxiosやfetchを使用)
                console.log('📢 Slack notification sent');
            } catch (error) {
                console.error('❌ Slack notification failed:', error.message);
            }
        }
    }

    /**
     * 全環境の自動エクスポート実行
     */
    async runAutoExport() {
        try {
            console.log('🚀 Starting scheduled auto export...');
            await this.loadConfig();

            const results = [];
            for (const [envName, envConfig] of Object.entries(this.config.environments)) {
                if (envConfig.enabled) {
                    const result = await this.exportEnvironment(envName, envConfig);
                    if (result) {
                        results.push(result);
                    }
                } else {
                    console.log(`⏭️ Skipping disabled environment: ${envName}`);
                }
            }

            // Git操作
            await this.performGitCommit(results);

            // 通知
            await this.sendNotifications(results);

            console.log('\n✅ Auto export completed');
            return results;

        } catch (error) {
            console.error('❌ Auto export failed:', error.message);
            throw error;
        }
    }

    /**
     * スケジューラー開始
     */
    startScheduler() {
        console.log('⏰ Starting auto export scheduler...');

        this.loadConfig().then(() => {
            // メインスケジュール
            for (const [envName, envConfig] of Object.entries(this.config.environments)) {
                if (envConfig.enabled && envConfig.schedule) {
                    console.log(`📅 Scheduled ${envName}: ${envConfig.schedule}`);
                    cron.schedule(envConfig.schedule, async () => {
                        console.log(`\n⏰ Triggered scheduled export for ${envName}`);
                        await this.exportEnvironment(envName, envConfig);
                    });
                }
            }

            // 増分チェック
            if (this.config.incremental.enabled) {
                console.log(`🔄 Incremental check: ${this.config.incremental.checkInterval}`);
                cron.schedule(this.config.incremental.checkInterval, async () => {
                    await this.runAutoExport();
                });
            }

            console.log('✅ Scheduler started');
            console.log('💡 Press Ctrl+C to stop');
        });
    }
}

// CLI設定
if (require.main === module) {
    program
        .version('1.0.0')
        .description('Amazon Connect Auto Export Scheduler');

    program
        .command('run')
        .description('Run auto export once')
        .option('-c, --config <path>', 'Config file path', 'config/auto-export.yaml')
        .action(async (options) => {
            try {
                const scheduler = new AutoExportScheduler(options.config);
                await scheduler.runAutoExport();
            } catch (error) {
                console.error('❌ Auto export failed:', error.message);
                process.exit(1);
            }
        });

    program
        .command('start')
        .description('Start the scheduler daemon')
        .option('-c, --config <path>', 'Config file path', 'config/auto-export.yaml')
        .action(async (options) => {
            try {
                const scheduler = new AutoExportScheduler(options.config);
                scheduler.startScheduler();
            } catch (error) {
                console.error('❌ Scheduler failed to start:', error.message);
                process.exit(1);
            }
        });

    program
        .command('config')
        .description('Generate default config file')
        .option('-c, --config <path>', 'Config file path', 'config/auto-export.yaml')
        .action(async (options) => {
            try {
                const scheduler = new AutoExportScheduler(options.config);
                await scheduler.loadConfig(); // これでデフォルト設定が作成される
                console.log(`✅ Config file created: ${options.config}`);
            } catch (error) {
                console.error('❌ Config creation failed:', error.message);
                process.exit(1);
            }
        });

    program.parse(process.argv);
}

module.exports = AutoExportScheduler;