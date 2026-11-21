# Pocket Sky

手機優先的天氣 Web App：今天天氣、外出規劃（通勤／運動）、變化提醒。
純 vanilla HTML/JS（ES modules，無打包工具），部署於 GitHub Pages。

## 開發

```bash
npm test               # 單元測試（離線、使用 fixtures）
npm run test:contract  # 契約測試（呼叫真實 Open-Meteo API）
npm run test:e2e       # 瀏覽器 E2E（Playwright + axe-core，使用 fixtures）
npm run fixtures       # 重新擷取 tests/fixtures/
npm run sw             # 產生 sw-assets.js（service worker 的預快取清單）
npm run build:site     # 組出 _site/（只含執行期檔案，即 Pages 部署內容）
npm run lighthouse     # Lighthouse 手機版品質檢查，寫入 docs/reports/lighthouse-m5.{json,md}（手動，不在 CI；加 -- --no-write 只印出；首次會依需要安裝固定版本的 Lighthouse 到暫存目錄；未達標 exit 1）
npm run smoke -- <url> # 部署後冒煙測試（預設 https://ccyu025.github.io/pocket-sky/，使用真實 API）
```

`sw-assets.js` 是建置產物（已加入 .gitignore，不提交）。直接以靜態伺服器開啟 repo 根目錄時，`sw.js` 需要它：clone 之後先執行一次 `npm run sw`，否則 service worker 註冊會 404。`npm run test:e2e`、`npm run build:site` 與 Pages 部署流程都會自動產生它。

部署：push 到 `main` 觸發 `.github/workflows/pages.yml`（測試 → 組 `_site/` → GitHub Pages）。需先在 repo Settings → Pages 將 Source 設為「GitHub Actions」。

E2E 預設不寫入任何檔案（字型以空 CSS 攔截，結果可重現）。重新產生文件截圖（`docs/screenshots/m2/`，含 390×844 首屏 `today-day-viewport.png`）：

```bash
E2E_SCREENSHOTS=1 E2E_REAL_FONTS=1 npm run test:e2e
```

`E2E_REAL_FONTS=1` 會載入真實的 Google Fonts，整個 E2E（含橫向溢位與版面斷言）即以真實字型執行；需要可連外網路。

本機開發與 service worker：已安裝 SW 後，scope 根目錄的導覽是 cache-first，會一直顯示舊 HTML，直到使用者接受更新。開發時請在 DevTools → Application → Service Workers 勾選「Update on reload」，或直接 Unregister。`?nosw` 只是略過註冊，不會解除已存在的 worker。

架構與模組介面：[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)

## 資料來源

Weather data by [Open-Meteo.com](https://open-meteo.com/)（CC BY 4.0）
