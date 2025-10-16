# Amazon Connect CI/CD パイプライン - 実践チュートリアル

## 🎯 このチュートリアルで学ぶこと

実際のContact Flowを使って、開発から本番リリースまでの完全なワークフローを体験します。

## 📚 シナリオ: カスタマーサポート向けContact Flow作成

新しい「カスタマーサポート受付フロー」を作成し、TEST環境を経てPROD環境にリリースします。

---

## Step 1: 開発環境準備

### 1-1. リポジトリのセットアップ
```bash
# プロジェクトディレクトリに移動
cd amazon_connect_deploy

# 最新の状態に更新
git pull origin main

# 作業ブランチ作成
git checkout -b feature/customer-support-flow
```

### 1-2. 現在の環境設定確認
```bash
# 設定ファイル確認
cat env/dev.yaml
cat env/test.yaml
cat env/prod.yaml
```

---

## Step 2: Amazon Connect デザイナーでフロー作成

### 2-1. Amazon Connect管理画面にログイン
1. AWS Console → Amazon Connect → インスタンス選択
2. 「Contact flows」をクリック
3. 「Create contact flow」をクリック

### 2-2. 基本的なサポートフローを設計

**フロー例**: CustomerSupportEntry
```
[Start] 
  ↓
[Play prompt: "サポートセンターへお電話いただき、ありがとうございます"]
  ↓ 
[Get customer input: "1番：技術サポート、2番：請求に関するお問い合わせ"]
  ↓
[Decision based on input]
  ├─ 1 → [Transfer to queue: TechnicalSupport]
  ├─ 2 → [Transfer to queue: Billing] 
  └─ Other → [Play prompt: "申し訳ございません"] → [Disconnect]
```

### 2-3. 重要：環境依存値の仮設定
デザイナーでは以下の値を仮で設定（後でトークン化）：
- **Queue ARN**: 開発環境の実際のキューを使用
- **Prompt ARN**: 開発環境の実際のプロンプトを使用
- **Lambda ARN**: 開発環境の実際のLambda ARNを使用

### 2-4. フローの保存とエクスポート
1. 「Save」でフローを保存
2. 「Export flow (Legacy)」をクリック
3. `CustomerSupportEntry_exported.json` として保存

---

## Step 3: フローのテンプレート化

### 3-1. エクスポートファイルの正規化
```bash
# ダウンロードしたJSONファイルを正規化
node scripts/normalize.js --file ~/Downloads/CustomerSupportEntry_exported.json --output flows/CustomerSupportEntry/flow.json.tmpl
```

### 3-2. 出力結果確認
```bash
# 正規化されたテンプレートファイルを確認
cat flows/CustomerSupportEntry/flow.json.tmpl
```

### 3-3. 環境依存値をトークンに置換

`flows/CustomerSupportEntry/flow.json.tmpl` を編集：

**置換前（例）:**
```json
{
  "Type": "SetQueue",
  "Parameters": {
    "QueueId": "arn:aws:connect:us-east-1:123456789012:instance/12345678-1234-1234-1234-123456789012/queue/abcdef12-3456-7890-abcd-ef1234567890"
  }
}
```

**置換後:**
```json
{
  "Type": "SetQueue", 
  "Parameters": {
    "QueueId": "${Queue.TechnicalSupport}"
  }
}
```

### 3-4. 必要な環境変数を env ファイルに追加

`env/dev.yaml`、`env/test.yaml`、`env/prod.yaml` に以下を追加：
```yaml
Queue:
  TechnicalSupport: "arn:aws:connect:us-east-1:123456789012:instance/12345678-1234-1234-1234-123456789012/queue/tech-support-queue-id"
  Billing: "arn:aws:connect:us-east-1:123456789012:instance/12345678-1234-1234-1234-123456789012/queue/billing-queue-id"

Prompt:
  WelcomeMessage: "arn:aws:connect:us-east-1:123456789012:instance/12345678-1234-1234-1234-123456789012/prompt/welcome-prompt-id"
  InvalidInput: "arn:aws:connect:us-east-1:123456789012:instance/12345678-1234-1234-1234-123456789012/prompt/invalid-input-prompt-id"
```

