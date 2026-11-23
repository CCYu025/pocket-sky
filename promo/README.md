# Pocket Sky 宣傳影片管線（promo）

可重現、逐幀確定性的宣傳短片產生器。這個資料夾只放**程式與小型資料**；音樂、截圖與成品影片都不進版控（見下方「不納入版控」）。此資料夾**不會被部署**到 GitHub Pages（`scripts/site-files.mjs` 只列出 app 執行檔案，`tests/unit/promo.test.mjs` 另有檢查）。

## 這支影片是什麼

- 版本 **v06「數字母題」**：以 app 真實畫面（通勤／運動／出遊／地點／LIGHT）串起「一個數字 → 一個決定」的敘事。
- 長度 **40.693 s**（18 小節 = 72 拍，約 108 BPM），**1920×1080、60 fps**，H.264 + AAC 192k。
- 音樂：*A Pretty Good Day* — One More Lawn（Superdou）；使用的段落為歌曲 **86.858–127.552 s**（影片 0 秒 = 歌曲第 86.858 s 的強拍）。
- 授權摘要：可免費用於影片（含營利／monetized 影片）；請在片尾字卡致謝（courtesy credit，本片已內建）；作者表示 Content-ID 的侵權聲明皆為誤判。**授權涵蓋「用在影片中」，不含轉散布音檔本身。**

## 不納入版控（也不要加入）

| 檔案 | 原因 |
| --- | --- |
| 音樂檔（`audio/song.m4a` 等） | 授權允許用於影片，不允許再散布音檔 |
| 成品 / 預覽 MP4（`out/`） | 體積大（約 25 MB），可由本管線重現 |
| PNG 截圖（`shots/`） | 由 `capture-shots.mjs` 自 app 重新產生 |

`promo/.gitignore` 已涵蓋上述項目。

## 需求

- Node 22、Playwright 1.63（雲端環境已預裝，用 `export NODE_PATH=$(npm root -g)`；其他環境請在 repo 外執行 `npm i -g playwright@1.63 && npx playwright install chromium`，**不要**把它加進本專案 `package.json`）
- `ffmpeg` / `ffprobe`（需有 `loudnorm`、`alimiter`、`ebur128`、libx264、aac；可用環境變數 `FFMPEG` 指定路徑）
- Python 3 + numpy（僅「節拍格」與「同步檢查」需要）
- 網路：渲染時從 Google Fonts 載入 Noto Sans TC 與 Share Tech Mono；載入失敗時 `render.mjs` 會印出 `FALLBACK FONTS` 並以非 0 結束（中文會變豆腐，除非加 `--allow-fallback`）

## 取得音樂

請使用你自己取得的合法音檔（One More Lawn〈A Pretty Good Day〉），放在 **`promo/audio/song.m4a`**（或用 `--audio <檔案>` 指定任何位置）。其他格式（mp3、wav）只要 ffmpeg 讀得動即可。**請勿提交**此檔。

## 指令

在 repo 根目錄執行：

```sh
export NODE_PATH=$(npm root -g)      # 使用預裝的 Playwright

# 1. 由真實 app + 模擬的 Open-Meteo 回應擷取畫面 -> promo/shots/（約 20 s）
npm run promo:shots                  # = node promo/capture-shots.mjs

# 2. （選用）重新量測節拍格；repo 已附好 variants/beatgrid-B.js，一般不需要
ffmpeg -i promo/audio/song.m4a -vn -ac 1 -ar 22050 -f s16le promo/audio/song.raw
python3 promo/audio/beatgrid.py promo/audio/song.raw 86.858 127.552     # -> audio/beats_raw.json
python3 promo/audio/finalize.py <強拍時間 s> <之前幾小節> 75            # -> variants/beatgrid-B.js
#    （換歌段落時可用 python3 promo/pick-segment.py <音檔> 40.7 先找起點）

# 3. 預覽（960×540、30 fps、含音樂，約 1 分鐘）
npm run promo:preview                # 只看一小段：加 --from 9 --to 11；單張：--still 15 --out promo/out/f.png
npm run promo:preview -- --audio /path/to/song.m4a

# 4. 正式渲染（1920×1080、60 fps，含音樂；數分鐘）
npm run promo:render                 # -> promo/out/pocket-sky-promo-1080p60-music.mp4
npm run promo:render -- --audio /path/to/song.m4a --out promo/out/final.mp4
#    只換音軌、不重畫影格（-c:v copy）：
node promo/render.mjs --remux promo/out/old.mp4 --out promo/out/final.mp4

# 5. 同步檢查（事件時間 vs. 成品音訊的實際 onset，需 numpy）
node promo/audio/verify.mjs          # -> out/events-beat-B.json、out/contact-beat-B.png，並檢查確定性
python3 promo/audio/synccheck.py promo/out/pocket-sky-promo-1080p60-music.mp4
```

