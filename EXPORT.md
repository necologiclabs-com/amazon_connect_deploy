# Amazon Connect Contact Flow 自動エクスポート機能

## 🎯 概要

Amazon Connect デザイナーで作成・編集されたContact FlowをAPIを通じて自動的にエクスポートし、GitHubリポジトリに同期する機能です。

## 🚀 機能一覧

### 1. **手動エクスポート** (`scripts/export.js`)
- 特定のContact Flow単体エクスポート
- 全Contact Flowsの一括エクスポート
- フィルター機能（タイプ、状態、名前）
- 増分エクスポート（変更されたフローのみ）

### 2. **自動エクスポート** (`scripts/auto-export.js`)
- スケジュール実行（cron形式）
- 複数環境対応（DEV/TEST/PROD）
- Git自動コミット・プッシュ
- Slack/Email通知

### 3. **GitHub Actions統合** (`.github/workflows/auto-export.yml`)
- 定期実行（毎日自動）
- 手動トリガー対応
- Pull Request自動作成
- CI/CD連携

---

## 📋 セットアップ

### 1. 必要な依存関係のインストール
```bash
npm install
```

### 2. AWS認証情報の設定
```bash
# AWS CLI設定（推奨）
aws configure

# または環境変数
export AWS_ACCESS_KEY_ID="your-access-key"
export AWS_SECRET_ACCESS_KEY="your-secret-key"
export AWS_REGION="us-east-1"
```

### 3. Connect インスタンスIDの確認
```bash
# インスタンス一覧取得
aws connect list-instances

# 環境変数設定
export CONNECT_INSTANCE_ID_DEV="12345678-1234-1234-1234-123456789012"
export CONNECT_INSTANCE_ID_TEST="87654321-4321-4321-4321-876543218765"
```

---

## 🛠️ 使用方法

### 基本的なエクスポート

#### 全Contact Flowsをエクスポート
```bash
# 基本実行
node scripts/export.js export --instance-id "12345678-1234-1234-1234-123456789012"

# 出力ディレクトリ指定
node scripts/export.js export \
  --instance-id "12345678-1234-1234-1234-123456789012" \
  --output flows-dev

# npmスクリプト使用
npm run export -- export --instance-id "12345678-1234-1234-1234-123456789012"
```

#### 特定フローのエクスポート
```bash
node scripts/export.js export \
  --instance-id "12345678-1234-1234-1234-123456789012" \
  --flow-id "contact-flow-id-here"
```

#### フィルター機能
```bash
# フロータイプでフィルター
node scripts/export.js export \
  --instance-id "12345678-1234-1234-1234-123456789012" \
  --types "CONTACT_FLOW,CUSTOMER_QUEUE"

# フロー名でフィルター
node scripts/export.js export \
  --instance-id "12345678-1234-1234-1234-123456789012" \
  --names "Sales,Support"

# 状態でフィルター  
node scripts/export.js export \
  --instance-id "12345678-1234-1234-1234-123456789012" \
  --states "ACTIVE,PUBLISHED"
```

#### 増分エクスポート
```bash
# 過去24時間の変更のみ
node scripts/export.js export \
  --instance-id "12345678-1234-1234-1234-123456789012" \
  --incremental

# 特定時刻以降の変更
node scripts/export.js export \
  --instance-id "12345678-1234-1234-1234-123456789012" \
  --incremental "2024-01-15T10:00:00Z"
```

### Contact Flow一覧表示

```bash
# テーブル形式
node scripts/export.js list --instance-id "12345678-1234-1234-1234-123456789012"

# JSON形式
node scripts/export.js list \
  --instance-id "12345678-1234-1234-1234-123456789012" \
  --format json

# YAML形式
node scripts/export.js list \
  --instance-id "12345678-1234-1234-1234-123456789012" \
  --format yaml
```

---

## ⏰ 自動エクスポート

### 設定ファイル作成
```bash
# デフォルト設定生成
node scripts/auto-export.js config

# カスタムパス指定
node scripts/auto-export.js config --config config/my-export-config.yaml
```

### 設定ファイル例 (`config/auto-export.yaml`)
```yaml
environments:
  dev:
    instanceId: "${CONNECT_INSTANCE_ID_DEV}"
    region: "us-east-1"
    outputDir: "flows-dev"
    enabled: true
    schedule: "0 2 * * *"  # 毎日 2:00 AM
    filters:
      types: ["CONTACT_FLOW"]
      states: ["ACTIVE", "PUBLISHED"]
  
  test:
    instanceId: "${CONNECT_INSTANCE_ID_TEST}"
    region: "us-east-1" 
    outputDir: "flows-test"
    enabled: false
    schedule: "0 3 * * 0"  # 毎週日曜 3:00 AM

git:
  autoCommit: true
  commitMessage: "auto: Contact Flows自動エクスポート更新"
  autoPush: false
  branch: "auto-export"

notifications:
  slack:
    enabled: true
    webhookUrl: "${SLACK_WEBHOOK_URL}"
    channel: "#connect-updates"

incremental:
  enabled: true
  checkInterval: "*/30 * * * *"  # 30分毎
  lookbackHours: 1
```

