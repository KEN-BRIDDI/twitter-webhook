const express = require('express');
const bodyParser = require('body-parser'); // bodyParserも念のため残しておきます
const crypto = require('crypto');
const fetch = require('node-fetch');
const { URLSearchParams } = require('url'); // URLSearchParams をインポート

const app = express();
app.use(bodyParser.json()); // JSON形式のリクエストボディを扱えるようにする

const PORT = process.env.PORT || 3000;

// --- 環境変数読み込み (サーバー起動時の確認用) ---
// これらのログはVercelのデプロイログや、インスタンス起動時に出る可能性があります
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
  // ★★★ ステップ4で確認する箇所1 ★★★
  console.log("===== New Request Received =====");
  console.log("🔑 Environment Variables Check inside POST handler:");
  console.log("API_KEY exists:", typeof process.env.API_KEY === 'string' && process.env.API_KEY.length > 0);
  console.log("API_SECRET exists:", typeof process.env.API_SECRET === 'string' && process.env.API_SECRET.length > 0);
  console.log("ACCESS_TOKEN exists:", typeof process.env.ACCESS_TOKEN === 'string' && process.env.ACCESS_TOKEN.length > 0);
  console.log("ACCESS_SECRET exists:", typeof process.env.ACCESS_SECRET === 'string' && process.env.ACCESS_SECRET.length > 0);
  console.log("------------------------------------");

  const { tweetText, mediaId, row_index } = req.body;
  const text = tweetText;
  const image_id = mediaId; // Google Driveの画像ID

  console.log("📩 Received data:", { text: text ? 'Yes' : 'No', image_id: image_id ? 'Yes' : 'No', row_index });

  // パラメータが不足している場合はエラーを返す
  if (!text || !image_id) {
    console.error("❌ Missing parameters:", { text, image_id });
    return res.status(400).json({ error: 'Missing parameters (tweetText or mediaId)' });
  }

  // 環境変数が一つでも欠けていたら処理を中断してエラーを返す
  if (!oauth.consumer_key || !oauth.consumer_secret || !oauth.token || !oauth.token_secret) {
    console.error('❌ Missing Twitter API credentials in environment variables!');
    return res.status(500).json({ error: 'Server configuration error: Missing API credentials.' });
  }

  try {
    // 1. Google Driveから画像をダウンロード
    console.log(`📥 Downloading image from Google Drive (ID: ${image_id})`);
    const mediaUrl = `https://drive.google.com/uc?export=download&id=${image_id}`;
    const mediaRes = await fetch(mediaUrl);

    if (!mediaRes.ok) {
        throw new Error(`Failed to download image from Google Drive: ${mediaRes.status} ${mediaRes.statusText}`);
    }
    // Bufferを取得し、Base64エンコードする
    const mediaBuffer = await mediaRes.buffer();
    const mediaData = mediaBuffer.toString('base64');
    console.log(`✅ Image downloaded and encoded to Base64 (Size: ${mediaBuffer.length} bytes)`);

    // 2. Twitterに画像をアップロード (media/upload.json)
    console.log("⏳ Uploading media to Twitter...");
    const mediaUploadResult = await twitterRequest(
      'https://upload.twitter.com/1.1/media/upload.json',
      'POST',
      { media_data: mediaData } // media_dataパラメータで送信
    );
    const uploadedMediaId = mediaUploadResult.media_id_string; // アップロードされた画像のIDを取得
    console.log(`✅ Media uploaded successfully. Media ID: ${uploadedMediaId}`);

    // 3. 画像付きツイートを投稿 (statuses/update.json)
    console.log("⏳ Posting tweet with media...");
    const tweetResult = await twitterRequest(
      'https://api.twitter.com/1.1/statuses/update.json',
      'POST',
      {
        status: text, // ツイート本文
        media_ids: uploadedMediaId // アップロードした画像のIDを指定
      }
    );
    console.log(`✅ Tweet posted successfully! Tweet ID: ${tweetResult.id_str}`);

    // 4. GASに成功レスポンスを返す
    res.status(200).json({ success: true, tweet_id: tweetResult.id_str, row_index });

  } catch (e) {
    console.error('❌ An error occurred:', e);
    // エラー内容を判断して、より分かりやすいメッセージをGASに返す試み
    let errorMessage = 'An unexpected error occurred.';
    let statusCode = 500;
    try {
        // Twitter APIからのエラーはJSON文字列になっている可能性がある
        const errorJson = JSON.parse(e.message);
        if (errorJson.errors && errorJson.errors.length > 0) {
            errorMessage = `Twitter API Error: ${errorJson.errors[0].message} (code: ${errorJson.errors[0].code})`;
            if (errorJson.errors[0].code === 32) {
                errorMessage += " - Could not authenticate you. Check API keys/tokens and permissions.";
                statusCode = 401; // 認証エラー
            } else {
                statusCode = 400; // API側の問題によるエラーの可能性
            }
        } else {
            errorMessage = e.message; // JSONではないエラーメッセージ
        }
    } catch (parseError) {
        // JSONパースに失敗した場合（Twitter API以外のエラーなど）
        errorMessage = e.toString();
    }
    res.status(statusCode).json({ error: errorMessage, details: e.toString(), row_index });
  }
});

