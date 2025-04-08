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
// (起動時のログは省略)

// --- GETルート ---
app.get('/', (req, res) => {
  res.status(200).send('✅ Webhook is running!');
});

// --- POSTルート (本番処理) ---
app.post('/', async (req, res) => {
  // (ハンドラ冒頭のログは省略)
  const { tweetText, mediaId, row_index } = req.body;
  const text = tweetText;
  const image_id = mediaId;

  if (!text || !image_id) { /* ... エラー処理 ... */ }
  if (!oauth.consumer_key || !oauth.consumer_secret || !oauth.token || !oauth.token_secret) { /* ... エラー処理 ... */ }

  try {
    // 1. Google Driveから画像をダウンロード
    // (ダウンロード処理は省略)
    const mediaUrl = `https://drive.google.com/uc?export=download&id=${image_id}`;
    const mediaRes = await fetch(mediaUrl);
    if (!mediaRes.ok) { /* ... エラー処理 ... */ }
    const mediaBuffer = await mediaRes.buffer();
    const mediaData = mediaBuffer.toString('base64');

    // 2. Twitterに画像をアップロード (media/upload.json)
    console.log("⏳ Uploading media to Twitter...");
    const mediaUploadResult = await twitterRequest(
      'https://upload.twitter.com/1.1/media/upload.json',
      'POST',
      { media_data: mediaData } // ★ media_data を渡す
    );
    const uploadedMediaId = mediaUploadResult.media_id_string;
    if (!uploadedMediaId) { /* ... エラー処理 ... */ }
    console.log(`✅ Media uploaded. Media ID: ${uploadedMediaId}`);

    // 3. 画像付きツイートを投稿 (statuses/update.json)
    console.log("⏳ Posting tweet with media...");
    const tweetResult = await twitterRequest(
      'https://api.twitter.com/1.1/statuses/update.json',
      'POST',
      { status: text, media_ids: uploadedMediaId } // ★ status と media_ids を渡す
    );
     if (!tweetResult.id_str) { /* ... エラー処理 ... */ }
    console.log(`✅ Tweet posted! Tweet ID: ${tweetResult.id_str}`);

    // 4. GASに成功レスポンスを返す
    console.log("🎉 Process completed successfully!");
    res.status(200).json({ success: true, tweet_id: tweetResult.id_str, row_index });

  } catch (e) {
    // (エラー処理は省略)
     console.error('❌ An error occurred during the process:', e);
     // ... エラーレスポンス送信 ...
     res.status(500).json({ error: e.toString(), row_index }); // シンプルなエラー返し
  }
});

