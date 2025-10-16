# Amazon Connect CI/CD パイプライン 利用ガイド

## 🚀 はじめに

このシステムはAmazon Connect Contact Flowの開発から本番環境への展開を自動化するCI/CDパイプラインです。

## 📋 前提条件

### 必要な環境
- **Node.js 18以上**
- **AWS CLI** (設定済み)
- **AWS CDK** (インストール済み)
- **Git** (GitHub リポジトリアクセス権限)

### AWS アカウント構成
- **DEV環境**: 開発・テスト用Amazon Connect インスタンス
- **TEST環境**: CI/CD検証用Amazon Connect インスタンス  
- **PROD環境**: 本番用Amazon Connect インスタンス

## 🛠️ 初期セットアップ

### 1. リポジトリクローン
```bash
git clone https://github.com/necologiclabs-com/amazon_connect_deploy.git
cd amazon_connect_deploy
```

### 2. 依存関係インストール
```bash
npm install
```

### 3. 環境設定
環境固有の値を `env/` ディレクトリの YAML ファイルで設定：

```yaml
# env/dev.yaml の例
Connect:
  InstanceId: "12345678-1234-1234-1234-123456789012"
  InstanceArn: "arn:aws:connect:us-east-1:123456789012:instance/12345678-1234-1234-1234-123456789012"

Lambda:
  InvokeAlias: "arn:aws:lambda:us-east-1:123456789012:function:connect-auth:LIVE"

Queue:
  Sales: "arn:aws:connect:us-east-1:123456789012:instance/12345678-1234-1234-1234-123456789012/queue/11111111-1111-1111-1111-111111111111"

Lex:
  BotV2: "arn:aws:lex:us-east-1:123456789012:bot-alias/TSTALIASID/TSTBOTID"

Phone:
  MainNumber: "+15551234567"
```

## 📞 Contact Flow の管理

### 1. 新しいContact Flow の作成

#### Step 1: Amazon Connect デザイナーでフローを作成
- AWS コンソールでAmazon Connect デザイナーを開く
- 新しいContact Flowを作成・編集
- **重要**: 環境固有の値（ARN、電話番号など）は後でトークン化するため、仮の値を使用

#### Step 2: フローをエクスポート
Amazon Connect デザイナーから「エクスポート」でJSONファイルをダウンロード

#### Step 3: フローのテンプレート化
```bash
# ダウンロードしたJSONファイルを正規化
node scripts/normalize.js --file path/to/downloaded-flow.json --output flows/YourFlowName/flow.json.tmpl
```

#### Step 4: 環境依存値をトークン化
`flows/YourFlowName/flow.json.tmpl` を編集し、環境固有の値をトークンに置換：

**置換例:**
```json
// Before (実際のARN)
"contactFlowId": "arn:aws:connect:us-east-1:123456789012:instance/12345678-1234-1234-1234-123456789012/contact-flow/abcdef..."

// After (トークン)
"contactFlowId": "${Lambda.InvokeAlias}"
```

**主なトークンパターン:**
- `${Lambda.InvokeAlias}` - Lambda 関数ARN
- `${Queue.Sales}` - キューARN  
- `${Lex.BotV2}` - Lex ボットARN
- `${Phone.MainNumber}` - 電話番号
- `${Connect.InstanceId}` - ConnectインスタンスID

### 2. フローの検証
```bash
# テンプレート内容の検証
node scripts/validate.js --template flows/YourFlowName/flow.json.tmpl --env env/dev.yaml

# レンダリングテスト（実際のJSONを生成）
node scripts/render.js --template flows/YourFlowName/flow.json.tmpl --env env/dev.yaml --output dist/YourFlowName-dev.json
```

## 🔄 開発ワークフロー

### 1. 機能ブランチでの開発
```bash
# 新しいブランチを作成
git checkout -b feature/new-contact-flow

# ファイルを編集後
git add .
git commit -m "feat: 新しいContact Flowを追加"
git push origin feature/new-contact-flow
```

