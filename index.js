const express = require('express');
const bodyParser = require('body-parser');
const fetch = require('node-fetch'); // fetch は不要になったが一応残す
const { TwitterApi } = require('twitter-api-v2'); // Twitterライブラリ

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
  res.status(200).send('✅ Webhook is running! (API v2 Text-Only Mode)');
});

// --- POSTルート (API v2 / テキストのみ投稿版) ---
app.post('/', async (req, res) => {
  console.log("===== New Request Received (API v2 / Text-Only Test) =====");
  // mediaId は受け取るかもしれないが、使わない
  const { tweetText, mediaId, row_index } = req.body;
  const text = tweetText;

  // text が存在するかだけチェック
  console.log("📩 Received data:", { text: text ? 'Yes' : 'No', mediaId: mediaId ? 'Yes (ignored)' : 'No', row_index });

  // パラメータチェック (textのみ)
  if (!text) {
    console.error("❌ Missing parameter: tweetText");
    return res.status(400).json({ error: 'Missing parameter (tweetText)' });
  }

  // 環境変数チェック
  if (!process.env.API_KEY || !process.env.API_SECRET || !process.env.ACCESS_TOKEN || !process.env.ACCESS_SECRET) {
     console.error('❌ Missing Twitter API credentials in environment variables!');
     return res.status(500).json({ error: 'Server configuration error: Missing API credentials.' });
  }

  try {
    // ---- 画像処理は全て削除 ----
    // 1. Google Driveダウンロード -> 削除
    // 2. メディアアップロード -> 削除

    // 3. テキストのみでツイート投稿 (API v2)
    console.log("⏳ Posting v2 text-only tweet via twitter-api-v2 library...");
    const tweetResult = await rwClient.v2.tweet({
      text: text // ★ 送信するテキストのみ指定
    });

    const tweetId = tweetResult.data?.id;
    if (!tweetId) {
        console.error("❌ Failed to get tweet id from Twitter v2 response:", tweetResult);
        throw new Error('Failed to post tweet: Tweet ID not found in v2 response.');
    }
    console.log(`✅ v2 Text-Only Tweet posted! Tweet ID: ${tweetId}`);

    // 4. GASに成功レスポンスを返す
    console.log("🎉 Process completed successfully (Text-Only)!");
    res.status(200).json({ success: true, tweet_id: tweetId, row_index }); // 成功！

  } catch (e) {
    console.error('❌ An error occurred (API v2 / Text-Only Test):', e);
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