// --- Twitter APIリクエスト関数 (詳細ログ追加バージョン) ---
const twitterRequest = async (url, method, params) => {
  console.log(`\n--- Preparing Twitter Request for: ${url} ---`); // リクエスト開始ログ

  // OAuth認証に必要な基本パラメータ
  const oauth_params = {
    oauth_consumer_key: oauth.consumer_key,
    oauth_nonce: crypto.randomBytes(16).toString('hex'),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_token: oauth.token,
    oauth_version: '1.0'
  };
  // ★★★ デバッグログ追加 1 ★★★
  console.log("Debug Log 1: Basic OAuth Params:", oauth_params);

  // --- 署名を作成 ---
  const paramsForSignature = { ...params };
  // media/upload.json で media_data を使う場合、署名ベース文字列から除外
  if (url.includes('media/upload.json') && paramsForSignature.media_data) {
      console.log("Debug Log 2: Excluding media_data from signature base string for media/upload.");
      delete paramsForSignature.media_data;
  }
  // statuses/update.json の場合、statusとmedia_idsは署名に含める
  const allParamsForSignature = { ...oauth_params, ...paramsForSignature };
  // ★★★ デバッグログ追加 2 ★★★
  console.log("Debug Log 3: All Params included in Signature Base:", allParamsForSignature);


  // パラメータをキーでアルファベット順にソートし、"key=value" の形式でエンコードして'&'で結合
  const baseParams = Object.keys(allParamsForSignature).sort().map(key => (
    // 重要: キーも値も両方エンコードする
    `${encodeURIComponent(key)}=${encodeURIComponent(allParamsForSignature[key])}`
  )).join('&');
  // ★★★ デバッグログ追加 3 ★★★
  console.log("Debug Log 4: Parameter String (baseParams):", baseParams);

  // 署名ベース文字列を作成 (HTTPメソッド & URLエンコードしたAPI URL & URLエンコードしたパラメータ文字列)
  const baseString = [
    method.toUpperCase(),
    encodeURIComponent(url),
    encodeURIComponent(baseParams) // パラメータ文字列全体をさらにエンコード
  ].join('&');
   // ★★★ デバッグログ追加 4 ★★★
   console.log("Debug Log 5: Signature Base String (baseString):", baseString);

  // 署名キーを作成 (コンシューマーシークレット & アクセストークンシークレット)
  const signingKey = `${encodeURIComponent(oauth.consumer_secret)}&${encodeURIComponent(oauth.token_secret)}`;
  // ★★★ デバッグログ追加 5 ★★★
  // console.log("Debug Log 6: Signing Key (signingKey):", signingKey); // シークレットが含まれるので通常はログ出力しない

  // HMAC-SHA1で署名し、Base64エンコード
  const signature = crypto.createHmac('sha1', signingKey).update(baseString).digest('base64');
   // ★★★ デバッグログ追加 6 ★★★
   console.log("Debug Log 7: Generated Signature (signature):", signature);
  // --- 署名作成完了 ---

  // --- Authorizationヘッダーを作成 ---
  const oauthHeaderParams = { ...oauth_params, oauth_signature: signature };
  const authHeader = 'OAuth ' + Object.keys(oauthHeaderParams).sort().map(key =>
    `${encodeURIComponent(key)}="${encodeURIComponent(oauthHeaderParams[key])}"`
  ).join(', ');
   // ★★★ デバッグログ追加 7 ★★★
   console.log("Debug Log 8: Authorization Header (authHeader):", authHeader);
  // --- Authorizationヘッダー作成完了 ---

  // --- リクエストオプションを設定 ---
  let bodyContent;
  let contentTypeHeader = {};
  const fetchOptions = {
    method,
    headers: { Authorization: authHeader },
  };

  if (url.includes('media/upload.json')) {
    contentTypeHeader['Content-Type'] = 'application/x-www-form-urlencoded';
    // params には media_data が含まれている前提
    bodyContent = new URLSearchParams(params).toString();
    console.log("Debug Log 9: Body for media/upload (urlencoded). Preview:", bodyContent.substring(0,100) + "...");
  } else if (method.toUpperCase() === 'POST') {
    contentTypeHeader['Content-Type'] = 'application/json';
    // params には status, media_ids が含まれている前提
    bodyContent = JSON.stringify(params);
     console.log("Debug Log 10: Body for status update (JSON):", bodyContent);
  }
  if (bodyContent) {
    fetchOptions.headers = { ...fetchOptions.headers, ...contentTypeHeader };
    fetchOptions.body = bodyContent;
  }
  // --- リクエストオプション設定完了 ---

  console.log(`🚀 Requesting to ${url}...`);
  const res = await fetch(url, fetchOptions);
  const responseText = await res.text();
  console.log(`✅ Response from ${url}: ${res.status} ${res.statusText}`);
  console.log("Raw response body:", responseText);

  // (レスポンス処理は変更なし)
  let json;
  try { /* ... */ } catch (e) { /* ... */ }
  if (!res.ok) { /* ... */ throw new Error(JSON.stringify(json)); }
  return json;
};


// --- サーバー起動 ---
app.listen(PORT, () => {
  console.log(`🚀 Server listening on port ${PORT}`);
});

module.exports = app;
