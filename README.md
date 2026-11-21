# Pocket Sky

手機優先的天氣 Web App：今天天氣、外出規劃（通勤／運動）、變化提醒。
純 vanilla HTML/JS（ES modules，無打包工具），部署於 GitHub Pages。

## 開發

```bash
npm test               # 單元測試（離線、使用 fixtures）
npm run test:contract  # 契約測試（呼叫真實 Open-Meteo API）
npm run test:e2e       # 瀏覽器 E2E（Playwright + axe-core，使用 fixtures）
npm run fixtures       # 重新擷取 tests/fixtures/
```

E2E 預設不寫入任何檔案（字型以空 CSS 攔截，結果可重現）。重新產生文件截圖（`docs/screenshots/m2/`，含 390×844 首屏 `today-day-viewport.png`）：

```bash
E2E_SCREENSHOTS=1 E2E_REAL_FONTS=1 npm run test:e2e
```

`E2E_REAL_FONTS=1` 會載入真實的 Google Fonts，整個 E2E（含橫向溢位與版面斷言）即以真實字型執行；需要可連外網路。

架構與模組介面：[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)

## 資料來源

Weather data by [Open-Meteo.com](https://open-meteo.com/)（CC BY 4.0）
