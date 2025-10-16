# amazon_connect_deploy


# Amazon Connect フロー CI/CD 仕様書（GitHub Actions × CDK）
**版**: 1.0  
**日付**: 2025-10-16 (JST)  
**対象**: Amazon Connect のコンタクトフローおよび関連リソース（Queue/Prompt/Lex/Lambda 連携）を、**同一テンプレート＋環境Map（YAML）**方式で GitHub Actions から CDK デプロイするための要件・設計・運用手順（Runbook）。  
**注意**: 本書は**コードを含まない**アーキテクチャ/運用仕様である。

---

## 1. 目的とスコープ
- **目的**: 開発者が **開発環境（DEV）** のデザイナで作成・更新したコンタクトフローを、**テンプレート化**し、**環境Map**で依存値を注入、**GitHub Actions** で検証・昇格し、**CDK** により **TEST/PROD** に**再現可能**かつ**安全**にデプロイする。
- **スコープ**:
  - コンタクトフロー/フローモジュールの管理と昇格
  - Lambda 連携（IntegrationAssociation）と Invoke 権限付与の管理
  - Queue/Prompt/Lex 等の**参照整合性**の検証（生成自体は本パイプライン外でも可）
  - Blue/Green 切替、ドリフト検出、ロールバック
- **非スコープ**: 請求・コールセンター運用手順、音源制作（Prompt 音声）、エージェント端末管理。

---

## 2. 用語と前提
- **テンプレート**: デザイナから Export した JSON を正規化し、**環境依存値をトークン化**したファイル（例: `${Lambda.InvokeAlias}`）。
- **環境Map**: 各トークンに対する実値（ARN/ID/E.164 等）を記した YAML。環境別（dev/test/prod）。
- **レンダリング**: テンプレート × 環境Map → 実体 JSON を生成する処理。
- **昇格**: DEV → TEST → PROD の順に適用。
- **Blue/Green**: 新版フロー/バージョンを投入し、入口（電話番号/ルーティング）だけ切替。即時ロールバック可能。
- **前提**:
  - DEV/TEST/PROD は**別アカウント**または**最低でも別インスタンス**。
  - GitHub OIDC により AWS へ AssumeRole 可能。
  - デプロイ先 AWS アカウントに CDK 実行ロールが存在。

---

## 3. 役割と責任（RACI）
| 活動 | プロダクトオーナ | コンタクトフローデザイナ | クラウドエンジニア | セキュリティ/監査 |
|---|---|---|---|---|
| 要件定義/受電導線設計 | A | R | C | I |
| フロー編集（DEV） | I | R | C | I |
| Export/正規化/テンプレ登録 | I | R | C | I |
| 環境Map生成/更新 | I | C | R | I |
| CI 検証（PR） | I | C | R | I |
| TEST デプロイ/検証 | I | C | R | I |
| PROD リリース承認 | A | C | R | R |
| Blue/Green 切替 | I | C | R | I |
| ドリフト検出/監査 | I | I | R | A |
| インシデント対応/ロールバック | I | C | R | I |

注: R=Responsible, A=Accountable, C=Consulted, I=Informed

---

## 4. 成果物（アーティファクト）
- **テンプレート化フロー**: `flows/<FlowName>/flow.json.tmpl`  
  - 環境依存値は **トークン**で表現（`${Service.Entity[.Variant]}`）。
  - GUID/座標/最終編集者 等の**ノイズを削減**済み（差分が可読）。
- **フローモジュール**: `flows/<FlowName>/modules/*.module.json.tmpl`
- **環境Map**: `env/dev.yaml`, `env/test.yaml`, `env/prod.yaml`  
  - 可能な限り **IaC Outputs/SSM** から**自動生成**。
- **レンダリング結果**: `dist/<FlowName>.json`（CI 内部生成・永続化不要）
- **検証レポート**: スキーマ/整合性/差分レポート（PR コメント/Actions アーティファクト）
- **リリースメタデータ**: リリースタグ名、Git SHA、日時（Flow Metadata に埋め込む）。

---

## 5. 命名とトークン設計（規約）
- **トークン形式**: `${Service.Entity[.Variant]}`  
  - 例: `${Lambda.InvokeAlias}`, `${Queue.Sales}`, `${Prompt.WelcomeJa}`, `${Lex.BotV2}`
- **型の固定**:
  - Lambda: **Alias ARN**
  - Queue/Prompt/Lex: **Connect 配下 ARN**
  - PhoneNumber: **E.164** 形式
- **人可読名**を使用（ARN を名前にしない）
- **Flow 名称規約**: `<Domain><Purpose>`（例: `SalesEntry`）。バージョン付与は Metadata 側で実施（日時+短 SHA）。

---

