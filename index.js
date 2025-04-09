const express = require('express');
const bodyParser = require('body-parser');
const fetch = require('node-fetch'); // Google Driveからのダウンロードに必要
const { TwitterApi } = require('twitter-api-v2'); // ★ Twitter API v2 ライブラリをインポート
const { MimeType } = require('twitter-api-v2'); // ★ MimeType定数をインポート

const app = express();
app.use(bodyParser.json());

const PORT = process.env.PORT || 3000;

// --- Twitter API Client の初期化 ---
// 環境変数からキーとトークンを読み込んでクライアントを設定
const twitterClient = new TwitterApi({
  appKey: process.env.API_KEY,
  appSecret: process.env.API_SECRET,
  accessToken: process.env.ACCESS_TOKEN,
  accessSecret: process.env.ACCESS_SECRET,
});

// 読み書き可能なクライアントインスタンスを取得 (v1, v2 APIへのアクセス用)
const rwClient = twitterClient.readWrite;
console.log("Twitter API v2 client initialized.");


// --- GETルート ---
app.get('/', (req, res) => {
  res.status(200).send('✅ Webhook is running! (Using twitter-api-v2)');
});

// --- POSTルート (API v2版) ---
app.post('/', async (req, res) => {
  console.log("===== New Request Received (API v2) =====");
  const { tweetText, mediaId, row_index } = req.body;
  const text = tweetText;
  const image_id = mediaId; // Google Driveの画像ID

  console.log("📩 Received data:", { text: text ? 'Yes' : 'No', image_id: image_id ? 'Yes' : 'No', row_index });

  // パラメータチェック
  if (!text || !image_id) {
    console.error("❌ Missing parameters:", { text, image_id });
    return res.status(400).json({ error: 'Missing parameters (tweetText or mediaId)' });
  }

  // 環境変数は client 初期化時にチェックされるが念のため
  if (!process.env.API_KEY || !process.env.API_SECRET || !process.env.ACCESS_TOKEN || !process.env.ACCESS_SECRET) {
     console.error('❌ Missing Twitter API credentials in environment variables!');
     return res.status(500).json({ error: 'Server configuration error: Missing API credentials.' });
  }

  try {
    // 1. Google Driveから画像をダウンロード (ここは変更なし)
    console.log(`📥 Downloading image from Google Drive (ID: ${image_id})`);
    const mediaUrl = `https://drive.google.com/uc?export=download&id=${image_id}`;
    const mediaRes = await fetch(mediaUrl);

    if (!mediaRes.ok) {
        const errorText = await mediaRes.text();
        console.error(`❌ Google Drive download failed! Status: ${mediaRes.status} ${mediaRes.statusText}, Response: ${errorText}`);
        throw new Error(`Failed to download image from Google Drive: ${mediaRes.status} ${mediaRes.statusText}`);
    }
    // 画像データを Buffer として取得
    const mediaBuffer = await mediaRes.buffer();
    console.log(`✅ Image downloaded (Size: ${mediaBuffer.length} bytes)`);

    // ---- ここから twitter-api-v2 ライブラリを使用 ----

    // 2. Twitterに画像をアップロード (ライブラリ経由で v1.1 API を利用)
    console.log("⏳ Uploading media via twitter-api-v2 library...");
    // 画像の種類を判別 (例: JPEGの場合) - 必要に応じてPNGなども判定
    // Google DriveからContent-Typeを取得できればベストだが、一旦決め打ち
    let mimeType = MimeType.Jpeg; // デフォルトをJPEGとする例
    // もし他の形式も扱うなら、mediaRes.headers.get('content-type') 等で判定するロジックが必要
    // 例: const contentType = mediaRes.headers.get('content-type');
    // if (contentType === 'image/png') mimeType = MimeType.Png;
    // else if (contentType === 'image/gif') mimeType = MimeType.Gif;
    // else if (contentType === 'image/webp') mimeType = MimeType.Webp;

    const uploadedMedia = await rwClient.v1.uploadMedia(mediaBuffer, { mimeType });
    const uploadedMediaId = uploadedMedia.media_id_string; // v1.1 形式のメディアIDが返る
    if (!uploadedMediaId) {
        console.error("❌ Failed to get media_id_string from Twitter upload response:", uploadedMedia);
        throw new Error('Failed to upload media to Twitter: media_id_string not found.');
    }
    console.log(`✅ Media uploaded via library. Media ID: ${uploadedMediaId}`);


    // 3. 画像付きツイートを投稿 (API v2 エンドポイントを利用)
    console.log("⏳ Posting v2 tweet via twitter-api-v2 library...");
    const tweetResult = await rwClient.v2.tweet({
      text: text, // ツイート本文
      media: { media_ids: [uploadedMediaId] } // ★ v2形式でメディアIDを指定
    });

    // v2 のレスポンスは { data: { id: 'ツイートID', text: 'ツイート本文' } } のような形式
    const tweetId = tweetResult.data?.id;
    if (!tweetId) {
         console.error("❌ Failed to get tweet id from Twitter v2 response:", tweetResult);
         throw new Error('Failed to post tweet: Tweet ID not found in v2 response.');
    }
    console.log(`✅ v2 Tweet posted! Tweet ID: ${tweetId}`);

    // 4. GASに成功レスポンスを返す
    console.log("🎉 Process completed successfully using API v2!");
    res.status(200).json({ success: true, tweet_id: tweetId, row_index }); // v2のIDを返す

  } catch (e) {
    console.error('❌ An error occurred (API v2):', e);
    // twitter-api-v2 はエラー時に詳細な情報を含むことがある
    const statusCode = e.code || 500; // HTTPステータスコードが取れれば使う
    let errorMessage = e.message || 'An unexpected error occurred.';
    // APIからのエラーメッセージがあればそれを表示
    if (e.data?.errors && e.data.errors.length > 0) {
        errorMessage = `Twitter API Error: ${e.data.errors[0].message}`;
        if (e.data.errors[0].parameters) {
           errorMessage += ` (Parameter: ${JSON.stringify(e.data.errors[0].parameters)})`;
        }
    } else if (e.data?.detail) {
         errorMessage = `Twitter API Error: ${e.data.detail}`;
    }

    res.status(statusCode).json({ error: errorMessage, details: e.toString(), row_index });
  }
});

// --- サーバー起動 ---
app.listen(PORT, () => {
  console.log(`🚀 Server listening on port ${PORT}`);
});

module.exports = app;