### 2. Pull Request の作成
- GitHub上でPull Requestを作成
- **自動検証が実行される**:
  - ✅ テンプレート構文チェック
  - ✅ トークン解決テスト
  - ✅ スキーマ検証
  - ✅ 参照整合性チェック

### 3. TEST環境への自動デプロイ
```bash
# mainブランチにマージされると自動的にTEST環境にデプロイ
git checkout main
git merge feature/new-contact-flow
git push origin main
```

### 4. PROD環境へのリリース
```bash
# リリースタグを作成してPROD環境にデプロイ
git tag release-$(date +%Y%m%d)-$(git rev-parse --short HEAD)
git push origin --tags
```

## 🛠️ ローカルでのツール使用

### normalize.js - Contact Flow正規化
```bash
# 単一ファイルの正規化
node scripts/normalize.js --file input.json --output output.json.tmpl

# ディレクトリ全体の正規化  
node scripts/normalize.js --dir flows/ --output dist/
```

### render.js - テンプレートレンダリング
```bash
# 単一テンプレートのレンダリング
node scripts/render.js --template flows/Sales/flow.json.tmpl --env env/dev.yaml --output dist/Sales-dev.json

# 環境指定でのレンダリング
node scripts/render.js --env test --template flows/Sales/flow.json.tmpl
```

### validate.js - 検証
```bash
# テンプレートとEnvironment設定の検証
node scripts/validate.js --template flows/Sales/flow.json.tmpl --env env/dev.yaml

# 環境設定ファイルのみ検証
node scripts/validate.js --env env/prod.yaml
```

## 🧪 テスト実行

### 基本テスト
```bash
npm test
```

### カバレッジ付きテスト
```bash
npm run test:coverage
```

### 特定テストファイルの実行
```bash
npx jest tests/basic.test.js
```

## 🚨 トラブルシューティング

### よくあるエラーと対処法

#### 1. トークン解決エラー
```
Error: Unresolved token: ${Lambda.NewFunction}
```
**対処**: `env/*.yaml` ファイルに該当するトークンの値を追加

#### 2. ARN形式エラー
```
Error: Invalid ARN format
```
**対処**: ARNの形式を確認（リージョン、アカウントID、リソースタイプ）

#### 3. 参照整合性エラー
```
Error: Queue ARN belongs to different Connect instance
```
**対処**: 全てのリソースが同じConnect インスタンスに属していることを確認

#### 4. CDKデプロイエラー
```bash
# CDKブートストラップが必要な場合
cd cdk
npx cdk bootstrap

# CDKデプロイ
npx cdk deploy --context env=test
```

## 📊 監視とメンテナンス

### ドリフト検出
システムは毎晩自動でドリフト検出を実行。差分があった場合はSlack/Emailで通知。

### ログ確認
- **GitHub Actions**: リポジトリの「Actions」タブ
- **AWS CloudTrail**: Connect API呼び出しの監査ログ
- **CDK**: CloudFormationイベント

### ロールバック手順
```bash
# 緊急時のロールバック（前のバージョンのタグを指定）
git tag rollback-$(date +%Y%m%d) <previous-commit-hash>
git push origin --tags
```

## 🔗 関連リンク

- [Amazon Connect API リファレンス](https://docs.aws.amazon.com/connect/latest/APIReference/)
- [AWS CDK ドキュメント](https://docs.aws.amazon.com/cdk/)
- [GitHub Actions ドキュメント](https://docs.github.com/actions)

## 📞 サポート

問題が発生した場合は以下の手順で対応してください：

1. **ログ確認**: GitHub ActionsとAWS CloudTrailでエラー詳細を確認
2. **Issue作成**: GitHubリポジトリにIssueを作成
3. **チーム相談**: Slackまたはメールでサポートチームに連絡

---

**🎯 このガイドでAmazon Connect CI/CDパイプラインを効率的に活用しましょう！**