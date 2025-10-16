# Amazon Connect CI/CD Implementation

README.md仕様書に基づく Amazon Connect コンタクトフロー CI/CD パイプラインの実装です。

## 🏗️ アーキテクチャ

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Development   │    │      Test       │    │   Production    │
│   Environment   │    │   Environment   │    │   Environment   │
│                 │    │                 │    │                 │
│ ┌─────────────┐ │    │ ┌─────────────┐ │    │ ┌─────────────┐ │
│ │   Designer  │ │    │ │ Auto Deploy │ │    │ │Blue/Green   │ │
│ │   Manual    │ │    │ │   CI/CD     │ │    │ │Deployment   │ │
│ │   Export    │ │    │ │   Testing   │ │    │ │ Approval    │ │
│ └─────────────┘ │    │ └─────────────┘ │    │ └─────────────┘ │
└─────────────────┘    └─────────────────┘    └─────────────────┘
         │                       │                       │
         ▼                       ▼                       ▼
┌─────────────────────────────────────────────────────────────────┐
│                    GitHub Repository                            │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐│
│  │    flows/   │ │    env/     │ │  scripts/   │ │   .github/  ││
│  │ テンプレート │ │ 環境設定     │ │ 処理スクリプト │ │ ワークフロー  ││
│  └─────────────┘ └─────────────┘ └─────────────┘ └─────────────┘│
└─────────────────────────────────────────────────────────────────┘
```

## 📁 プロジェクト構造

```
amazon_connect_deploy/
├── flows/                      # コンタクトフローテンプレート
│   ├── SalesEntry/
│   │   ├── flow.json.tmpl     # メインフローテンプレート
│   │   └── modules/           # フローモジュール (オプション)
│   └── SupportEntry/
│       └── flow.json.tmpl
├── env/                       # 環境設定
│   ├── dev.yaml              # 開発環境設定
│   ├── test.yaml             # テスト環境設定
│   └── prod.yaml             # 本番環境設定
├── scripts/                  # 処理スクリプト
│   ├── normalize.js          # フロー正規化
│   ├── render.js             # テンプレート レンダリング
│   ├── validate.js           # 検証
│   └── ...                   # その他のスクリプト
├── cdk/                      # CDK デプロイメント
│   ├── app.js               # CDKアプリケーション
│   ├── lib/
│   │   └── connect-flow-stack.js
│   └── package.json
├── .github/workflows/        # GitHub Actions
│   ├── pr-validation.yml     # PR検証
│   ├── deploy-test.yml       # TEST環境デプロイ
│   ├── deploy-prod.yml       # PROD環境デプロイ
│   └── drift-detection.yml   # ドリフト検出
├── tests/                    # テストファイル
└── dist/                     # レンダリング結果 (生成)
```

## 🚀 セットアップ

### 1. 依存関係のインストール

```bash
npm install
cd cdk && npm install
```

### 2. 環境設定

各環境の設定ファイル (`env/*.yaml`) を実際の値で更新：

```yaml
# env/dev.yaml の例
connect:
  instance_id: "your-connect-instance-id"
  instance_arn: "arn:aws:connect:region:account:instance/instance-id"
  region: "us-east-1"

tokens:
  Lambda:
    AuthenticationAlias: "arn:aws:lambda:region:account:function:auth:LIVE"
  Queue:
    Sales: "arn:aws:connect:region:account:instance/instance-id/queue/queue-id"
  # ... その他のトークン
```

### 3. AWS認証設定

GitHub OIDC プロバイダーを設定し、各環境用のロールを作成：

```bash
# AWS CLI でOIDCプロバイダー設定
aws iam create-open-id-connect-provider \
  --url https://token.actions.githubusercontent.com \
  --client-id-list sts.amazonaws.com
```

### 4. GitHub Environments設定

GitHub リポジトリで Environment を設定：
- `test` (自動デプロイ)
- `prod` (承認必須)

### 5. Secrets/Variables設定

GitHub リポジトリに以下を設定：

**Variables:**
- `AWS_TEST_DEPLOY_ROLE_ARN`
- `AWS_PROD_DEPLOY_ROLE_ARN` 
- `AWS_TEST_DRIFT_ROLE_ARN`
- `AWS_PROD_DRIFT_ROLE_ARN`

## 🛠️ 使用方法

### 開発フロー

1. **フロー作成/編集**
   ```bash
   # デザイナーでフローを作成・編集後、エクスポート
   # flows/{FlowName}/flow.json.tmpl としてコミット
   ```

2. **正規化**
   ```bash
   npm run normalize
   ```

3. **検証**
   ```bash
   npm run validate
   ```

4. **ローカルレンダリング**
   ```bash
   npm run render -- --env test --output ./dist/test
   ```

### CI/CD フロー

1. **PR作成** → 自動検証実行
2. **main マージ** → TEST環境自動デプロイ
3. **リリースタグ** → PROD環境承認後デプロイ

```bash
# リリースタグ例
git tag release-20251016-abc1234
git push origin release-20251016-abc1234
```

## 🔧 スクリプトコマンド

| コマンド | 説明 |
|---------|------|
| `npm run normalize` | フローJSONを正規化 |
| `npm run validate` | テンプレートと設定を検証 |
| `npm run render` | テンプレートをレンダリング |
| `npm run test` | テスト実行 |
| `npm run lint` | コードlint実行 |

### CDK コマンド

```bash
cd cdk

# 合成 
cdk synth --context environment=test

# デプロイ
cdk deploy --context environment=test --context flowsPath=../dist/test

# 差分確認
cdk diff --context environment=prod
```

## 🔍 トークンシステム

### トークン形式
- `${Service.Entity[.Variant]}`
- 例: `${Lambda.InvokeAlias}`, `${Queue.Sales}`, `${Prompt.WelcomeJa}`

### 対応サービス
- **Lambda**: Alias ARN
- **Queue**: Connect ARN  
- **Prompt**: Connect ARN
- **Lex**: Connect ARN
- **PhoneNumber**: E.164形式

### 使用例

```json
{
  "LambdaFunctionARN": "${Lambda.AuthenticationAlias}",
  "QueueId": "${Queue.Sales}",
  "PromptId": "${Prompt.WelcomeJa}",
  "PhoneNumber": "${PhoneNumber.Main}"
}
```

## 🧪 テスト

```bash
# すべてのテスト実行
npm test

# カバレッジ付きテスト
npm test -- --coverage

# 特定テストファイル
npm test tests/integration.test.js
```

## 📊 監視・運用

### ドリフト検出
- 毎夜23:00 JST に自動実行
- Connect APIから現在の設定を取得し、期待値と比較
- 差分があればGitHub Issueを自動作成

### Blue/Green デプロイ
1. 新バージョンのフローを作成
2. カナリア番号で小規模テスト (5%)
3. 段階的に拡大 (20% → 50% → 100%)
4. 問題があれば即座にロールバック

### ログ・監視
- CloudWatch Logs: `/aws/connect/{env}`
- カスタムメトリクス: `Connect/{Env}` namespace
- アラート: SNSトピック経由

## 🚨 トラブルシューティング

### よくある問題

1. **トークン未解決エラー**
   ```
   Token not found: Lambda.NonExistentAlias
   ```
   → `env/{environment}.yaml` でトークンが定義されているか確認

2. **ARN形式エラー**
   ```
   Invalid ARN format: invalid-arn
   ```
   → ARNの形式と対象リージョンを確認

3. **インスタンスID不一致**
   ```
   Instance ID mismatch in Connect ARN
   ```
   → Connect ARN内のインスタンスIDが設定と一致するか確認

4. **CDKデプロイエラー**
   ```
   Access denied for Connect operations
   ```
   → IAMロールの権限とAssumeRole設定を確認

### ロールバック手順

```bash
# 緊急ロールバック (入口を旧版に戻す)
node scripts/blue-green-controller.js --env prod --action rollback

# 設定をGitの前のバージョンに戻す
git revert <commit-hash>
git push origin main  # TEST環境に自動適用
```

## 📚 参考資料

- [README.md仕様書](./README.md) - 詳細な要件と設計
- [Amazon Connect API Reference](https://docs.aws.amazon.com/connect/latest/APIReference/)
- [AWS CDK Developer Guide](https://docs.aws.amazon.com/cdk/)
- [GitHub Actions Documentation](https://docs.github.com/actions)

## 🤝 コントリビューション

1. フローの変更はまず開発環境でテスト
2. PR作成前に `npm run validate` と `npm test` を実行  
3. 本番リリースは慎重に承認プロセスを経る
4. 問題発生時は即座にロールバック可能な状態を保つ

## 📞 サポート

- 技術的な問題: [GitHub Issues](https://github.com/your-org/amazon_connect_deploy/issues)
- 緊急時対応: 社内エスカレーション手順に従う
- ドキュメント更新: プルリクエストでご提案ください