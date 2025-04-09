// (imports and client initialization remain the same)
const express = require('express');
const bodyParser = require('body-parser');
const fetch = require('node-fetch');
const { TwitterApi } = require('twitter-api-v2');

const app = express();
app.use(bodyParser.json());
const PORT = process.env.PORT || 3000;

const twitterClient = new TwitterApi({ /* ... credentials ... */ });
const rwClient = twitterClient.readWrite;
console.log("Twitter API v2 client initialized.");

app.get('/', (req, res) => { /* ... */ });

app.post('/', async (req, res) => {
  console.log("===== New Request Received (API v2 / Check Upload Result) =====");
  const { tweetText, mediaId, row_index } = req.body;
  const text = tweetText;
  const image_id = mediaId;

  console.log("📩 Received data:", { text: text ? 'Yes' : 'No', image_id: image_id ? 'Yes' : 'No', row_index });

  if (!text || !image_id) { /* ... */ return res.status(400).json({ error: 'Missing parameters' }); }
  if (!process.env.API_KEY || !process.env.API_SECRET || !process.env.ACCESS_TOKEN || !process.env.ACCESS_SECRET) { /* ... */ return res.status(500).json({ error: 'Missing credentials' }); }

  try {
    // 1. Google Driveから画像をダウンロード
    console.log(`📥 Downloading image from Google Drive (ID: ${image_id})`);
    const mediaUrl = `https://drive.google.com/uc?export=download&id=${image_id}`;
    const mediaRes = await fetch(mediaUrl);
    if (!mediaRes.ok) { throw new Error(`Failed to download image: ${mediaRes.status}`); }
    const mediaBuffer = await mediaRes.buffer();
    console.log(`✅ Image downloaded (Size: ${mediaBuffer.length} bytes)`);

    // 2. Twitterに画像をアップロード
    console.log("⏳ Uploading media via twitter-api-v2 library...");
    let mimeType = 'image/jpeg';
    console.log(`Using hardcoded mimeType: ${mimeType}`);

    const uploadedMedia = await rwClient.v1.uploadMedia(mediaBuffer, { mimeType });
    // ★★★ 追加ログ: アップロード結果のオブジェクト全体を確認 ★★★
    console.log("Debug: Full response object from uploadMedia:", JSON.stringify(uploadedMedia, null, 2));

    // uploadedMedia自体やmedia_id_stringが存在するかチェック
    const uploadedMediaId = uploadedMedia?.media_id_string;

    // ★★★ 追加チェック: Media IDが有効か確認 ★★★
    if (!uploadedMediaId) {
        console.error("❌ Failed to get valid media_id_string from uploadMedia response.");
        // 具体的なエラー原因を投げる（catchで捕捉される）
        // uploadedMediaにエラー情報が含まれていればそれを使う
        let uploadErrorMsg = `Media upload failed: Could not retrieve media_id_string.`;
        if (uploadedMedia && typeof uploadedMedia === 'object') {
            // ライブラリがエラー情報を返しているか確認 (形式は不明なため推測)
            if (uploadedMedia.error) uploadErrorMsg += ` Reason: ${uploadedMedia.error}`;
            else uploadErrorMsg += ` Raw Response: ${JSON.stringify(uploadedMedia)}`;
        }
        throw new Error(uploadErrorMsg);
    }
    // ここに到達すればメディアIDは取得できている
    console.log(`✅ Media uploaded via library. Media ID: ${uploadedMediaId}`);

    // 3. 画像付きツイートを投稿 (API v2)
    console.log("⏳ Posting v2 tweet via twitter-api-v2 library...");
    const tweetResult = await rwClient.v2.tweet({
      text: text,
      media: { media_ids: [uploadedMediaId] } // 有効なIDが渡されるはず
    });
    const tweetId = tweetResult.data?.id;
    if (!tweetId) { throw new Error('Failed to post tweet: Tweet ID not found in v2 response.'); }
    console.log(`✅ v2 Tweet posted! Tweet ID: ${tweetId}`);

    // 4. GASに成功レスポンスを返す
    console.log("🎉 Process completed successfully using API v2!");
    res.status(200).json({ success: true, tweet_id: tweetId, row_index });

  } catch (e) {
    console.error('❌ An error occurred (API v2 / Check Upload Result):', e);
    const statusCode = e.code || 500;
    let errorMessage = e.message || 'An unexpected error occurred.';
    // (エラーメッセージ整形は省略)
    res.status(statusCode).json({ error: errorMessage, details: e.toString(), row_index });
  }
});

// --- サーバー起動 ---
app.listen(PORT, () => { /* ... */ });
module.exports = app;