// --- Twitter APIリクエスト関数 (OAuth 1.0a 署名付き) ---
const twitterRequest = async (url, method, params) => {
  // OAuth認証に必要な基本パラメータ
  const oauth_params = {
    oauth_consumer_key: oauth.consumer_key,
    oauth_nonce: crypto.randomBytes(16).toString('hex'), // ユニークな文字列を生成
    oauth_signature_method: 'HMAC-SHA1', // 署名方式
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(), // 現在時刻（Unixタイムスタンプ）
    oauth_token: oauth.token, // アクセストークン
    oauth_version: '1.0' // OAuthのバージョン
  };

  // --- 署名を作成 ---
  // 1. 署名対象となる全パラメータを結合 (OAuthパラメータ + リクエスト固有パラメータ)
  //    media/upload.json で media_data を使う場合、media_data自体は署名ベース文字列に含めないのが安全
  const paramsForSignature = { ...params };
  if (url.includes('media/upload.json') && paramsForSignature.media_data) {
    // media_data は非常に長くなる可能性があり、署名ベース文字列に含めると問題を起こすことがあるため除外
    delete paramsForSignature.media_data;
  }
  const allParamsForSignature = { ...oauth_params, ...paramsForSignature };

  // 2. パラメータをキーでアルファベット順にソートし、"key=value" の形式でエンコードして'&'で結合
  const baseParams = Object.keys(allParamsForSignature).sort().map(key => (
    `${encodeURIComponent(key)}=${encodeURIComponent(allParamsForSignature[key])}`
  )).join('&');

  // 3. 署名ベース文字列を作成 (HTTPメソッド & URLエンコードしたAPI URL & URLエンコードしたパラメータ文字列)
  const baseString = [
    method.toUpperCase(),
    encodeURIComponent(url),
    encodeURIComponent(baseParams)
  ].join('&');

  // 4. 署名キーを作成 (コンシューマーシークレット & アクセストークンシークレット)
  const signingKey = `${encodeURIComponent(oauth.consumer_secret)}&${encodeURIComponent(oauth.token_secret)}`;

  // 5. HMAC-SHA1で署名し、Base64エンコード
  const signature = crypto.createHmac('sha1', signingKey).update(baseString).digest('base64');
  // --- 署名作成完了 ---

  // --- Authorizationヘッダーを作成 ---
  // ヘッダーにはOAuthパラメータと生成した署名を含める
  const oauthHeaderParams = { ...oauth_params, oauth_signature: signature };
  // ヘッダー用に再度、キーでソートし、エンコードしてフォーマットする
  const authHeader = 'OAuth ' + Object.keys(oauthHeaderParams).sort().map(key =>
    `${encodeURIComponent(key)}="${encodeURIComponent(oauthHeaderParams[key])}"`
  ).join(', ');
  // --- Authorizationヘッダー作成完了 ---

  // --- リクエストオプションを設定 ---
  let bodyContent;
  let contentTypeHeader = {}; // Content-Typeヘッダーを格納するオブジェクト
  const fetchOptions = {
    method,
    headers: {
      Authorization: authHeader // 作成したAuthorizationヘッダーを設定
    },
  };

  // エンドポイントに応じてContent-TypeとBodyを設定
  if (url.includes('media/upload.json')) {
    // media/upload は application/x-www-form-urlencoded
    contentTypeHeader['Content-Type'] = 'application/x-www-form-urlencoded';
    // URLSearchParamsを使って key=value&key=value... の形式に変換
    bodyContent = new URLSearchParams(params).toString();

  } else if (method.toUpperCase() === 'POST') { // POSTリクエストでmedia/upload以外の場合
    // statuses/update などは application/json で送信
    contentTypeHeader['Content-Type'] = 'application/json';
    bodyContent = JSON.stringify(params);
  }
  // Content-Typeヘッダーを追加 (GETなどBodyがない場合は不要)
  if (bodyContent) {
    fetchOptions.headers = { ...fetchOptions.headers, ...contentTypeHeader };
    fetchOptions.body = bodyContent;
  }
  // --- リクエストオプション設定完了 ---

  // ★★★ ステップ4で確認する箇所2 ★★★
  console.log(`🚀 Requesting to ${url}...`);
  // console.log("Request Headers:", fetchOptions.headers); // 必要ならヘッダーもログ出力
  // console.log("Request Body Preview:", typeof fetchOptions.body === 'string' ? fetchOptions.body.substring(0, 100) + '...' : 'No Body'); // ボディが長いのでプレビュー

  // --- APIリクエスト実行 ---
  const res = await fetch(url, fetchOptions);
  const responseText = await res.text(); // まずレスポンスをテキストとして取得

  // ★★★ ステップ4で確認する箇所3 ★★★
  console.log(`✅ Response from ${url}: ${res.status} ${res.statusText}`);
  console.log("Raw response body:", responseText); // APIからの生レスポンス内容を確認

  // --- レスポンス処理 ---
  let json;
  try {
    json = JSON.parse(responseText); // テキストをJSONとしてパース試行
  } catch (e) {
    // JSONパースに失敗した場合 (レスポンスがJSONでない、または空の場合など)
    if (!res.ok) {
      // レスポンスステータスがエラーなら、テキスト内容をエラーメッセージとして投げる
      throw new Error(`API request failed (${res.status} ${res.statusText}): ${responseText}`);
    } else if (responseText.trim() === '') {
       // 成功レスポンスだがボディが空の場合 (例: 204 No Content など)
       return {}; // 空のオブジェクトを返すか、nullなどを返す
    } else {
      // 成功レスポンスだがJSONでない場合（通常は考えにくい）
       console.warn("Response was successful but not valid JSON:", responseText);
       return responseText; // テキストをそのまま返す
    }
  }

  // レスポンスステータスがエラー (2xxでない) 場合、エラー情報を投げる
  if (!res.ok) {
    console.error(`❌ Twitter API Error Response (${url}):`, JSON.stringify(json));
    // Twitter APIエラーはjsonオブジェクトとしてエラー情報を返すことが多いので、それをそのまま投げる
    throw new Error(JSON.stringify(json)); // エラー内容を保持したまま投げる
  }

  // 成功した場合、パースしたJSONを返す
  return json;
};


// --- サーバー起動 ---
app.listen(PORT, () => {
  console.log(`🚀 Server listening on port ${PORT}`);
});

// VercelでExpressアプリを使う場合のおまじない
module.exports = app;
