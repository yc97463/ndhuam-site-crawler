# Web Scraping with Puppeteer

## Installation

```bash
npm init -y
npm install puppeteer cheerio axios
```

## Headless Environment

### 安裝中文字體和語言支援
sudo apt-get update
sudo apt-get install -y fonts-noto-cjk language-pack-zh-hant fonts-wqy-zenhei
### 設定系統預設編碼
sudo locale-gen zh_TW.UTF-8
sudo update-locale LANG=zh_TW.UTF-8

## Troubleshooting
if you are running in a headless environment, you may need to install the following dependencies:

```bash
sudo apt-get install -y libx11-xcb1 libxcomposite1 libxcursor1 libxdamage1 libxi6 libxtst6 libnss3 libcups2 libxss1 libxrandr2 libasound2 libatk1.0-0 libatk-bridge2.0-0 libgtk-3-0
```

## Usage

Run the script
```bash
npm run go
```

or pack the archived files into a tar.gz file
```bash
tar -czvf archive.tar.gz ndhu_am_archive/