## 6. 環境/アカウント構成
- **DEV**: デザイナ編集可。Export は**自動（スケジュール or 手動トリガ）**。CI でテンプレ/Lint まで。
- **TEST**: デザイナ編集不可。**CI からのみ更新**。合成テスト・回帰確認。
- **PROD**: デザイナ編集不可。**UI 直編集は明示 Deny**。手動承認必須。Blue/Green 切替のみ。

---

## 7. セキュリティ/権限制御（要件）
- **GitHub OIDC** による AWS AssumeRole（TEST/PROD 別ロール）。
- **最小権限**（例）:
  - Connect: Create/Update/Describe/Associate/Disassociate（必要範囲）
  - Lambda: Add/RemovePermission, Get*, (Invoke は不要)
  - CloudFormation または CDK 実行に必要最小
- **明示 Deny（PROD）**: `connect:UpdateContactFlowContent`, `connect:DeleteContactFlow*`（UI 直編集防止）
- **監査**: CloudTrail/Config/Actions ログ。リリースタグ紐付け。

---

## 8. 品質ゲート/検証要件
- **正規化検査**: テンプレにノイズなし（GUID/座標/編集者情報が差分に出ない）。
- **レンダリング検査**: すべてのトークンが解決済み。未解決があれば失敗。
- **型検査**: ARN 形式/リージョン一致/E.164 書式。
- **参照整合性**: Queue/Prompt/Lex/Lambda が **同一 Connect インスタンス配下**にあること。
- **静的検証**: 未接続ノード、未処理エラー分岐、即 Disconnect ブロック検出。
- **契約テスト**: 主要 Lambda 入出力のスナップショット（型/必須キー）。
- **統合テスト（TEST）**: 合成コール/ルーティング確認（PSTN 無しで可）。

---

## 9. CI/CD パイプライン（GitHub Actions）
### 9.1 トリガ
- **PR**: `flows/**` または `env/**` の変更で起動（検証のみ）。
- **main への push**: TEST へ自動デプロイ。
- **`release-*` タグ**: PROD へデプロイ（承認ゲート付き）。
- **スケジュール**: 毎夜ドリフト検出（JST 23:00 推奨）。

### 9.2 ステージ構成
1. **PR 検証**  
   - 正規化/Lint、レンダリング Dry-run、スキーマ/整合性検査、契約テスト。
   - 成果物: 検証レポート（PR コメント/アーティファクト）。
2. **TEST デプロイ（main）**  
   - レンダリング → 検証 → CDK 合成 → デプロイ。  
   - 合成テスト/健全性確認。  
   - 成果物: ジョブログ、デプロイ要約。
3. **PROD デプロイ（release タグ）**  
   - 手動承認（GitHub Environments）。  
   - レンダリング → 検証 → CDK 合成 → デプロイ。  
   - **Blue/Green 切替**（入口を段階的に新フローへ）。  
   - 事後監視（CTR、キュー滞留、Lambda エラー率）。  
   - 異常時は入口を旧版に**即戻す**。
4. **ドリフト検出（ナイトリー）**  
   - Connect API の現在 JSON と直近リリースのレンダリング結果を比較。差分があれば通知。  
   - 可能なら `cdk diff` も実行し、差分を保管。

### 9.3 GitHub 設定（非コード）
- **Environments**: `test`, `prod`（`prod` は Required reviewers で承認必須）。
- **Variables/Secrets**:  
  - Variables（環境別）: Connect インスタンス ARN/ID、Lambda Alias ARN、対象リージョン 他。  
  - Secrets: なし（OIDC 利用）。必要に応じて通知トークン等のみ。
- **OIDC 設定**: リポジトリと AWS ロールの信頼関係（`sub` に `repo:<ORG>/<REPO>:ref:*`）。

---

## 10. CDK 実行要件（非コード方針）
- **実行入力**:  
  - Connect インスタンス ARN（InstanceId を内部で導出可）  
  - レンダリング済みフロー JSON のパス（CI が生成）  
  - Lambda Alias ARN（フローが参照）
- **実行動作**:  
  - Lambda Invoke 権限（`connect.amazonaws.com`, SourceArn=InstanceArn）を付与  
  - IntegrationAssociation（`LAMBDA_FUNCTION`）を適用  
  - ContactFlow（content=レンダリング JSON）を作成/更新  
- **出力**: ContactFlow ARN（監査ログ/通知へ記録）。

---

## 11. Blue/Green 切替方針
- **新フロー/新バージョン**をデプロイ後、**入口（電話番号/エントリールーティング）**を新フローへ切替。
- **段階的適用**: カナリア番号 → メジャー番号（段階拡大）。
- **ロールバック**: 入口を旧フロー ARN に戻すだけ。旧版は常時温存（名称に日時+短 SHA）。
- **禁止時間帯**: 営業時間帯/特別アナウンス期間は切替禁止（Change Window）。

---

## 12. ドリフト管理
- **技術的手段**: `GetContactFlowContent` の JSON と直近リリースのレンダリング結果を比較。差分通知。  
- **権限制御**: PROD で UI 直編集を Deny。  
- **周期**: 毎夜 1 回 + 任意の手動実行。