---

## Step 4: ローカル検証

### 4-1. テンプレート構文検証
```bash
# テンプレートの検証
node scripts/validate.js --template flows/CustomerSupportEntry/flow.json.tmpl --env env/dev.yaml
```

**期待する出力:**
```
✅ Template syntax: Valid
✅ Environment mapping: All tokens resolved
✅ ARN format validation: Passed  
✅ Reference integrity: Passed
✅ Schema validation: Passed
```

### 4-2. レンダリングテスト
```bash
# DEV環境用にレンダリング
node scripts/render.js --template flows/CustomerSupportEntry/flow.json.tmpl --env env/dev.yaml --output dist/CustomerSupportEntry-dev.json

# 結果確認
cat dist/CustomerSupportEntry-dev.json
```

### 4-3. 基本テスト実行
```bash
npm test
```

---

## Step 5: Git commit と Pull Request

### 5-1. 変更をコミット
```bash
# 変更内容確認
git status
git diff

# ファイル追加
git add flows/CustomerSupportEntry/
git add env/dev.yaml env/test.yaml env/prod.yaml

# コミット
git commit -m "feat: カスタマーサポート受付フローを追加

- 技術サポートと請求問い合わせの振り分け
- 無効入力時のエラーハンドリング
- Queue.TechnicalSupport、Queue.Billing トークンを追加"
```

### 5-2. リモートにプッシュ
```bash
git push origin feature/customer-support-flow
```

### 5-3. Pull Request作成
1. GitHubリポジトリページを開く
2. 「Compare & pull request」をクリック
3. 以下の内容でPull Requestを作成：

**Title:** `feat: カスタマーサポート受付フローを追加`

**Description:**
```markdown
## 概要
新しいカスタマーサポート受付フローを実装

## 変更内容
- CustomerSupportEntry フローテンプレートを追加
- 技術サポート（1番）と請求問い合わせ（2番）の振り分け機能
- 無効入力時のエラーハンドリング

## 追加されたトークン
- `Queue.TechnicalSupport`
- `Queue.Billing`
- `Prompt.WelcomeMessage`
- `Prompt.InvalidInput`

## テスト状況
- [x] ローカル検証 (normalize, render, validate)
- [x] 基本テスト合格
- [ ] CI/CD自動検証 (PR作成後に実行)

## 確認依頼
- フローロジックの確認
- 環境設定値の妥当性確認
```

---

## Step 6: CI/CD 自動検証の確認

### 6-1. GitHub Actions実行確認
1. Pull Requestページの「Checks」タブを確認
2. 以下のチェックが自動実行される：
   - ✅ **Lint & Syntax Check**: TypeScript/JSON構文チェック
   - ✅ **Template Validation**: テンプレート検証
   - ✅ **Rendering Test**: 全環境でのレンダリングテスト
   - ✅ **Schema Validation**: Contact Flowスキーマ検証
   - ✅ **Reference Integrity**: 参照整合性チェック
   - ✅ **Security Scan**: セキュリティ脆弱性チェック

### 6-2. 検証結果の確認
成功時：
```
✅ All checks have passed
✅ Template renders successfully for all environments  
✅ No security vulnerabilities found
✅ Reference integrity maintained
```

失敗時の例：
```
❌ Template validation failed
❌ Unresolved token: ${Queue.CustomerService}
```

### 6-3. 失敗時の対処
```bash
# ローカルで修正
git checkout feature/customer-support-flow
# ファイル修正...
git add .
git commit -m "fix: 不足していたQueue.CustomerServiceトークンを追加"
git push origin feature/customer-support-flow
```

---

## Step 7: TEST環境への自動デプロイ

### 7-1. Pull Requestをマージ
1. レビュー完了後、「Merge pull request」をクリック
2. 「Confirm merge」をクリック

