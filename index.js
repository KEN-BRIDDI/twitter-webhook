const express = require('express');
const bodyParser = require('body-parser');
const fetch = require('node-fetch');
// twitter-api-v2 のインポートは残す (クライアント初期化で使うため)
const { TwitterApi } = require('twitter-api-v2');
// const { MimeType } = require('twitter-api-v2'); // ★ MimeType のインポートはコメントアウト

const app = express();
app.use(bodyParser.json());

const PORT = process.env.PORT || 3000;

// --- Twitter API Client の初期化 ---
const twitterClient = new TwitterApi({
  appKey: process.env.API_KEY,
  appSecret: process.env.API_SECRET,
  accessToken: process.env.ACCESS_TOKEN,
  accessSecret: process.env.ACCESS_SECRET,
});
const rwClient = twitterClient.readWrite;
console.log("Twitter API v2 client initialized.");


// --- GETルート ---
app.get('/', (req, res) => {
  res.status(200).send('✅ Webhook is running! (Using twitter-api-v2 - Hardcoded MimeType)');
});

// --- POSTルート (API v2版 / MimeType直接指定) ---
app.post('/', async (req, res) => {
  console.log("===== New Request Received (API v2 / Hardcoded MimeType) =====");
  const { tweetText, mediaId, row_index } = req.body;
  const text = tweetText;
  const image_id = mediaId;

  console.log("📩 Received data:", { text: text ? 'Yes' : 'No', image_id: image_id ? 'Yes' : 'No', row_index });

  if (!text || !image_id) { /* ... */ }
  if (!process.env.API_KEY || !process.env.API_SECRET || !process.env.ACCESS_TOKEN || !process.env.ACCESS_SECRET) { /* ... */ }

  try {
    // 1. Google Driveから画像をダウンロード
    console.log(`📥 Downloading image from Google Drive (ID: ${image_id})`);
    const mediaUrl = `https://drive.google.com/uc?export=download&id=${image_id}`;
    const mediaRes = await fetch(mediaUrl);
    if (!mediaRes.ok) { /* ... */ }
    const mediaBuffer = await mediaRes.buffer();
    console.log(`✅ Image downloaded (Size: ${mediaBuffer.length} bytes)`);

    // ---- twitter-api-v2 ライブラリを使用 ----

    // 2. Twitterに画像をアップロード
    console.log("⏳ Uploading media via twitter-api-v2 library...");
    // ★★★ MimeType.Jpeg の代わりに直接文字列を指定 ★★★
    let mimeType = 'image/jpeg';
    console.log(`Using hardcoded mimeType: ${mimeType}`); // ログ追加

    const uploadedMedia = await rwClient.v1.uploadMedia(mediaBuffer, { mimeType }); // mimeType 変数(文字列) を渡す
    const uploadedMediaId = uploadedMedia.media_id_string;
    if (!uploadedMediaId) { /* ... */ }
    console.log(`✅ Media uploaded via library. Media ID: ${uploadedMediaId}`);

    // 3. 画像付きツイートを投稿 (API v2)
    console.log("⏳ Posting v2 tweet via twitter-api-v2 library...");
    const tweetResult = await rwClient.v2.tweet({
      text: text,
      media: { media_ids: [uploadedMediaId] }
    });
    const tweetId = tweetResult.data?.id;
    if (!tweetId) { /* ... */ }
    console.log(`✅ v2 Tweet posted! Tweet ID: ${tweetId}`);

    // 4. GASに成功レスポンスを返す
    console.log("🎉 Process completed successfully using API v2!");
    res.status(200).json({ success: true, tweet_id: tweetId, row_index });

  } catch (e) {
    console.error('❌ An error occurred (API v2 / Hardcoded MimeType):', e);
    const statusCode = e.code || 500;
    let errorMessage = e.message || 'An unexpected error occurred.';
    // (エラーメッセージ整形処理は省略)
    res.status(statusCode).json({ error: errorMessage, details: e.toString(), row_index });
  }
});

// --- サーバー起動 ---
app.listen(PORT, () => {
  console.log(`🚀 Server listening on port ${PORT}`);
});

module.exports = app;
