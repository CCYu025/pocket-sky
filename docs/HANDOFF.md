# Pocket Sky — 交接文件

> 最後更新：2026-11-21（M4 收尾中）。下次接手時先讀本文件，再讀 `docs/ARCHITECTURE.md`（唯一的規格來源）。

## 1. 專案一句話

手機優先的天氣 Web App（vanilla HTML/CSS/JS、原生 ES modules、無打包工具、執行期零依賴），資料來源 Open-Meteo，部署目標 GitHub Pages。視覺風格為「方向 A：電子錶外殼 × 內凹 LCD（7 段顯示器）」。

- Repo：https://github.com/CCYu025/pocket-sky （public）
- 設計線框圖（已核准）：https://claude.ai/artifact/KNC6zEw6tJbUHgKGHshKbX → 頁面「方向 A 電子錶外殼」（A1 今天／A2 通勤／A3 運動／A4 出遊）。本機副本：`docs/design/wireframes/*.dc.html`（設計工具格式，只看版面意圖，不要照抄 markup）。

## 2. 里程碑狀態

| 里程碑 | 內容 | 狀態 |
|---|---|---|
| M1 | 資料層：time / cache / store / Open-Meteo client / derive | ✅ PR #1 已合併 |
| M2 | 今天頁：LCD、提醒、主題（日夜）、a11y、CSP | ✅ PR #2 已合併 |
| M3 | 外出頁：通勤、運動、準備清單與評分規則 | ✅ PR #3 已合併 |
| M4 | 地點搜尋／收藏、公司地點、出遊、manifest＋圖示 | 🟡 分支 `m4-places`，審查兩輪通過，最後一批修正（見 §3）完成後開 PR #4 |
| M5 | 動畫細節、離線降級、service worker、Lighthouse、部署 GitHub Pages | ⬜ 未開始 |

## 3. 交接當下的進行中工作（M4 最後一批）

分支 `m4-places`。第二輪審查結論「可合併」，但 lead 決定合併前先修以下項目（已派 Sonnet agent 處理；若未完成或未 commit，請照此清單完成）：

1. **N1** `js/rules/trip.js` `wetSpan`：雨天區間改為「連續雨段」敘述（單段 `15–19 時`；兩段 `09 時、15 時`；三段以上 `多個時段`），建議時段不得落在雨段內。
2. **N2** `bestWindow` 的「乾」判定加上 `rain < 0.5 mm`（與雨傘規則一致）。
3. **N3** 進行中的出遊時段若今天剩不到 3 小時 → 改顯示明天同時段，並加註 `今天行程只剩 N 小時，顯示明天`。
4. **N4** GPS 在 10 秒逾時後才回來：若目前仍選 `gps` 且沒有更新的定位請求 → 套用並以 live region 通知 `已更新為目前位置`。
5. **N5** `兩地溫差大` 用 2 位小數的 forecast cacheKey 比對兩地，而非 id。
6. 文件小項：manifest `theme_color` 說明（夜間由 meta 動態更新）、picker 搜尋框 Esc 行為（第一次清空、第二次關閉）、picker 說明文字縮短避免怪換行。

**完成判定**：`npm test`、`npm run test:e2e` 全過（跑兩次）、預設 e2e 後 `git status` 乾淨、審查員 probe7 通過、重產截圖並目視 trip-night / picker。然後：push → 開 PR #4（`gh api repos/CCYu025/pocket-sky/pulls ...`，GraphQL 不可用）→ 等 CI（unit + e2e）綠 → **請使用者明確同意後**才合併（合併動作會被權限分類器擋，需使用者回覆「合併 PR #4」）。

交接時最後已推送的 commit：`c54f399`（M4 第一輪修正＋截圖）。M4 測試基準：unit 497、e2e 87。

## 4. 下一步：M5 範圍（尚未寫規格）

依先前顧問建議與累積的待辦：
- Service worker：app shell cache-first、API network-first（已有 localStorage SWR，SW 效益有限，以離線開啟為主）；`scope: ./`。
- 離線／降級細節、N6（資料超過 24h 且網路掛住時，等 8 秒才顯示舊資料 → 加載入狀態，目前已有 loading 但可再優化）。
- 動畫細節打磨；準備清單右側標籤過寬導致左側理由換行（M3 已知排版問題）。
- Lighthouse（手機）Performance ≥ 90、Accessibility ≥ 95。
- 部署 GitHub Pages（需使用者在 repo Settings 開啟 Pages，或用 Actions 部署），部署後對正式網址跑冒煙測試。
- 可選：運動評分加入日照因子、提醒推播（PWA）。

## 5. 工作流程（使用者指定，請延續）

