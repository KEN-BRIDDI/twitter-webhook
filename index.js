const express = require('express');
const bodyParser = require('body-parser');
const crypto = require('crypto');
const fetch = require('node-fetch');
const { URLSearchParams } = require('url');

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

  // --- Twitter/Google Drive 関連の処理はコメントアウトしたまま ---
  /*
  if (!tweetText || !mediaId) { ... }
  if (!oauth.consumer_key || ...) { ... }
  console.log("🚦 Entering try block...");
  try {
    console.log("🚦 Inside try block, before Google Drive download...");
    // ... (Google Driveダウンロード、Twitter API呼び出し部分はコメントアウトのまま) ...
    res.status(200).json({ success: true, tweet_id: tweetResult.id_str, row_index, message: "Simple Test Mode OK" });
  } catch (e) {
    // ... (catchブロックはコメントアウトのまま) ...
  }
  */
  // --- コメントアウトここまで ---

  // ★★★ シンプルテスト用のレスポンス ★★★
  console.log("✅ Reached end of Simple Test Mode handler. Sending success response."); // ★確認ポイント4
  res.status(200).json({
    success: true,
    message: "Simple Test Mode executed successfully. Logging environment variables.",
    env_check: {
        apiKeyExists: typeof process.env.API_KEY === 'string' && process.env.API_KEY.length > 0,
        apiSecretExists: typeof process.env.API_SECRET === 'string' && process.env.API_SECRET.length > 0,
        accessTokenExists: typeof process.env.ACCESS_TOKEN === 'string' && process.env.ACCESS_TOKEN.length > 0,
        accessSecretExists: typeof process.env.ACCESS_SECRET === 'string' && process.env.ACCESS_SECRET.length > 0,
    },
    row_index: row_index || null
  });

});

// --- Twitter APIリクエスト関数 (今回は呼び出されないが、正しいコードに戻す) ---
const twitterRequest = async (url, method, params) => {
  // console.warn("🚨 twitterRequest function called unexpectedly in Simple Test Mode!"); // シンプルテストでは呼ばれないはず

  // OAuth認証に必要な基本パラメータ
  const oauth_params = {
    oauth_consumer_key: oauth.consumer_key,
    oauth_nonce: crypto.randomBytes(16).toString('hex'),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_token: oauth.token,
    oauth_version: '1.0'
  };

  // 署名を作成
  const paramsForSignature = { ...params };
  if (url.includes('media/upload.json') && paramsForSignature.media_data) {
    delete paramsForSignature.media_data;
  }
  const allParamsForSignature = { ...oauth_params, ...paramsForSignature };
  const baseParams = Object.keys(allParamsForSignature).sort().map(key => (
    `${encodeURIComponent(key)}=${encodeURIComponent(allParamsForSignature[key])}`
  )).join('&');
  const baseString = [
    method.toUpperCase(),
    encodeURIComponent(url),
    encodeURIComponent(baseParams)
  ].join('&');
  const signingKey = `${encodeURIComponent(oauth.consumer_secret)}&${encodeURIComponent(oauth.token_secret)}`;
  const signature = crypto.createHmac('sha1', signingKey).update(baseString).digest('base64');

  // Authorizationヘッダーを作成
  const oauthHeaderParams = { ...oauth_params, oauth_signature: signature };
  const authHeader = 'OAuth ' + Object.keys(oauthHeaderParams).sort().map(key =>
    `${encodeURIComponent(key)}="${encodeURIComponent(oauthHeaderParams[key])}"`
  ).join(', ');

  // リクエストオプションを設定
  let bodyContent;
  let contentTypeHeader = {};
  const fetchOptions = {
    method,
    headers: { Authorization: authHeader },
  };
  if (url.includes('media/upload.json')) {
    contentTypeHeader['Content-Type'] = 'application/x-www-form-urlencoded';
    bodyContent = new URLSearchParams(params).toString();
  } else if (method.toUpperCase() === 'POST') {
    contentTypeHeader['Content-Type'] = 'application/json';
    bodyContent = JSON.stringify(params);
  }
  if (bodyContent) {
    fetchOptions.headers = { ...fetchOptions.headers, ...contentTypeHeader };
    fetchOptions.body = bodyContent;
  }

  console.log(`🚀 Requesting to ${url}...`);
  const res = await fetch(url, fetchOptions);
  const responseText = await res.text();
  console.log(`✅ Response from ${url}: ${res.status} ${res.statusText}`);
  console.log("Raw response body:", responseText);
  let json;
  try {
    json = JSON.parse(responseText);
  } catch (e) {
    if (!res.ok) {
      throw new Error(`API request failed (${res.status} ${res.statusText}): ${responseText}`);
    } else if (responseText.trim() === '') {
       return {};
    } else {
       console.warn("Response was successful but not valid JSON:", responseText);
       return responseText;
    }
  }
  if (!res.ok) {
    console.error(`❌ Twitter API Error Response (${url}):`, JSON.stringify(json));
    throw new Error(JSON.stringify(json));
  }
  return json;
};


// --- サーバー起動 ---
app.listen(PORT, () => {
  console.log(`🚀 Server listening on port ${PORT}`);
});

module.exports = app;
