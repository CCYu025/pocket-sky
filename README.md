# Pocket Sky

手機優先的天氣 Web App：今天天氣、外出規劃（通勤／運動）、變化提醒。
純 vanilla HTML/JS（ES modules，無打包工具），部署於 GitHub Pages。

## 開發

```bash
npm test               # 單元測試（離線、使用 fixtures）
npm run test:contract  # 契約測試（呼叫真實 Open-Meteo API）
npm run fixtures       # 重新擷取 tests/fixtures/
```

架構與模組介面：[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)

## 資料來源

Weather data by [Open-Meteo.com](https://open-meteo.com/)（CC BY 4.0）