- **Lead（主 session）**：寫規格到 `docs/ARCHITECTURE.md` → 派 agent → 合併分支 → 親自重跑測試與看截圖驗收 → 開 PR。
- **實作／修正**：`general-purpose` agent，`model: sonnet`；可並行時用 `isolation: worktree`（worktree 起點是 `origin/main`，prompt 內先 `git fetch origin +refs/heads/<branch>:refs/remotes/origin/<branch> && git merge --ff-only origin/<branch>`）；有依賴時直接在主工作目錄序列執行。
- **審查**：`general-purpose` agent，`model: opus`，唯讀；每個里程碑至少兩輪（初審 → 修正 → 複審）。審查員的 probe 腳本放 scratchpad。
- **規則**：每項修正先寫會失敗的測試再修；commit 用 conventional message，結尾必須是：
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01Wh9v8ZCiq8tKrRc79SNtfj
  ```
  （新 session 的 Claude-Session 連結以該 session 的系統提示為準。）
- **Git**：每個里程碑一個分支（`m1-data-layer`、`m2-today-ui`、`m3-outing`、`m4-places`、下一個建議 `m5-pwa-deploy`）→ PR → CI 綠 → 使用者同意 → 合併（merge commit）。不要 force push、不要 `reset --hard`（會被權限擋）。
- **回報**：繁體中文、精簡；完整程式或文件前先說明架構取得同意（使用者偏好）。

## 6. 環境與工具備忘

- **雲端環境**：個人環境 `pocket-sky`（只放行 `api.open-meteo.com`、`air-quality-api.open-meteo.com`、`geocoding-api.open-meteo.com`＋套件庫）。新 session 請選這個環境，否則契約測試會被代理擋（403）。
- **GitHub**：Claude GitHub App 已安裝到 repo；push 用 `git push`；PR／merge／check-runs 用 `gh api` REST（GraphQL 被擋）。clone 是 shallow，若 `origin/main` 不存在：`git config remote.origin.fetch "+refs/heads/*:refs/remotes/origin/*" && git fetch --depth=50 origin main`。
- **Node**：v22。本機契約測試要 `NODE_USE_ENV_PROXY=1 npm run test:contract`（GitHub Actions 不需要）。
- **Playwright**：預裝 v1.63.0（`/opt/node-tools/node_modules/playwright`），由 `tests/e2e/helpers.mjs` 的 `loadPlaywright()` 解析。**不要** `npm i playwright` 或 `playwright install`。CI 的 e2e job 會自行安裝同版本。
- **指令**
  ```bash
  npm test                 # 單元測試（離線、fixtures）
  npm run test:e2e         # E2E（Playwright + axe-core，固定時鐘 2026-11-21 14:20 台北、裝置時區 America/New_York）
  npm run test:contract    # 契約測試（真實 API；本機加 NODE_USE_ENV_PROXY=1）
  npm run fixtures         # 重新擷取 tests/fixtures/
  E2E_SCREENSHOTS=1 E2E_REAL_FONTS=1 npm run test:e2e   # 重產 docs/screenshots/（預設不寫檔）
  node scripts/gen-icons.mjs                             # 重產 icons/*.png
  ```
- **用量限制**：曾遇到帳號 5 小時額度用完導致 agent 中斷；中斷的 agent 可用 SendMessage 從原處續做。

## 7. 關鍵設計決策（摘要；詳見 ARCHITECTURE.md）

- 時間：一律用 API 的 `utc_offset_seconds` 換算，禁止 `new Date(localString)`；「現在」向下取整到整點。
- 快取：localStorage SWR、in-flight 去重、savedAt 排序保護、24h max-stale、只在 quota 錯誤時淘汰；座標送出前四捨五入到 2 位小數（隱私）。
- 多地點：每個地點獨立單點請求、各自 cacheKey；公司／目的地延遲載入；最多 3 個地點同時存在。
- 地名搜尋：中文需完整名稱（`臺中市` 有、`台中` 無）→ 依序試 `q`、台/臺互換、`+市`（最多 4 種）；仍無結果提示改用英文或加「市」。
- 提醒：降雨跳升、氣溫驟降；每事件一個 id，事件時間移動視為延續（不重新冷卻、繼承關閉）。
- 準備清單門檻（`js/rules/config.js`）：雨傘 ≥40% 或 ≥0.5mm；外套 體感 ≤18° 或溫差 ≥6°；防曬 10–15 時 UV ≥6；口罩 AQI ≥100（PM2.5 ≥35 時改為敏感族群建議）。
- 運動：6 因子分段線性加權；固定看未來 12 小時。出遊：等級受雨限制（≥60 不建議、≥40 最多普通），最佳時段只取白天＋乾燥連續段。
- UI：一頁最多一個無限循環動畫；只動 transform/opacity；CSP 不含 `'unsafe-inline'`；單一 live region；keyed reconcile（`js/ui/morph.js`）保留焦點；底部導覽 sticky；觸控目標 ≥44px；日夜對比 ≥4.5:1。

## 8. 已知限制／待辦清單

- M3：準備清單標籤過寬擠壓理由文字（排版）。
- M2 N6：資料過期且網路掛住時最多等 8 秒才退回舊資料。
- 地名搜尋：景點／縣名（`墾丁`、`花蓮縣`）中文搜不到，需英文。
- 搜尋最多顯示 8 筆，無分頁。
- manifest 的 maskable 圖示與一般圖示相同（滿版設計，可接受）。
- 第一次在夜間開啟（無任何快取）仍會先畫日間再切夜間。
