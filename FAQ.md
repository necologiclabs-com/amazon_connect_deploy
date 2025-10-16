# FAQ & トラブルシューティング

## 🙋‍♂️ よくある質問 (FAQ)

### Q1: このシステムを使う前に何を準備すべきですか？

**A:** 以下が必要です：
- **AWS アカウント**: DEV/TEST/PROD 環境（別アカウント推奨）
- **Amazon Connect インスタンス**: 各環境に1つずつ
- **IAM権限**: Connect、Lambda、CDK実行に必要な権限
- **GitHub OIDC**: AWSへのAssumeRole設定
- **Node.js 18+**: ローカル開発環境

詳細は[USAGE.md](./USAGE.md)の「前提条件」を参照してください。

### Q2: 既存のContact Flowをこのシステムに移行できますか？

**A:** はい、可能です：
1. 既存フローをAmazon Connectデザイナーからエクスポート
2. `normalize.js`で正規化処理
3. 環境依存値（ARN等）をトークンに手動置換
4. `env/*.yaml`に対応する値を設定

```bash
# 既存フローの移行例
node scripts/normalize.js --file existing-flow.json --output flows/ExistingFlow/flow.json.tmpl
```

### Q3: トークンの命名規則はありますか？

**A:** はい、以下の規則に従ってください：
- **形式**: `${Service.Entity[.Variant]}`
- **Lambda**: `${Lambda.FunctionName}` (Alias ARN)
- **Queue**: `${Queue.QueueName}` (Connect ARN)
- **Prompt**: `${Prompt.PromptName}` (Connect ARN)  
- **Phone**: `${Phone.NumberName}` (E.164形式)
- **Lex**: `${Lex.BotName}` (Bot ARN)

### Q4: 本番環境でのロールバック方法は？

**A:** 複数の方法があります：

**即座ロールバック（推奨）:**
```bash
# 電話番号の受信フローを前バージョンに変更
aws connect update-phone-number \
  --phone-number-id ${PHONE_NUMBER_ID} \
  --contact-flow-id ${PREVIOUS_FLOW_ID}
```

**Git タグベースロールバック:**
```bash
git tag rollback-$(date +%Y%m%d) <previous-commit>
git push origin --tags
```

### Q5: 複数の開発者で作業する場合の注意点は？

**A:** 以下のベストプラクティスを推奨：
- **ブランチ戦略**: feature/ ブランチで個別開発
- **env/ ファイル**: 環境固有の変更は別PR
- **テスト**: ローカル検証を必ず実行してからPR作成
- **レビュー**: Contact Flowロジックと環境設定を分けてレビュー

### Q6: パフォーマンスに影響はありますか？

**A:** 通話フローへの影響はありません：
- **フロー実行**: Amazon Connect標準性能
- **デプロイ時間**: TEST環境へ10-15分、PROD環境へ15-20分
- **レンダリング**: 数秒〜1分程度（ローカル）

---

## 🔧 トラブルシューティング

### 🚨 エラー分類と対処法

#### 1. Template Validation Errors

**エラー例:**
```
❌ Template validation failed: Unresolved token ${Queue.NewQueue}
```

**原因**: 
- トークンが `env/*.yaml` で定義されていない
- トークン名の不一致

**対処法:**
```yaml
# env/dev.yaml に以下を追加
Queue:
  NewQueue: "arn:aws:connect:us-east-1:123456789012:instance/abc123/queue/def456"
```

**確認コマンド:**
```bash
node scripts/validate.js --template flows/YourFlow/flow.json.tmpl --env env/dev.yaml
```

---

#### 2. ARN Format Errors

**エラー例:**
```
❌ Invalid ARN format: Queue ARN must be Connect resource ARN
```

**原因**:
- ARN形式が正しくない
- 異なるサービスのARNを使用

**対処法:**
```yaml
# ❌ 間違い
Queue:
  Sales: "arn:aws:sqs:us-east-1:123456789012:queue/sales-queue"

# ✅ 正しい  
Queue:
  Sales: "arn:aws:connect:us-east-1:123456789012:instance/abc123/queue/def456"
```

**ARN形式チェック:**
```bash
# Connect リソースARNの正しい形式
arn:aws:connect:${region}:${account}:instance/${instance-id}/${resource-type}/${resource-id}
```

---

#### 3. Reference Integrity Errors

**エラー例:**
```
❌ Reference integrity check failed: Queue belongs to different Connect instance
```

**原因**:
- 複数のConnect インスタンスのARNが混在
- 環境間でinstance IDが異なる

**対処法:**
```bash
# 現在の設定確認
grep -r "instance/" env/

# インスタンスIDの統一確認
aws connect list-instances --query "InstanceSummaryList[*].[InstanceId,InstanceAlias]" --output table
```

---

#### 4. CDK Deployment Errors

**エラー例:**
```
❌ CDK Deploy failed: Access Denied
```

**原因**:
- AWS認証情報の不足
- IAM権限不足
- CDKブートストラップ未実行

**対処法:**
```bash
# 1. AWS認証確認
aws sts get-caller-identity

# 2. CDKブートストラップ実行
cd cdk
npx cdk bootstrap

# 3. IAM権限確認
aws iam get-role --role-name CDKExecutionRole
```

