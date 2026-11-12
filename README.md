# Fitness 組間休息通知伺服器

[Fitness](https://github.com/fitness-app-tw/app) 的組間休息背景通知伺服器（iPhone、Android 手機的瀏覽器使用）。部署到你自己的 Cloudflare 帳號（免費方案即可，不需信用卡）。

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/fitness-app-tw/rest-push)

## 為什麼需要

手機的網頁版（iPhone 加入主畫面的網站、Android 手機的瀏覽器）在背景或螢幕關閉時會被系統暫停，無法自行在組間休息結束時準時通知。設定這個伺服器後，App 在休息開始時把通知交給伺服器，時間到時由伺服器送出推送通知。

安裝 Android App 時不需要這個伺服器。

## 設定步驟

建議在要收通知的手機上操作，完整步驟也列在 App 的「設定 → 組間休息預設 → 通知伺服器 → 設定」。

1. 於 App 按「部署到 Cloudflare」（或上方的 **Deploy to Cloudflare** 按鈕），登入或註冊 Cloudflare 帳號。
2. 依畫面連接 GitHub 帳號（沒有的話可免費註冊），其他欄位維持預設，按下部署。
3. 部署完成後，複製以 `workers.dev` 結尾的網址，貼到 App 的「伺服器網址」。
4. 按「檢查」並允許通知；約 3 秒後收到測試通知即完成。

## 安全與隱私

- **不存放訓練資料**：只暫存尚未送出的通知，送出或取消後即刪除。
- **讀不到通知內容**：通知內容由 App 加密（RFC 8291），只有你的裝置能解開。
- **沒有任何金鑰**：推送用的金鑰存在你的裝置上，由 App 簽名（RFC 8292 VAPID）。
- **只有你能使用**：第一台設定的裝置成為擁有者，之後只接受同一組存取碼的請求；也只會轉送到 Apple、Google、Mozilla、Microsoft 的推送服務。
- 程式碼只有一個檔案：[`src/index.js`](src/index.js)。

## 費用

Cloudflare Workers 免費方案的額度（Durable Objects 每天 10 萬次請求）遠高於個人使用量；超過額度時當天的通知會失敗，不會產生費用。

## 授權

（待定）
