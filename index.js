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
  res.status(200).send('✅ Webhook is running!');
});

// --- POSTルート (本番処理) ---
app.post('/', async (req, res) => {
  console.log("===== New Request Received ====="); // (ログが表示されるかは不明だが残しておく)
  console.log("🔑 Environment Variables Check inside POST handler:"); // (同上)
  console.log("API_KEY exists:", typeof process.env.API_KEY === 'string' && process.env.API_KEY.length > 0);
  console.log("API_SECRET exists:", typeof process.env.API_SECRET === 'string' && process.env.API_SECRET.length > 0);
  console.log("ACCESS_TOKEN exists:", typeof process.env.ACCESS_TOKEN === 'string' && process.env.ACCESS_TOKEN.length > 0);
  console.log("ACCESS_SECRET exists:", typeof process.env.ACCESS_SECRET === 'string' && process.env.ACCESS_SECRET.length > 0);
  console.log("------------------------------------");

  const { tweetText, mediaId, row_index } = req.body;
  const text = tweetText;
  const image_id = mediaId;

  console.log("📩 Received data:", { text: text ? 'Yes' : 'No', image_id: image_id ? 'Yes' : 'No', row_index });

  // パラメータチェック
  if (!text || !image_id) {
    console.error("❌ Missing parameters:", { text, image_id });
    return res.status(400).json({ error: 'Missing parameters (tweetText or mediaId)' });
  }

  // 環境変数チェック
  if (!oauth.consumer_key || !oauth.consumer_secret || !oauth.token || !oauth.token_secret) {
    console.error('❌ Missing Twitter API credentials in environment variables!');
    return res.status(500).json({ error: 'Server configuration error: Missing API credentials.' });
  }

  console.log("🚦 Entering try block..."); // (ログが表示されるかは不明だが残しておく)

  try {
    console.log("🚦 Inside try block, starting process..."); // (同上)

    // 1. Google Driveから画像をダウンロード
    console.log(`📥 Downloading image from Google Drive (ID: ${image_id})`);
    const mediaUrl = `https://drive.google.com/uc?export=download&id=${image_id}`;
    const mediaRes = await fetch(mediaUrl);

    console.log(`🚦 Google Drive fetch status: ${mediaRes.status}`);

    if (!mediaRes.ok) {
        const errorText = await mediaRes.text();
        console.error(`❌ Google Drive download failed! Status: ${mediaRes.status} ${mediaRes.statusText}, Response: ${errorText}`);
        throw new Error(`Failed to download image from Google Drive: ${mediaRes.status} ${mediaRes.statusText}`);
    }
    const mediaBuffer = await mediaRes.buffer();
    const mediaData = mediaBuffer.toString('base64');
    console.log(`✅ Image downloaded and encoded (Size: ${mediaBuffer.length} bytes)`);

    // 2. Twitterに画像をアップロード (media/upload.json)
    console.log("⏳ Uploading media to Twitter...");
    const mediaUploadResult = await twitterRequest( // ★ twitterRequest を呼び出す
      'https://upload.twitter.com/1.1/media/upload.json',
      'POST',
      { media_data: mediaData }
    );
    // ★★★ ここで mediaUploadResult のログを確認する（twitterRequest内でもログが出るはず）
    const uploadedMediaId = mediaUploadResult.media_id_string;
    if (!uploadedMediaId) {
        console.error("❌ Failed to get media_id_string from Twitter upload response:", mediaUploadResult);
        throw new Error('Failed to upload media to Twitter: media_id_string not found.');
    }
    console.log(`✅ Media uploaded. Media ID: ${uploadedMediaId}`);

    // 3. 画像付きツイートを投稿 (statuses/update.json)
    console.log("⏳ Posting tweet with media...");
    const tweetResult = await twitterRequest( // ★ twitterRequest を呼び出す
      'https://api.twitter.com/1.1/statuses/update.json',
      'POST',
      {
        status: text,
        media_ids: uploadedMediaId
      }
    );
    // ★★★ ここで tweetResult のログを確認する（twitterRequest内でもログが出るはず）
    if (!tweetResult.id_str) {
        console.error("❌ Failed to get tweet id_str from Twitter status update response:", tweetResult);
        throw new Error('Failed to post tweet: id_str not found.');
    }
    console.log(`✅ Tweet posted! Tweet ID: ${tweetResult.id_str}`);

    // 4. GASに成功レスポンスを返す
    console.log("🎉 Process completed successfully!");
    res.status(200).json({ success: true, tweet_id: tweetResult.id_str, row_index });

  } catch (e) {
    console.log("🚦 Entered catch block."); // (ログが表示されるかは不明だが残しておく)
    console.error('❌ An error occurred during the process:', e); // エラー内容をログ出力
    let errorMessage = 'An unexpected error occurred.';
    let statusCode = 500;
    try {
        // Twitter APIエラーかどうかを判定
        const errorJson = JSON.parse(e.message);
        if (errorJson.errors && errorJson.errors.length > 0) {
            errorMessage = `Twitter API Error: ${errorJson.errors[0].message} (code: ${errorJson.errors[0].code})`;
            statusCode = res.statusCode >= 400 ? res.statusCode : 400; // エラーコードに応じてステータス変更試行
            if (errorJson.errors[0].code === 32) {
                errorMessage += " - Could not authenticate you.";
                statusCode = 401; // 認証エラー
            }
        } else {
             errorMessage = e.message; // Twitter形式でないエラーメッセージ
        }
    } catch (parseError) {
        // JSONパース失敗 (Google Driveエラーなど、他のエラー)
        errorMessage = e.toString();
    }
    // GASにエラーレスポンスを返す
    res.status(statusCode).json({ error: errorMessage, details: e.toString(), row_index });
  }
});

