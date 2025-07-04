const express = require('express');
const Mercury = require('@postlight/mercury-parser');
const app = express();

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  next();
});

app.get('/parser', async (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).send({ error: 'Missing URL' });

  try {
    const result = await Mercury.parse(url);
    res.send({ title: result.title, content: result.content });
  } catch (err) {
    res.status(500).send({ error: 'Failed to parse URL' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
