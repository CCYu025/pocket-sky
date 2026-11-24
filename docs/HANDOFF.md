# Pocket Sky — 交接文件

> 最後更新：2026-11-24（App M1–M5 完成並上線；宣傳影片完成，製作流程已併入 `promo/`）。下次接手時先讀本文件，再讀 `docs/ARCHITECTURE.md`（App 的唯一規格來源）與 `promo/README.md`（影片流程）。

## 1. 專案一句話

手機優先的天氣 Web App（vanilla HTML/CSS/JS、原生 ES modules、無打包工具、執行期零依賴），資料來源 Open-Meteo，部署在 GitHub Pages。視覺風格為「方向 A：電子錶外殼 × 內凹 LCD（7 段顯示器）」。

- Repo：https://github.com/CCYu025/pocket-sky （public）
- 正式網址：https://ccyu025.github.io/pocket-sky/
- 設計線框圖（已核准）：https://claude.ai/artifact/KNC6zEw6tJbUHgKGHshKbX → 頁面「方向 A 電子錶外殼」。本機副本：`docs/design/wireframes/*.dc.html`（設計工具格式，只看版面意圖）。

## 2. 狀態總覽

| 項目 | 內容 | 狀態 |
|---|---|---|
| M1 | 資料層：time / cache / store / Open-Meteo client / derive | ✅ PR #1 |
| M2 | 今天頁：LCD、提醒、主題（日夜）、a11y、CSP | ✅ PR #2 |
| M3 | 外出頁：通勤、運動、準備清單與評分規則 | ✅ PR #3 |
| M4 | 地點搜尋／收藏、公司地點、出遊、manifest＋圖示 | ✅ PR #4 |
| M5 | 離線優先、service worker（app-shell）、Lighthouse、Pages 部署 | ✅ PR #5、#6；已上線，冒煙測試 6/6 通過；Lighthouse P98/A100/BP100/SEO91 |
| 宣傳影片 | 方案 06「數字母題」霓虹風、對拍配樂、40.7 秒 | ✅ PR #7（流程在 `promo/`）；成片已交付使用者 |

測試基準：unit 554、e2e 108。

**目前沒有進行中的工作**，`main` 為最新、工作區乾淨。

## 3. 宣傳影片（交接重點）

**成片規格**：1920×1080、60fps、40.7 秒（18 小節）；H.264 + AAC 48 kHz；−14.1 LUFS、true peak −1.8 dBTP；20 個重拍事件音畫誤差皆 ≤ 20 ms。

**內容**：霓虹夜景、單一條曲折路線。起點站「Open-Meteo API」→ LCD 特寫（副歌起點對上 LCD 數字開始跳動）→ 今天頁全畫面 → 通勤、運動、出遊、地點搜尋、LIGHT 五站，每站約 4.5 秒（8 拍）：升起 → 聚光燈 → 手指點擊（落在小節第一拍）→ 結果字幕 → 發牌入堆；站與站之間有大型 7 段數字變形（23° → 18:00 → 14:00 → −5° → 4/5 → 20:30）→ 六卡展開 → 收折 → 主卡停左、右側「Pocket Sky／出門前，一眼看懂天氣／網址」→ 片尾小字標註資料來源與配樂。

**素材與資料**：一份統一的模擬天氣日（台中 2026-11-21 午後雷陣雨，`promo/fixtures.mjs`），用真實 App 以 3 倍解析度截圖（`promo/capture-shots.mjs`），所有畫面講同一個故事。

**配樂**：「A Pretty Good Day」– One More Lawn (Radio)，作者 Superdou（YouTube `D0aShu1ZLxw`，Suno AI 製作）。說明欄授權：可免費用於直播與影片，含營利；若遭 Content ID 認領屬誤判，可申訴並到作者 Discord 告知。片尾已加禮貌性標註 `Music: "A Pretty Good Day" – One More Lawn (Superdou)`。使用段落：歌曲 86.858–127.552 秒（候選 B），不變速，由動畫對齊實測拍點（約 106 BPM）。淡入 0.6 秒、淡出 1.13 秒（最後兩拍）。

**未放進 repo 的東西（重要）**
- 音樂檔：授權只涵蓋「用在影片裡」，不含散佈原檔。重新輸出時請把使用者的音檔放到 `promo/audio/song.m4a`（gitignored）。原始來源是使用者 Google Drive 上的螢幕錄影（約 169 MB），已取出 AAC 音軌使用。
- 成片 MP4 與截圖：體積大且可重新產生。成片目前只存在上個 session 的暫存區與使用者手上；建議使用者把 MP4 上傳到 GitHub Releases 保存。