// --- Twitter APIリクエスト関数 (修正済みバージョン) ---
const twitterRequest = async (url, method, params) => {
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
    delete paramsForSignature.media_data; // media_dataは署名ベース文字列から除外
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
    // media/upload は application/x-www-form-urlencoded
    contentTypeHeader['Content-Type'] = 'application/x-www-form-urlencoded';
    bodyContent = new URLSearchParams(params).toString(); // ★ URLSearchParams を使う
  } else if (method.toUpperCase() === 'POST') {
    // statuses/update などは application/json
    contentTypeHeader['Content-Type'] = 'application/json';
    bodyContent = JSON.stringify(params);
  }
  if (bodyContent) {
    fetchOptions.headers = { ...fetchOptions.headers, ...contentTypeHeader };
    fetchOptions.body = bodyContent;
  }

  // ★★★ ここからのログが重要 ★★★
  console.log(`🚀 Requesting to ${url}...`);
  // console.log("Request Headers:", fetchOptions.headers); // 必要に応じてヘッダー詳細を確認
  // console.log("Request Body Preview:", typeof bodyContent === 'string' ? bodyContent.substring(0, 100) + '...' : 'No Body'); // ボディが長い場合に備える

  const res = await fetch(url, fetchOptions);
  const responseText = await res.text(); // まずテキストで取得

  // ★★★ ここからのログが重要 ★★★
  console.log(`✅ Response from ${url}: ${res.status} ${res.statusText}`);
  console.log("Raw response body:", responseText); // APIからの生のレスポンスは必ず確認する

  let json;
  try {
    json = JSON.parse(responseText);
  } catch (e) {
    if (!res.ok) { // JSONパース失敗かつレスポンスがエラーの場合
      throw new Error(`API request failed (${res.status} ${res.statusText}): ${responseText}`);
    } else if (responseText.trim() === '') { // 成功レスポンスだがボディが空の場合
       return {};
    } else { // 成功レスポンスだがJSONでない場合
       console.warn("Response was successful but not valid JSON:", responseText);
       return responseText;
    }
  }

  if (!res.ok) { // レスポンスがエラーの場合
    console.error(`❌ Twitter API Error Response (${url}):`, JSON.stringify(json));
    throw new Error(JSON.stringify(json)); // エラーJSONを投げる
  }

  return json; // 成功した場合、パースしたJSONを返す
};


// --- サーバー起動 ---
app.listen(PORT, () => {
  console.log(`🚀 Server listening on port ${PORT}`);
});

module.exports = app;
