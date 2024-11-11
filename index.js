const puppeteer = require('puppeteer');
const fs = require('fs').promises;
const path = require('path');
const axios = require('axios');
const cheerio = require('cheerio');

// 設定預設編碼
process.env.LANG = 'zh_TW.UTF-8';
class NDHUCrawler {
    constructor() {
        this.baseUrl = 'https://am.ndhu.edu.tw/';
        this.visitedUrls = new Set();
        this.urlQueue = [];
        this.baseDir = './ndhu_am_archive';
        this.browser = null;
        this.logFile = path.join(this.baseDir, 'crawler.log');

    }

    async initialize() {
        try {
            await fs.mkdir(this.baseDir, { recursive: true });
            // 初始化 log 檔案
            await fs.writeFile(this.logFile, `Crawler started at ${new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' })}\n`);
        } catch (error) {
            console.error('建立目錄或 log file 失敗:', error);
        }

        this.browser = await puppeteer.launch({
            headless: 'new',
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--lang=zh-TW',
                '--disable-dev-shm-usage'
            ]
        });
    }

    async writeLog(message) {
        const timestamp = new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' });
        const logMessage = Buffer.from(`[${timestamp}] ${message}\n`, 'utf8');
        console.log(message);
        await fs.appendFile(this.logFile, logMessage).catch(err => console.error('寫入日誌失敗:', err));
    }

    isValidUrl(url) {
        try {
            const urlObj = new URL(url);
            return urlObj.hostname === 'am.ndhu.edu.tw';
        } catch (error) {
            return false;
        }
    }

    is403ModulePage(url) {
        const regex = /^https:\/\/am\.ndhu\.edu\.tw\/p\/403-\d+-\d+-\d+\.php\?Lang=zh-tw$/;
        return regex.test(url);
    }

    is406ModulePage(url) {
        // 406-1038-193282,r4551.php?Lang=zh-tw
        const regex = /^https:\/\/am\.ndhu\.edu\.tw\/p\/406-\d+-\d+,\w+\.php\?Lang=zh-tw$/;
        return regex.test(url);
    }

    is132ModulePage(url) {
        // https://am.ndhu.edu.tw/p/132-1038-2588.php?Lang=zh-tw
        const regex = /^https:\/\/am\.ndhu\.edu\.tw\/p\/132-\d+-\d+\.php\?Lang=zh-tw$/;
        return regex.test(url);
    }

    isSingleImagePage(url) {
        // https://am.ndhu.edu.tw/var/file/38/1038/gallery/86/2586/gallery_2586_765420_51686.jpg
        // take the https://am.ndhu.edu.tw/var/file/38/1038/gallery/ path
        const regex = /^https:\/\/am\.ndhu\.edu\.tw\/var\/file\/\d+\/\d+\/gallery\//;
        return regex.test(url);
    }

    is16ModulePage(url) {
        // https://am.ndhu.edu.tw/p/16-1038-193282.php?Lang=zh-tw
        const regex = /^https:\/\/am\.ndhu\.edu\.tw\/p\/16-\d+-\d+\.php\?Lang=zh-tw$/;
        return regex.test(url);
    }


    generateSafeFilename(url) {
        const urlObj = new URL(url);
        let filename = urlObj.pathname + urlObj.search;
        filename = filename.replace(/[\/\\\?\*\|":<>]/g, '_');
        return filename;
    }

    sanitizeTitle(title) {
        // 移除不可見字符和控制字符
        title = title.replace(/[\u0000-\u001F\u007F-\u009F]/g, '');
        // 移除特殊檔案系統字符，但保留中文字符
        title = title.replace(/[\/\\\?\*\|":<>]/g, '_');
        // 移除開頭和結尾的空白字符
        title = title.trim();
        // 如果標題為空，返回預設值
        return title || 'untitled';
    }

    async extractBreadcrumb($) {
        const breadcrumbItems = [];
        $('.breadcrumb li').each((_, element) => {
            const text = $(element).text().trim();
            if (text && text !== '首頁') {
                breadcrumbItems.push(this.sanitizeTitle(text));
            }
        });
        return breadcrumbItems;
    }

    async createDirectoryPath(page, url) {
        const $ = cheerio.load(await page.content());
        let directoryPath = this.baseDir;

        // 取得頁面標題
        const pageTitle = this.sanitizeTitle($('title').first().text() || 'untitled');

        // 嘗試取得麵包屑
        const breadcrumbItems = await this.extractBreadcrumb($);

        // 檢查是否為 406 模組頁面
        if (this.is406ModulePage(url)) {
            directoryPath = path.join(directoryPath, '最新消息');
        } else if (breadcrumbItems.length > 0) {
            // 使用麵包屑建立目錄路徑
            directoryPath = path.join(directoryPath, ...breadcrumbItems);
        }

        if (this.is132ModulePage(url)) {
            directoryPath = path.join(directoryPath, '線上相簿');
        }

        if (this.isSingleImagePage(url)) {
            directoryPath = path.join(directoryPath, '線上相簿', '單張圖片');
        }

        // if is 16 module page, skip it
        if (this.is16ModulePage(url)) {
            return directoryPath;
        }

        // 加入頁面專屬目錄
        const pageDirName = `${pageTitle}_${this.generateSafeFilename(url)}`;
        directoryPath = path.join(directoryPath, pageDirName);

        // 建立目錄
        await fs.mkdir(directoryPath, { recursive: true });
        return directoryPath;
    }

    async downloadPdf(url, directoryPath) {
        try {
            const response = await axios({
                method: 'GET',
                url: url,
                responseType: 'arraybuffer'
            });

            const filename = path.basename(url);
            const sanitizedFilename = filename.replace(/[\/\\\?\*\|":<>]/g, '_');
            const filePath = path.join(directoryPath, sanitizedFilename);

            // if filename is 169376631.pdf, skip it
            if (filename === '169376631.pdf') {
                console.log(`Skip PDF 附件下載: ${sanitizedFilename}`);
                return;
            }
            await fs.writeFile(filePath, response.data);
            console.log(`PDF 附件下載成功: ${sanitizedFilename}`);
        } catch (error) {
            console.error(`PDF 附件下載失敗 ${url}:`, error.message);
        }
    }

    async saveWebPageAsPdf(page, url, directoryPath) {
        try {
            const $ = cheerio.load(await page.content());
            const pageTitle = this.sanitizeTitle($('title').first().text() || 'untitled');
            const filename = `${pageTitle}_${this.generateSafeFilename(url)}.pdf`;
            const filePath = path.join(directoryPath, filename);

            // 注入頁尾資訊
            await page.evaluate((url) => {
                const footer = document.createElement('div');
                footer.id = 'pdf-footer';
                footer.style.position = 'fixed';
                footer.style.bottom = '0';
                footer.style.left = '0';
                footer.style.right = '0';
                footer.style.padding = '10px';
                footer.style.borderTop = '1px solid #ccc';
                footer.style.backgroundColor = '#f9f9f9';
                footer.style.fontSize = '10px';
                footer.style.color = '#666';
                footer.innerHTML = `
                    網址: ${url}<br>
                    列印時間: ${new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' })}
                `;
                document.body.appendChild(footer);
                document.body.style.paddingBottom = '100px';
            }, url);

            // 生成 PDF
            // 在生成 PDF 前確保所有背景元素都被正確渲染
            await page.evaluate(() => {
                document.querySelectorAll('*').forEach(el => {
                    const style = window.getComputedStyle(el);
                    if (style.backgroundColor !== 'rgba(0, 0, 0, 0)' &&
                        style.backgroundColor !== 'transparent') {
                        el.style.webkitPrintColorAdjust = 'exact';
                        el.style.printColorAdjust = 'exact';
                    }
                });
            });

            await page.pdf({
                path: filePath,
                format: 'A4',
                printBackground: true,
                preferCSSPageSize: true,
                margin: {
                    top: '20px',
                    bottom: '20px',
                    left: '20px',
                    right: '20px'
                },
                // 字體渲染問題，禁用字體子像素定位
                args: ['--disable-font-subpixel-positioning']
            });

            console.log(`網頁存為 PDF 成功: ${filename}`);
        } catch (error) {
            console.error(`網頁存為 PDF 失敗 ${url}:`, error.message);
        }
    }

    async processPage(url) {
        if (this.visitedUrls.has(url)) {
            return;
        }

        this.visitedUrls.add(url);
        console.log(`處理頁面: ${url}`);

        try {
            const page = await this.browser.newPage();
            await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');

            await page.setViewport({
                width: 1920,
                height: 1080
            });

            // 設定頁面編碼
            await page.setExtraHTTPHeaders({
                'Accept-Language': 'zh-TW,zh;q=0.9,en-US;q=0.8,en;q=0.7'
            });

            // 設定頁面內容編碼
            await page.evaluateOnNewDocument(() => {
                document.charset = 'UTF-8';
            });

            await page.setDefaultNavigationTimeout(30000);
            await page.goto(url, { waitUntil: 'networkidle0' });

            if (this.is403ModulePage(url) || this.is406ModulePage(url) || this.is132ModulePage(url) || this.isSingleImagePage(url) || this.is16ModulePage(url)) {
                await this.handle403ModulePage(page);
            }

            // 建立目錄路徑
            const directoryPath = await this.createDirectoryPath(page, url);

            // 儲存網頁為 PDF
            await this.saveWebPageAsPdf(page, url, directoryPath);

            const content = await page.content();
            const $ = cheerio.load(content);

            // 提取所有連結
            const links = $('a');
            const pdfPromises = [];

            links.each((_, element) => {
                let href = $(element).attr('href');
                if (!href) return;

                if (href.startsWith('/')) {
                    href = new URL(href, this.baseUrl).href;
                }

                const lowerHref = href.toLowerCase();
                // 檢查是否為支援的文件類型
                if (lowerHref.endsWith('.pdf') ||
                    lowerHref.endsWith('.doc') ||
                    lowerHref.endsWith('.docx') ||
                    lowerHref.endsWith('.xls') ||
                    lowerHref.endsWith('.xlsx')) {
                    pdfPromises.push(this.downloadPdf(href, directoryPath));
                } else if (this.isValidUrl(href) && !this.visitedUrls.has(href)) {
                    this.urlQueue.push(href);
                }
            });

            // 等待所有 PDF 下載完成
            await Promise.all(pdfPromises);

            await page.close();
        } catch (error) {
            console.error(`處理頁面失敗 ${url}:`, error.message);
        }
    }

    async handle403ModulePage(page) {
        try {
            await page.evaluate(async () => {
                await new Promise((resolve) => {
                    let totalHeight = 0;
                    const distance = 100;
                    const timer = setInterval(() => {
                        const scrollHeight = document.documentElement.scrollHeight;
                        window.scrollBy(0, distance);
                        totalHeight += distance;

                        if (totalHeight >= scrollHeight) {
                            clearInterval(timer);
                            resolve();
                        }
                    }, 100);
                });
            });

            // 改用 Promise 包裝的 setTimeout
            await new Promise(resolve => setTimeout(resolve, 2000));
        } catch (error) {
            console.error('處理 403/406 模組頁面失敗:', error.message);
        }
    }

    async start() {
        await this.initialize();
        this.urlQueue.push(this.baseUrl);

        while (this.urlQueue.length > 0) {
            const url = this.urlQueue.shift();
            await this.processPage(url);
        }

        await this.browser.close();
        console.log('爬蟲完成!');
        console.log(`總共處理了 ${this.visitedUrls.size} 個頁面`);
    }
}

// 使用範例
const crawler = new NDHUCrawler();
crawler.start().catch(console.error);