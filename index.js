const express = require('express');
const bodyParser = require('body-parser');
const crypto = require('crypto'); // crypto は twitterRequest で使うので残す
const fetch = require('node-fetch'); // fetch は twitterRequest で使うので残す
const { URLSearchParams } = require('url'); // URLSearchParams も twitterRequest で使うので残す

const app = express();
app.use(bodyParser.json());

const PORT = process.env.PORT || 3000;

// --- 環境変数読み込み ---
const oauth = {
  consumer_key: process.env.API_KEY,
  consumer_secret: process.env.API_SECRET,
  token: process.env.ACCESS_TOKEN,
  token_secret: process.env.ACCESS_SECRET
};
console.log("--- Initial Environment Variables ---");
console.log("API_KEY loaded:", !!oauth.consumer_key);
console.log("API_SECRET loaded:", !!oauth.consumer_secret);
console.log("ACCESS_TOKEN loaded:", !!oauth.token);
console.log("ACCESS_SECRET loaded:", !!oauth.token_secret);
console.log("------------------------------------");


// --- GETルート ---
app.get('/', (req, res) => {
  res.status(200).send('✅ Webhook is running! (Simple Test Mode)');
});

// --- POSTルート (シンプルテスト版) ---
app.post('/', async (req, res) => {
  console.log("===== New Request Received (Simple Test Mode) ====="); // ★確認ポイント1
  console.log("🔑 Environment Variables Check inside POST handler:"); // ★確認ポイント2
  console.log("API_KEY exists:", typeof process.env.API_KEY === 'string' && process.env.API_KEY.length > 0);
  console.log("API_SECRET exists:", typeof process.env.API_SECRET === 'string' && process.env.API_SECRET.length > 0);
  console.log("ACCESS_TOKEN exists:", typeof process.env.ACCESS_TOKEN === 'string' && process.env.ACCESS_TOKEN.length > 0);
  console.log("ACCESS_SECRET exists:", typeof process.env.ACCESS_SECRET === 'string' && process.env.ACCESS_SECRET.length > 0);
  console.log("------------------------------------");

  const { tweetText, mediaId, row_index } = req.body;
  console.log("📩 Received data:", { text: tweetText ? 'Yes' : 'No', mediaId: mediaId ? 'Yes' : 'No', row_index }); // ★確認ポイント3

  // --- ここから下の処理を一時的にコメントアウト ---
  /*
  if (!tweetText || !mediaId) {
    console.error("❌ Missing parameters:", { tweetText, mediaId });
    return res.status(400).json({ error: 'Missing parameters (tweetText or mediaId)' });
  }

  if (!oauth.consumer_key || !oauth.consumer_secret || !oauth.token || !oauth.token_secret) {
    console.error('❌ Missing Twitter API credentials in environment variables!');
    return res.status(500).json({ error: 'Server configuration error: Missing API credentials.' });
  }

  console.log("🚦 Entering try block...");

  try {
    console.log("🚦 Inside try block, before Google Drive download...");
    console.log(`📥 Downloading image from Google Drive (ID: ${mediaId})`);
    const mediaUrl = `https://drive.google.com/uc?export=download&id=${mediaId}`;
    // const mediaRes = await fetch(mediaUrl); // ★コメントアウト
    console.log(`🚦 Google Drive fetch status: SKIPPED IN TEST MODE`); // ★変更
    // if (!mediaRes.ok) { ... } // ★コメントアウト
    // const mediaBuffer = await mediaRes.buffer(); // ★コメントアウト
    // const mediaData = mediaBuffer.toString('base64'); // ★コメントアウト
    const mediaData = "dGVzdA=="; // ダミーデータ (base64で "test" )
    console.log(`✅ Image download SKIPPED. Using dummy data.`); // ★変更

    console.log("⏳ Uploading media to Twitter...");
    // const mediaUploadResult = await twitterRequest(...) // ★コメントアウト
    const uploadedMediaId = "dummy_media_id_123"; // ダミーデータ
    console.log(`✅ Media upload SKIPPED. Using dummy Media ID: ${uploadedMediaId}`); // ★変更

    console.log("⏳ Posting tweet with media...");
    // const tweetResult = await twitterRequest(...) // ★コメントアウト
    const tweetResult = { id_str: "dummy_tweet_id_456" }; // ダミーデータ
    console.log(`✅ Tweet post SKIPPED! Using dummy Tweet ID: ${tweetResult.id_str}`); // ★変更

    res.status(200).json({ success: true, tweet_id: tweetResult.id_str, row_index, message: "Simple Test Mode OK" }); // ★変更

  } catch (e) {
    console.log("🚦 Entered catch block.");
    console.error('❌ An error occurred:', e);
    // (エラーハンドリング部分はそのまま)
    let errorMessage = 'An unexpected error occurred.';
    let statusCode = 500;
    // ... (エラー処理は変更なし) ...
    res.status(statusCode).json({ error: errorMessage, details: e.toString(), row_index });
  }
  */
  // --- コメントアウトここまで ---

  // ★★★ シンプルテスト用のレスポンス ★★★
  console.log("✅ Reached end of Simple Test Mode handler. Sending success response.");
  res.status(200).json({
    success: true,
    message: "Simple Test Mode executed successfully. Logging environment variables.",
    env_check: {
        apiKeyExists: typeof process.env.API_KEY === 'string' && process.env.API_KEY.length > 0,
        apiSecretExists: typeof process.env.API_SECRET === 'string' && process.env.API_SECRET.length > 0,
        accessTokenExists: typeof process.env.ACCESS_TOKEN === 'string' && process.env.ACCESS_TOKEN.length > 0,
        accessSecretExists: typeof process.env.ACCESS_SECRET === 'string' && process.env.ACCESS_SECRET.length > 0,
    },
    row_index: row_index || null // GASから渡されたrow_indexを返す
  });

});

// --- Twitter APIリクエスト関数 (変更なし、ただし呼び出されないはず) ---
const twitterRequest = async (url, method, params) => {
  console.warn("🚨 twitterRequest function called unexpectedly in Simple Test Mode!"); // 念のため警告
  // (中身は変更なし)
  const oauth_params = { /* ... */ };
  const paramsForSignature = { /* ... */ };
  const allParamsForSignature = { /* ... */ };
  const baseParams = /* ... */ ;
  const baseString = /* ... */ ;
  const signingKey = /* ... */ ;
  const signature = /* ... */ ;
  const oauthHeaderParams = { /* ... */ };
  const authHeader = /* ... */ ;
  let bodyContent;
  let contentTypeHeader = {};
  const fetchOptions = { /* ... */ };
  if (url.includes('media/upload.json')) { /* ... */ }
  else if (method.toUpperCase() === 'POST') { /* ... */ }
  if (bodyContent) { /* ... */ }
  console.log(`🚀 Requesting to ${url}...`);
  const res = await fetch(url, fetchOptions);
  const responseText = await res.text();
  console.log(`✅ Response from ${url}: ${res.status} ${res.statusText}`);
  console.log("Raw response body:", responseText);
  let json;
  try { /* ... */ } catch (e) { /* ... */ }
  if (!res.ok) { /* ... */ }
  return json;
};


// --- サーバー起動 ---
app.listen(PORT, () => {
  console.log(`🚀 Server listening on port ${PORT}`);
});

module.exports = app;
