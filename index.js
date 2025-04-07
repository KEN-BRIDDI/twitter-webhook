const express = require('express');
const bodyParser = require('body-parser');
const crypto = require('crypto');
const fetch = require('node-fetch');

const app = express();
app.use(bodyParser.json());

const PORT = process.env.PORT || 3000;

// ✅ GETルート確認用
app.get('/', (req, res) => {
  res.send('✅ Webhook is live!');
});

// ✅ POSTリクエスト受信ルート
app.post('/', async (req, res) => {
  const { tweetText, mediaId, row_index } = req.body;
  const text = tweetText;
  const image_id = mediaId;

  console.log("📩 受信データ:", req.body);

  if (!text || !image_id) {
    return res.status(400).send({ error: 'Missing parameters' });
  }

  try {
    const mediaUrl = `https://drive.google.com/uc?export=download&id=${image_id}`;
    const mediaRes = await fetch(mediaUrl);
    const mediaBuffer = await mediaRes.buffer();
    const mediaData = mediaBuffer.toString('base64');

    // Step 1: Upload media
    const mediaUpload = await twitterRequest(
      'https://upload.twitter.com/1.1/media/upload.json',
      'POST',
      { media_data: mediaData }
    );
    const mediaId = mediaUpload.media_id_string;

    // Step 2: Post tweet
    const tweet = await twitterRequest(
      'https://api.twitter.com/1.1/statuses/update.json',
      'POST',
      { status: text, media_ids: mediaId }
    );

    console.log('✅ Tweet posted:', tweet.id_str);
    res.send({ success: true, tweet_id: tweet.id_str, row_index });
  } catch (e) {
    console.error('❌ Error:', e);
    res.status(500).send({ error: e.toString() });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});

// ==== Twitter OAuth 1.0a 署名付きリクエスト関数 ====

const oauth = {
  consumer_key: process.env.API_KEY,
  consumer_secret: process.env.API_SECRET,
  token: process.env.ACCESS_TOKEN,
  token_secret: process.env.ACCESS_SECRET
};

console.log("🌍 process.env.API_KEY:", process.env.API_KEY);
console.log("🌍 process.env.API_SECRET:", process.env.API_SECRET);
console.log("🌍 process.env.ACCESS_TOKEN:", process.env.ACCESS_TOKEN);
console.log("🌍 process.env.ACCESS_SECRET:", process.env.ACCESS_SECRET);

console.log("🔑 読み込んだoauth情報:", oauth);

const twitterRequest = async (url, method, params) => {
  const oauth_params = {
    oauth_consumer_key: oauth.consumer_key,
    oauth_nonce: crypto.randomBytes(16).toString('hex'),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_token: oauth.token,
    oauth_version: '1.0'
  };

  console.log("🧩 oauth_params:", oauth_params);

  const allParams = { ...oauth_params, ...params };
  const baseParams = Object.keys(allParams).sort().map(key => (
    `${encodeURIComponent(key)}=${encodeURIComponent(allParams[key])}`
  )).join('&');

  const baseString = [
    method.toUpperCase(),
    encodeURIComponent(url),
    encodeURIComponent(baseParams)
  ].join('&');

  const signingKey = `${encodeURIComponent(oauth.consumer_secret)}&${encodeURIComponent(oauth.token_secret)}`;
  const signature = crypto.createHmac('sha1', signingKey).update(baseString).digest('base64');
  oauth_params.oauth_signature = signature;

  const authHeader = 'OAuth ' + Object.keys(oauth_params).map(key =>
    `${encodeURIComponent(key)}="${encodeURIComponent(oauth_params[key])}"`
  ).join(', ');

  const options = {
    method,
    headers: {
      Authorization: authHeader,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(params)
  };

  const res = await fetch(url, options);
  const json = await res.json();

  if (!res.ok) throw new Error(JSON.stringify(json));
  return json;
};