---

## 13. 失敗モードと対処
| 失敗事象 | 検知 | 即時対処 | 恒久対策 |
|---|---|---|---|
| トークン未解決 | レンダリング検査で Fail | Map を修正 | Map 自動生成（IaC Outputs/SSM） |
| 参照不整合（別インスタンス ARN 等） | 整合性検査 | 値修正・再実行 | 検査強化（インスタンス ID 照合） |
| フロー静的エラー（未接続/即切断） | 静的検証 | フロー修正 | デザイナ版ルールの標準化 |
| Lambda 連携不可（権限不足） | 連携時エラー | Invoke 権限の追加 | 権限テンプレの標準化 |
| 本番切替で KPI 劣化 | 監視アラート | 旧版へ即ロールバック | カナリア比率/観測項目の見直し |
| UI 直編集によるドリフト | ドリフト検出/監査 | IaC 再適用 or 編集者是正 | 明示 Deny + 教育 |

---

## 14. SLA/非機能要件（推奨値）
- **PR 検証時間**: 10 分以内（並列実行で短縮）。
- **TEST 反映**: main 反映後 15 分以内。
- **PROD リリース**: 承認後 20 分以内（Blue/Green 切替含む）。
- **ロールバック**: 5 分以内（入口切替のみ）。
- **監査保管**: リリース記録・差分・アクションログを 1 年以上。

---

## 15. Runbook（運用手順）
### 15.1 日々の変更～TEST まで
1. **開発環境でフローを編集**（デザイナ）  
   - 命名/タグ規約に従う。複雑分岐は可能な限り Lambda 側へ寄せる。
2. **開発環境からフローを抽出（自動）**  
   - Export API/ツールで JSON を取得（スケジュール or 手動）。
3. **フローをテンプレート化**  
   - ARN/ID/E.164 を **トークンへ置換**。GUID/座標等のノイズ削減。README に変更意図を記載。
4. **デプロイ環境の依存性を注入（置換）**  
   - `env/test.yaml` を使用して**レンダリング**（CI が実行）。
5. **チェック**  
   - レンダリング・型・整合性・静的・契約テストに合格。PR をレビューし `main` へマージ。
6. **デプロイ（TEST）**  
   - Actions が自動で TEST に適用。合成テストで経路確認。必要に応じて修正。

### 15.2 本番リリース（PROD）
1. **リリースタグ付与**（`release-YYYYMMDD-<shortSHA>`）
2. **承認**（GitHub Environment）
3. **デプロイ**（PROD）: レンダリング → 検証 → CDK デプロイ
4. **Blue/Green 切替**  
   - カナリア番号で小規模検証 → 段階的拡大 → 全体切替。
5. **事後監視**  
   - CTR、キュー滞留、Lambda エラー率、顧客待ち時間。NG なら**直ちに旧版へ戻す**。

### 15.3 ドリフト検出/是正
- **毎夜**: 本番 JSON と直近リリースのレンダリング結果を比較。差分通知。  
- **差分あり**: 原因調査 → 正規化テンプレへ反映 or 権限見直し → 再デプロイ。

### 15.4 障害対応（インシデント）
- **症状**: 通話断/誤ルーティング/異常待ち時間
- **即時対応**: 旧版フローへ入口ロールバック、または緊急用簡易 IVR へ切替。
- **恒久対策**: 回帰テスト強化、危険ブロック検査ルール追加、観測ダッシュボードの閾値調整。

---

## 16. 導入チェックリスト
- [ ] DEV/TEST/PROD のインスタンスとアカウントが分離済み  
- [ ] GitHub OIDC → AWS AssumeRole が構成済み（TEST/PROD）  
- [ ] 環境Map 自動生成の仕組み（IaC Outputs/SSM 収集）が用意済み  
- [ ] 正規化ルール（トークン置換・ノイズ削減）が策定・実装済み  
- [ ] 検証ルール（型/整合性/静的/契約）が CI に実装済み  
- [ ] Blue/Green 手順とロールバック手順が文書化・訓練済み  
- [ ] PROD の UI 直編集が **Deny** 済み（IAM/SCP）  
- [ ] 監査ログの保管/検索性が担保されている

---

## 17. リスクと制約
- Connect 機能追加に伴う JSON 仕様変化 → 正規化/検証ルールの追随が必要。  
- 環境Map の“手管理”による腐敗 → 自動生成とレビューにより低減。  
- 人為的 UI 直編集 → 明示 Deny + ドリフト監視で低減。

---

## 18. 成功基準（KPI）
- PR 検証合格率、TEST→PROD 昇格リードタイム、ロールバック平均時間、ドリフト発生件数、リリース後 24h のアラート件数。

---

## 付録 A: 変更履歴
- 1.0（2025-10-16）初版