`--audio-start` 預設取自 `variants/beatgrid-B.js` 的 `S`（86.858 s）；`render.mjs` 沒有 `--audio` 且找不到 `promo/audio/song.m4a` 時會輸出無聲影片。輸出一律在 `promo/out/`。

## 事件與節拍對照（摘要，完整表見 `reports/verify-beat-B.txt`）

所有畫面事件都鎖在實測節拍格上（誤差 0.0 ms；60 fps 取整後 ≤ 8.3 ms）。

| 影片時間 | 拍 | 事件 |
| --- | --- | --- |
| 0.000 | 0（強拍） | 開場、標示出現 |
| 2.265 | 4 | 脈衝出發 |
| 4.526–6.206 | 8–11（八分音符） | LCD 數字逐步計數 3→23 |
| 6.785 / 9.049 | 12 / 16 | LCD 收束轉場 / 發牌結束、跳往第一站 |
| 11.308 | 20 | 通勤 TAP |
| 15.834 | 28 | 運動 TAP |
| 20.348 | 36 | 出遊 TAP |
| 24.879 | 44 | 地點 TAP |
| 29.397 | 52 | LIGHT TAP |
| 31.659 | 56 | 弧形展開（fan） |
| 33.919 | 60 | 收合（fold） |
| 36.176 | 64 | 標題打字 |
| 37.302–38.284 | 66–67.75（十六分音符） | 網址逐字 |
| 38.429 | 68 | 致謝字卡 |
| 40.693 | 72 | 影片結束 |

每一站的週期約 8 拍（4.50–4.54 s），停留（到達→離場）≥ 3.37 s；鏡頭最高速度 688.6 px/s（限制 700）。

## 響度目標

- 整合響度 **−14 LUFS**（±0.3 LU）、真峰值 **≤ −1.5 dBTP**。
- 音訊鏈（`audio/master.mjs`）：兩段式 `loudnorm`（linear）→ 淡入 1 s／淡出 1 s → `alimiter` → AAC 192k；**編碼後**再用 `ebur128 peak=true` 量測，超標就降低內部上限重編，保證輸出 ≤ −1.5 dBTP（先前單次編碼量到 −1.3 dBTP，是 AAC 編碼造成的 inter-sample 過衝）。
- 目前成品：−14.1 LUFS／−1.9 dBTP（`reports/loudness-final.txt`）。

## 資料夾

```
promo/
  capture-shots.mjs  fixtures.mjs   擷取 app 畫面（模擬 API、固定時鐘）
  render.mjs  render.html  engine.js  variants/{v01,v06,beatgrid-B}.js   渲染器與影片本體
  audio/  master.mjs（響度/真峰值）beatgrid.py finalize.py（節拍格）verify.mjs synccheck.py（驗證）
  pick-segment.py   挑音樂段落
  reports/          節拍格與驗證報告（小型，進版控；tests/unit/promo.test.mjs 檢查其完整性）
  shots/ out/ audio/song.*   產生物，已 gitignore
```
