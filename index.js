const express = require('express');
const bodyParser = require('body-parser');
const crypto = require('crypto');
const fetch = require('node-fetch');
const { URLSearchParams } = require('url');

const app = express();
app.use(bodyParser.json());

const PORT = process.env.PORT || 3000;

// --- 環境変数読み込み (サーバー起動時の確認用) ---
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


// --- GETルート (動作確認用) ---
app.get('/', (req, res) => {
  res.status(200).send('✅ Webhook is running!');
});

// --- POSTルート (GASからのリクエストを受け付けるメイン処理) ---
app.post('/', async (req, res) => {
  console.log("===== New Request Received ====="); // ★確認ポイント1
  console.log("🔑 Environment Variables Check inside POST handler:"); // ★確認ポイント2
  console.log("API_KEY exists:", typeof process.env.API_KEY === 'string' && process.env.API_KEY.length > 0);
  console.log("API_SECRET exists:", typeof process.env.API_SECRET === 'string' && process.env.API_SECRET.length > 0);
  console.log("ACCESS_TOKEN exists:", typeof process.env.ACCESS_TOKEN === 'string' && process.env.ACCESS_TOKEN.length > 0);
  console.log("ACCESS_SECRET exists:", typeof process.env.ACCESS_SECRET === 'string' && process.env.ACCESS_SECRET.length > 0);
  console.log("------------------------------------");

  const { tweetText, mediaId, row_index } = req.body;
  const text = tweetText;
  const image_id = mediaId;

  console.log("📩 Received data:", { text: text ? 'Yes' : 'No', image_id: image_id ? 'Yes' : 'No', row_index }); // ★確認ポイント3

  if (!text || !image_id) {
    console.error("❌ Missing parameters:", { text, image_id });
    return res.status(400).json({ error: 'Missing parameters (tweetText or mediaId)' });
  }

  if (!oauth.consumer_key || !oauth.consumer_secret || !oauth.token || !oauth.token_secret) {
    console.error('❌ Missing Twitter API credentials in environment variables!');
    return res.status(500).json({ error: 'Server configuration error: Missing API credentials.' });
  }

  console.log("🚦 Entering try block..."); // ★★★ 追加ログ1 ★★★

  try {
    console.log("🚦 Inside try block, before Google Drive download..."); // ★★★ 追加ログ2 ★★★

    // 1. Google Driveから画像をダウンロード
    console.log(`📥 Downloading image from Google Drive (ID: ${image_id})`); // ★確認ポイント4
    const mediaUrl = `https://drive.google.com/uc?export=download&id=${image_id}`;
    const mediaRes = await fetch(mediaUrl);

    console.log(`🚦 Google Drive fetch status: ${mediaRes.status}`); // ★★★ 追加ログ3 ★★★

    if (!mediaRes.ok) {
        // エラー内容をもう少し詳しくログ出力
        const errorText = await mediaRes.text();
        console.error(`❌ Google Drive download failed! Status: ${mediaRes.status} ${mediaRes.statusText}, Response: ${errorText}`);
        throw new Error(`Failed to download image from Google Drive: ${mediaRes.status} ${mediaRes.statusText}`);
    }
    // Bufferを取得し、Base64エンコードする
    const mediaBuffer = await mediaRes.buffer();
    const mediaData = mediaBuffer.toString('base64');
    console.log(`✅ Image downloaded and encoded (Size: ${mediaBuffer.length} bytes)`); // ★確認ポイント5

    // 2. Twitterに画像をアップロード (media/upload.json)
    console.log("⏳ Uploading media to Twitter..."); // ★確認ポイント6
    const mediaUploadResult = await twitterRequest(
      'https://upload.twitter.com/1.1/media/upload.json',
      'POST',
      { media_data: mediaData }
    );
    const uploadedMediaId = mediaUploadResult.media_id_string;
    console.log(`✅ Media uploaded. Media ID: ${uploadedMediaId}`); // ★確認ポイント7

    // 3. 画像付きツイートを投稿 (statuses/update.json)
    console.log("⏳ Posting tweet with media..."); // ★確認ポイント8
    const tweetResult = await twitterRequest(
      'https://api.twitter.com/1.1/statuses/update.json',
      'POST',
      {
        status: text,
        media_ids: uploadedMediaId
      }
    );
    console.log(`✅ Tweet posted! Tweet ID: ${tweetResult.id_str}`); // ★確認ポイント9

    // 4. GASに成功レスポンスを返す
    res.status(200).json({ success: true, tweet_id: tweetResult.id_str, row_index });

  } catch (e) {
    console.log("🚦 Entered catch block."); // ★★★ 追加ログ4 ★★★
    console.error('❌ An error occurred:', e); // ★確認ポイント10 (前回ここが出力された)
    let errorMessage = 'An unexpected error occurred.';
    let statusCode = 500;
    try {
        const errorJson = JSON.parse(e.message);
        if (errorJson.errors && errorJson.errors.length > 0) {
            errorMessage = `Twitter API Error: ${errorJson.errors[0].message} (code: ${errorJson.errors[0].code})`;
            if (errorJson.errors[0].code === 32) {
                errorMessage += " - Could not authenticate you.";
                statusCode = 401;
            } else {
                statusCode = 400;
            }
        } else {
            errorMessage = e.message;
        }
    } catch (parseError) {
        errorMessage = e.toString();
    }
    res.status(statusCode).json({ error: errorMessage, details: e.toString(), row_index });
  }
});

// --- Twitter APIリクエスト関数 (変更なし) ---
const twitterRequest = async (url, method, params) => {
  const oauth_params = {
    oauth_consumer_key: oauth.consumer_key,
    oauth_nonce: crypto.randomBytes(16).toString('hex'),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_token: oauth.token,
    oauth_version: '1.0'
  };
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
  const oauthHeaderParams = { ...oauth_params, oauth_signature: signature };
  const authHeader = 'OAuth ' + Object.keys(oauthHeaderParams).sort().map(key =>
    `${encodeURIComponent(key)}="${encodeURIComponent(oauthHeaderParams[key])}"`
  ).join(', ');
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
  console.log(`🚀 Requesting to ${url}...`); // ★確認ポイント (API呼び出し前)
  const res = await fetch(url, fetchOptions);
  const responseText = await res.text();
  console.log(`✅ Response from ${url}: ${res.status} ${res.statusText}`); // ★確認ポイント (APIレスポンス後)
  console.log("Raw response body:", responseText); // ★確認ポイント (API生レスポンス)
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