### 手動実行
```bash
# 1回だけ実行
npm run export:auto

# または
node scripts/auto-export.js run
```

### スケジューラー開始
```bash
# デーモンとして常駐実行
npm run export:scheduler

# または
node scripts/auto-export.js start
```

---

## 🔄 GitHub Actions統合

### 1. 必要なSecretsとVariablesの設定

**Repository Variables:**
```bash
CONNECT_INSTANCE_ID_DEV=12345678-1234-1234-1234-123456789012
CONNECT_INSTANCE_ID_TEST=87654321-4321-4321-4321-876543218765
AWS_REGION=us-east-1
AWS_ROLE_ARN=arn:aws:iam::123456789012:role/GitHubActionsRole
```

**Repository Secrets:**
```bash
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/...
```

### 2. 自動実行スケジュール
- **毎日 JST 8:00** (UTC 23:00) に自動実行
- DEV環境から増分エクスポート
- 変更があればPull Request自動作成

### 3. 手動実行
```bash
# GitHub CLIを使用
gh workflow run auto-export.yml \
  -f environment=dev \
  -f incremental=true

# または GitHub UI上で「Run workflow」をクリック
```

---

## 📁 出力フォルダ構造

```
flows-dev/
├── SalesEntry/
│   ├── flow.json              # Contact Flow JSON
│   └── metadata.yaml          # フロー詳細情報
├── CustomerSupport/
│   ├── flow.json
│   └── metadata.yaml
└── export-summary.yaml        # エクスポートサマリー
```

### metadata.yaml 例
```yaml
name: "Sales Entry Flow"
id: "12345678-1234-1234-1234-123456789012"
arn: "arn:aws:connect:us-east-1:123456789012:instance/abc123/contact-flow/def456"
type: "CONTACT_FLOW"
state: "ACTIVE"
description: "Main sales entry point for customer calls"
tags:
  Environment: "dev"
  Team: "sales"
exportedAt: "2024-01-15T10:30:00.000Z"
exportedBy: "connect-flow-exporter"
```

---

## 🚨 トラブルシューティング

### よくあるエラー

#### 1. 認証エラー
```
❌ Error listing contact flows: Access Denied
```
**対処**:
- AWS認証情報を確認
- Connect API権限を確認
- インスタンスIDの正確性を確認

#### 2. インスタンスIDエラー
```
❌ Error: Invalid instance ID format
```
**対処**:
```bash
# 正しい形式確認
aws connect list-instances --query "InstanceSummaryList[*].[Id,InstanceAlias]"
```

#### 3. フローアクセスエラー
```
❌ Error getting contact flow: Contact flow not found
```
**対処**:
- フローIDの確認
- フローの状態確認（削除されていないか）
- 権限の確認

### 権限設定

**必要なIAM権限:**
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "connect:ListInstances",
        "connect:ListContactFlows", 
        "connect:DescribeContactFlow",
        "connect:GetContactFlowContent"
      ],
      "Resource": "*"
    }
  ]
}
```

---

## 🔗 統合ワークフロー

### 1. 開発フロー
```bash
# 1. デザイナーでフロー編集
# 2. 自動エクスポート実行
npm run export:auto

# 3. 必要に応じてテンプレート化
node scripts/normalize.js --file flows-dev/NewFlow/flow.json --output flows/NewFlow/flow.json.tmpl

# 4. 環境依存値をトークン化（手動）
# 5. Git commit & Push
```

### 2. CI/CD連携
```bash
# GitHub Actions自動実行
# ↓
# Pull Request作成
# ↓  
# レビュー・マージ
# ↓
# TEST環境デプロイ
# ↓
# PROD環境リリース
```

---

## 📊 監視・メトリクス

### エクスポートサマリー
- 成功・失敗したフロー数
- 処理時間
- エラー詳細
- 変更検出数

### 通知設定
- Slack: リアルタイム通知
- Email: 日次サマリー
- GitHub: Pull Request作成

---

**🎉 これで手動エクスポートの手間が大幅に削減され、常に最新のContact Flowsをリポジトリで管理できます！**