**重新產生**（細節見 `promo/README.md`）
```bash
export NODE_PATH=$(npm root -g)
npm run promo:shots      # 用統一天氣日重新截圖（App 改版後必做）
npm run promo:preview    # 960×540 30fps 預覽
npm run promo:render     # 1920×1080 60fps 成片（含配樂與母帶處理）
```
其他：`promo/pick-segment.py`（選段）、`promo/audio/beatgrid.py`＋`finalize.py`（拍點）、`promo/audio/synccheck.py`（音畫同步檢查）、`render.mjs --remux <mp4>`（只換音軌，不重算畫面）。母帶處理保證 ≤ −1.5 dBTP。節拍與事件對照、同步檢查結果在 `promo/reports/`；`tests/unit/promo.test.mjs` 守護拍點資料完整性。

**影片製作過程留下的參考頁**（claude.ai artifact，皆為私人連結）
- 10 種風格樣片：https://claude.ai/artifact/9FxE7NZ7pj8vGEbUHhZwGK
- 分鏡（創意總監 A/B/C 提案＋10 種風格）：https://claude.ai/artifact/DhoNQ5vd676R1LknZPho11
- 霓虹原型（30 秒版）：https://claude.ai/artifact/BxrmeVuKSJLptbk1yL7mMv
- 10 種改良方案（可切換播放）：https://claude.ai/artifact/NZNcdE8V2XJZj1VRxxeCTq

**可能的後續**：9:16 直式版（引擎已支援 540×960，方案 10 的版面可參考）、15 秒精簡版、把成片放上 Releases／產品頁。

## 4. App 的下一步（尚未排定，皆需先寫規格再動工）

- 自架子集字型（取代 Google Fonts，並可收緊 CSP）。
- 擴充中文地名搜尋涵蓋率，或改用對中文地名較友善的地理編碼服務（目前 `墾丁`、`花蓮縣` 搜不到）。
- 提醒推播（PWA push notifications）。
- 運動評分加入日照因子。
- 搜尋結果分頁（目前最多 8 筆）。

**新里程碑的標準流程**：開新分支（如 `m6-xxx`）→ Lead 把規格寫入 `docs/ARCHITECTURE.md` 並取得使用者同意 → 派實作 agent（先寫會失敗的測試）→ 審查 agent 至少兩輪 → Lead 重跑 `npm test`、`npm run test:e2e` 並看截圖 → push、開 PR → CI 綠 → 使用者明確同意後合併 → Pages 部署後跑 `npm run smoke -- https://ccyu025.github.io/pocket-sky/`。若 App 畫面有變，記得 `npm run promo:shots` 重新截圖再視需要重出影片。

## 5. 工作流程（使用者指定，請延續）