### 7-2. 自動デプロイの確認
マージ後、自動的にTEST環境へのデプロイが開始：

1. GitHub リポジトリの「Actions」タブを確認
2. 「Deploy to TEST」ワークフローの実行状況を監視

**デプロイステップ:**
```
🔄 Checkout code
🔄 Setup Node.js
🔄 Install dependencies  
🔄 Render templates (TEST environment)
🔄 Validate rendered flows
🔄 Setup AWS credentials
🔄 CDK Deploy to TEST
🔄 Post-deployment verification
```

### 7-3. TEST環境での動作確認
```bash
# TEST環境のConnect インスタンスで確認
aws connect describe-contact-flow \
  --instance-id ${TEST_INSTANCE_ID} \
  --contact-flow-id ${DEPLOYED_FLOW_ID}
```

---

## Step 8: PROD環境へのリリース

### 8-1. リリースタグの作成
```bash
# mainブランチに移動
git checkout main
git pull origin main

# リリースタグ作成 (日付 + Git SHA)
export RELEASE_TAG="release-$(date +%Y%m%d)-$(git rev-parse --short HEAD)"
echo "Creating release: $RELEASE_TAG"

git tag $RELEASE_TAG
git push origin $RELEASE_TAG
```

### 8-2. PROD環境デプロイの承認
1. GitHub リポジトリの「Actions」タブを開く
2. 「Deploy to PROD」ワークフローを確認
3. **Approval Required** の状態で停止
4. 「Review deployments」をクリック
5. チェックボックスにチェックを入れて「Approve and deploy」をクリック

### 8-3. PROD環境デプロイの監視
```
🔄 Waiting for approval... ✅ 
🔄 Checkout code
🔄 Render templates (PROD environment)
🔄 Validate rendered flows  
🔄 CDK Deploy to PROD
🔄 Blue/Green deployment
🔄 Post-deployment monitoring
```

### 8-4. Blue/Green 切り替え確認
デプロイ完了後、段階的にトラフィックを新しいフローに移行：

1. **カナリア**: 5%のトラフィックを新フローに
2. **段階拡大**: 問題なければ25% → 50% → 100%  
3. **監視**: KPI（応答時間、エラー率、顧客満足度）を確認

---

## Step 9: 運用監視とメンテナンス

### 9-1. リリース後の監視
以下のメトリクスを24時間監視：
- **Call成功率**: 95%以上維持
- **平均待ち時間**: 2分以下
- **Lambda エラー率**: 1%以下
- **フロー完了率**: 90%以上

### 9-2. 問題発生時のロールバック
```bash
# 緊急時の即座ロールバック
aws connect update-phone-number \
  --phone-number-id ${PHONE_NUMBER_ID} \
  --contact-flow-id ${PREVIOUS_FLOW_ID}
```

### 9-3. ドリフト監視
毎晩のドリフト検出レポートを確認：
```
📧 Drift Detection Report - CustomerSupportEntry
✅ No configuration drift detected
📊 Last deployment: 2025-01-15 14:30 JST
🔗 Flow ARN: arn:aws:connect:us-east-1:123456789012:instance/.../contact-flow/...
```

---

## 🎉 チュートリアル完了！

**おめでとうございます！** カスタマーサポートフローの開発から本番リリースまでの完全なワークフローを実践しました。

### 学習した内容
✅ Amazon Connect デザイナーでのフロー作成  
✅ フローのテンプレート化とトークン管理  
✅ ローカル検証ツールの使用方法  
✅ Git workflow とPull Request プロセス  
✅ CI/CD パイプラインによる自動検証・デプロイ  
✅ Blue/Green デプロイメントとロールバック  
✅ 運用監視とメンテナンス  

### 次のステップ
- 他のContact Flow（アウトバウンドコール、チャットボット連携など）の実装
- Lambda関数との連携強化
- 高度な分析とモニタリングの導入
- チーム開発のベストプラクティス適用

---

**🚀 Amazon Connect CI/CDパイプラインを使って、効率的で安全なContact Flow開発を実現しましょう！**