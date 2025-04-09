const express = require('express');
const bodyParser = require('body-parser');
const fetch = require('node-fetch');
// twitter-api-v2 のインポート
const { TwitterApi } = require('twitter-api-v2');
// MimeType は使わない（インポートが不安定だったため）

const app = express();
app.use(bodyParser.json());

const PORT = process.env.PORT || 3000;

// --- Twitter API Client の初期化 ---
// 環境変数チェックも兼ねる
let rwClient;
try {
  const twitterClient = new TwitterApi({
    appKey: process.env.API_KEY,
    appSecret: process.env.API_SECRET,
    accessToken: process.env.ACCESS_TOKEN,
    accessSecret: process.env.ACCESS_SECRET,
  });
  // Read-Write client
  rwClient = twitterClient.readWrite;
  console.log("Twitter API v2 client initialized successfully.");
} catch (e) {
  console.error("FATAL: Failed to initialize Twitter Client. Check environment variables.", e);
  // エラーがあってもサーバーは起動させるが、投稿は失敗する
}


// --- GETルート ---
app.get('/', (req, res) => {
  res.status(200).send('✅ Webhook is running! (API v2 Image Mode - Requires Paid Plan)');
});

// --- POSTルート (API v2 / 画像付き投稿バージョン) ---
app.post('/', async (req, res) => {
  console.log("===== New Request Received (API v2 / Image Post Attempt) =====");

  // クライアントが初期化失敗していたらエラーを返す
  if (!rwClient) {
      console.error("❌ Twitter client not initialized. Cannot proceed.");
      return res.status(500).json({ error: 'Server configuration error: Twitter client failed to initialize.' });
  }

  const { tweetText, mediaId, row_index } = req.body;
  const text = tweetText;
  const image_id = mediaId; // Google Driveの画像ID

  console.log("📩 Received data:", { text: text ? 'Yes' : 'No', image_id: image_id ? 'Yes' : 'No', row_index });

  // パラメータチェック
  if (!text || !image_id) {
    console.error("❌ Missing parameters:", { text, image_id });
    return res.status(400).json({ error: 'Missing parameters (tweetText or mediaId)' });
  }

  try {
    // 1. Google Driveから画像をダウンロード
    console.log(`📥 Downloading image from Google Drive (ID: ${image_id})`);
    const mediaUrl = `https://drive.google.com/uc?export=download&id=${image_id}`;
    const mediaRes = await fetch(mediaUrl);
    if (!mediaRes.ok) {
        const errorText = await mediaRes.text();
        console.error(`❌ Google Drive download failed! Status: ${mediaRes.status}, Response: ${errorText}`);
        throw new Error(`Failed to download image from Google Drive: ${mediaRes.status} ${mediaRes.statusText}`);
    }
    const mediaBuffer = await mediaRes.buffer();
    console.log(`✅ Image downloaded (Size: ${mediaBuffer.length} bytes)`);

    // ---- twitter-api-v2 ライブラリを使用 ----

    // 2. Twitterに画像をアップロード (ライブラリ経由で v1.1 API を利用)
    console.log("⏳ Uploading media via twitter-api-v2 library...");
    // MimeTypeは直接指定 (インポートが不安定だったため)
    // 必要ならファイルタイプに応じて 'image/png', 'image/gif' などに変更
    let mimeType = 'image/jpeg';
    console.log(`Using mimeType: ${mimeType}`);

    // v1.uploadMedia を呼び出し
    const uploadedMedia = await rwClient.v1.uploadMedia(mediaBuffer, { mimeType });
    console.log("Debug: Full response object from uploadMedia:", JSON.stringify(uploadedMedia, null, 2)); // 念のためログは残す

    const uploadedMediaId = uploadedMedia?.media_id_string;

    // Media IDが取得できたか確認
    if (!uploadedMediaId) {
        console.error("❌ Failed to get valid media_id_string from uploadMedia response.");
        let uploadErrorMsg = `Media upload failed: Could not retrieve media_id_string.`;
        if (uploadedMedia && typeof uploadedMedia === 'object') {
            if (uploadedMedia.errors && uploadedMedia.errors.length > 0) { // v1.1形式のエラーチェック
                 uploadErrorMsg += ` Reason: ${uploadedMedia.errors[0].message} (code: ${uploadedMedia.errors[0].code})`;
            } else {
                 uploadErrorMsg += ` Raw Response: ${JSON.stringify(uploadedMedia)}`;
            }
        }
        throw new Error(uploadErrorMsg);
    }
    console.log(`✅ Media uploaded via library. Media ID: ${uploadedMediaId}`);

    // 3. 画像付きツイートを投稿 (API v2)
    console.log("⏳ Posting v2 tweet with media...");
    const tweetResult = await rwClient.v2.tweet({
      text: text,
      media: { media_ids: [uploadedMediaId] } // 取得したメディアIDを使う
    });

    const tweetId = tweetResult.data?.id;
    if (!tweetId) {
        console.error("❌ Failed to get tweet id from Twitter v2 response:", tweetResult);
        throw new Error('Failed to post tweet: Tweet ID not found in v2 response.');
    }
    console.log(`✅ v2 Tweet posted! Tweet ID: ${tweetId}`);

    // 4. GASに成功レスポンスを返す
    console.log("🎉 Process completed successfully (Image Post Attempt)!");
    res.status(200).json({ success: true, tweet_id: tweetId, row_index });

  } catch (e) {
    console.error('❌ An error occurred (API v2 / Image Post Attempt):', e);
    const statusCode = e.code || 500; // エラーオブジェクトにstatus codeがあれば使う
    let errorMessage = e.message || 'An unexpected error occurred.';
    // twitter-api-v2のエラーオブジェクトから詳細を取得する試み
    if (e.data?.errors && e.data.errors.length > 0) {
        errorMessage = `Twitter API Error: ${e.data.errors[0].message}`;
        if (e.data.errors[0].code) errorMessage += ` (code: ${e.data.errors[0].code})`;