- **使用者偏好**：繁體中文、精簡；完整程式或文件前先說明架構取得同意；**工作一律指派 agent 獨立完成**（使用者明確要求），Lead 負責規格、分派、整合、驗收。
- **實作／修正**：`general-purpose` agent，`model: sonnet`；可並行時用 `isolation: worktree`（worktree 起點是 `origin/main`，prompt 內先 `git fetch origin +refs/heads/<branch>:refs/remotes/origin/<branch> && git merge --ff-only origin/<branch>`）；有依賴時直接在主工作目錄序列執行，並劃清各 agent 可改的檔案。
- **審查／創意評估**：`general-purpose` agent，`model: opus`，唯讀；每個里程碑至少兩輪（初審 → 修正 → 複審）。
- **規則**：每項修正先寫會失敗的測試再修；commit 用 conventional message，結尾必須是：
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: <該 session 系統提示給的連結>
  ```
- **Git**：每項工作一個分支 → PR（`gh api repos/CCYu025/pocket-sky/pulls ...`）→ CI（unit、e2e）綠 → **使用者明確回覆「合併 PR #N」** 才合併（`gh api -X PUT .../pulls/N/merge`；未經同意會被權限分類器擋）。不要 force push、不要 `reset --hard`。
- **Lead 驗收時注意**：agent 有時會悄悄改掉已核准的參數（例如這次的音訊淡入淡出），合併前要對照使用者核准的數值。

## 6. 環境與工具備忘

- **雲端環境**：個人環境 `pocket-sky`，放行主機：`api.open-meteo.com`、`air-quality-api.open-meteo.com`、`geocoding-api.open-meteo.com`、`ccyu025.github.io`（冒煙測試）、`drive.google.com`、`drive.usercontent.google.com`（下載使用者分享的 Drive 檔案）＋套件庫。新 session 請選這個環境。沙盒 IP 可能撞到 Open-Meteo forecast 每日上限，此時改用 fixtures（`SMOKE_FIXTURES=1`）。YouTube 連不到（也不應從 YouTube 擷取音訊）。
- **大檔案**：Google Drive 連接器會把檔案轉成 base64 傳入，大檔（如影片）不適用；改請使用者開「知道連結的人可檢視」後用 `curl` 從 `drive.usercontent.google.com/download?id=<id>&export=download&confirm=t` 下載。
- **GitHub**：Claude GitHub App 已安裝；push 用 `git push`；PR／merge／check-runs 用 `gh api` REST（GraphQL 與 Pages 設定 API 被擋）。shallow clone 若缺 `origin/main`：`git config remote.origin.fetch "+refs/heads/*:refs/remotes/origin/*" && git fetch --depth=50 origin main`。
- **工具**：Node v22；ffmpeg／ffprobe 在 `/usr/bin`；Python 3 + numpy；Playwright 預裝 v1.63.0（`/opt/node-tools/node_modules/playwright`，用 `tests/e2e/helpers.mjs` 的 `loadPlaywright()` 或 `export NODE_PATH=$(npm root -g)`），**不要** `npm i playwright` 或 `playwright install`。
- **App 指令**
  ```bash
  npm test                 # 單元測試
  npm run test:e2e         # E2E（Playwright + axe-core，固定時鐘 2026-11-21 14:20 台北、裝置時區 America/New_York）
  NODE_USE_ENV_PROXY=1 npm run test:contract   # 契約測試（真實 API）
  npm run sw               # 本機開 repo 根目錄前產生 sw-assets.js（不提交）
  npm run lighthouse       # 手動品質門檻（未達標 exit 1；-- --no-write 不寫報告）
  npm run smoke -- https://ccyu025.github.io/pocket-sky/
  E2E_SCREENSHOTS=1 E2E_REAL_FONTS=1 npm run test:e2e   # 重產 docs/screenshots/
  ```
- **用量限制**：帳號 5 小時額度用完會中斷 agent；可用 SendMessage 讓它從原處續做。

## 7. App 關鍵設計決策（摘要；詳見 ARCHITECTURE.md）

- 時間：一律用 API 的 `utc_offset_seconds` 換算，禁止 `new Date(localString)`；「現在」向下取整到整點。
- 快取：localStorage SWR、in-flight 去重、savedAt 排序保護、有快取就先顯示（離線優先）；座標送出前四捨五入到 2 位小數。
- 多地點：每個地點獨立單點請求、各自 cacheKey；公司／目的地延遲載入；最多 3 個地點同時存在。
- 地名搜尋：中文需完整名稱 → 依序試 `q`、台/臺互換、`+市`（最多 4 種）。
- 提醒：降雨跳升、氣溫驟降；每事件一個 id，事件時間移動視為延續。
- 準備清單門檻（`js/rules/config.js`）：雨傘 ≥40% 或 ≥0.5mm；外套 體感 ≤18° 或溫差 ≥6°；防曬 10–15 時 UV ≥6；口罩 AQI ≥100（PM2.5 ≥35 為敏感族群建議）。
- 運動：6 因子分段線性加權，看未來 12 小時。出遊：等級受雨限制，最佳時段只取白天＋乾燥連續段。
- Service worker：app-shell 模型，HTML／CSS／JS 永遠同一版本，新版經「有新版本」橫幅進來；`updateViaCache: 'none'` ＋ 部署時在 `sw.js` 首行寫入版本號。
- UI：一頁最多一個無限循環動畫；只動 transform/opacity；CSP 不含 `'unsafe-inline'`；單一 live region；觸控目標 ≥44px；日夜對比 ≥4.5:1。

## 8. 已知限制

- 地名搜尋：景點／縣名中文搜不到，需英文；最多 8 筆、無分頁。
- 第一次在夜間開啟且無任何快取時，依裝置時鐘（18:00–06:00）判斷夜間，可能與地點時區不一致。
- manifest 的 maskable 圖示與一般圖示相同（滿版設計，可接受）。
- Lighthouse 的 `robots-txt` 稽核因嚴格 CSP 顯示失敗（工具限制；子路徑下 `robots.txt` 本就不會被爬蟲讀取）。
- `?nosw` 只跳過註冊，不會解除已安裝的 service worker；本機開發請用 DevTools「Update on reload」或解除註冊。