**必要なIAM権限:**
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "connect:*",
        "lambda:AddPermission",
        "lambda:RemovePermission",
        "cloudformation:*"
      ],
      "Resource": "*"
    }
  ]
}
```

---

#### 5. GitHub Actions Workflow Errors

**エラー例:**
```
❌ Workflow failed: Environment variables not set
```

**原因**:
- GitHub Secrets/Variables未設定
- OIDC設定不備

**対処法:**

**GitHub Variables設定:**
```bash
# Repository Settings > Secrets and variables > Actions > Variables
CONNECT_INSTANCE_ID_DEV=12345678-1234-1234-1234-123456789012
CONNECT_INSTANCE_ID_TEST=87654321-4321-4321-4321-876543218765
CONNECT_INSTANCE_ID_PROD=11111111-2222-3333-4444-555555555555
AWS_REGION=us-east-1
```

**OIDC Trust Relationship確認:**
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Federated": "arn:aws:iam::123456789012:oidc-provider/token.actions.githubusercontent.com"
      },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "token.actions.githubusercontent.com:sub": "repo:necologiclabs-com/amazon_connect_deploy:ref:refs/heads/main"
        }
      }
    }
  ]
}
```

---

#### 6. Runtime / Contact Flow Execution Errors

**エラー例:**
```
❌ Contact flow execution failed: Lambda function timeout
```

**原因**:
- Lambda関数のタイムアウト
- Lambda関数のデプロイ不備
- Connect権限不足

**対処法:**
```bash
# 1. Lambda関数確認
aws lambda get-function --function-name your-function-name

# 2. Lambda権限確認
aws lambda get-policy --function-name your-function-name

# 3. Connect-Lambda統合確認
aws connect list-integration-associations --instance-id ${INSTANCE_ID}
```

**Connect-Lambda権限設定:**
```bash
aws lambda add-permission \
  --function-name your-function-name \
  --statement-id connect-invoke \
  --action lambda:InvokeFunction \
  --principal connect.amazonaws.com \
  --source-arn arn:aws:connect:us-east-1:123456789012:instance/${INSTANCE_ID}
```

---

### 🔍 診断コマンド集

#### システム全体チェック
```bash
# 1. 依存関係チェック
npm audit

# 2. 全環境の設定検証
for env in dev test prod; do
  echo "=== Validating $env ==="
  node scripts/validate.js --env env/$env.yaml
done

# 3. 全テンプレートのレンダリングテスト
find flows/ -name "*.tmpl" -exec node scripts/render.js --template {} --env env/test.yaml \;
```

#### AWS リソース確認
```bash
# Connect インスタンス確認
aws connect describe-instance --instance-id ${INSTANCE_ID}

# Contact Flow一覧
aws connect list-contact-flows --instance-id ${INSTANCE_ID}

# Lambda関数一覧  
aws lambda list-functions --query "Functions[?starts_with(FunctionName, 'connect')]"

# Queue一覧
aws connect list-queues --instance-id ${INSTANCE_ID}
```

#### GitHub Actions デバッグ
```bash
# ローカルでGitHub Actions環境を再現
# (act ツールを使用)
act pull_request

# GitHub CLI でワークフロー実行状況確認
gh run list --repo necologiclabs-com/amazon_connect_deploy
gh run view ${RUN_ID} --repo necologiclabs-com/amazon_connect_deploy
```

---

### 📊 監視とアラート

#### 重要メトリクス
- **Contact Flow成功率**: > 95%
- **平均処理時間**: < 30秒
- **Lambda エラー率**: < 1%
- **キュー待ち時間**: < 2分

#### CloudWatch メトリクス
```bash
# Contact Flow メトリクス取得
aws cloudwatch get-metric-statistics \
  --namespace AWS/Connect \
  --metric-name ContactFlowTime \
  --dimensions Name=InstanceId,Value=${INSTANCE_ID} Name=ContactFlowName,Value=${FLOW_NAME} \
  --start-time $(date -u -d '1 hour ago' +%Y-%m-%dT%H:%M:%S) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
  --period 300 \
  --statistics Average,Maximum
```

---

### 🆘 緊急時対応

#### 障害レベル別対応

**Level 1: 軽微な問題**
- 設定値の誤り
- 特定フローのエラー

**対応**: 修正PR作成 → レビュー → マージ

**Level 2: 中程度の問題**  
- 複数フローの影響
- 性能劣化

**対応**: 即座ロールバック → 原因調査 → 修正版リリース

**Level 3: 重大な障害**
- 全フロー停止
- 顧客影響大

**対応**: 
1. 即座ロールバック（1分以内）
2. インシデント対策本部設置
3. 根本原因分析 
4. 再発防止策実装

#### 緊急連絡先
```yaml
# インシデント発生時連絡先
Primary: "Slack #connect-emergency"
Secondary: "Email: connect-support@company.com"  
Escalation: "Phone: +81-XX-XXXX-XXXX (24時間対応)"
```

---

### 📚 参考資料

- [Amazon Connect API リファレンス](https://docs.aws.amazon.com/connect/latest/APIReference/)
- [AWS CDK Developer Guide](https://docs.aws.amazon.com/cdk/v2/guide/)
- [GitHub Actions Documentation](https://docs.github.com/en/actions)
- [Contact Flow言語リファレンス](https://docs.aws.amazon.com/connect/latest/adminguide/contact-flow-language.html)

---

**🚨 問題解決できない場合は、GitHub Issueを作成するか、サポートチームにお問い合わせください。**