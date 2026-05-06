const express = require('express');
const fs = require('fs/promises');
const path = require('path');
const Mercury = require('@postlight/mercury-parser');

const app = express();
const OUTPUT_ROOT = path.join(__dirname, 'output');

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  next();
});

app.use(express.static(path.join(__dirname, 'public')));
app.use('/output', express.static(OUTPUT_ROOT));

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

function findStreamStart(buffer, streamKeywordIndex) {
  const first = buffer[streamKeywordIndex + 6];
  const second = buffer[streamKeywordIndex + 7];

  if (first === 0x0d && second === 0x0a) return streamKeywordIndex + 8; // \r\n
  if (first === 0x0a || first === 0x0d) return streamKeywordIndex + 7; // \n or \r

  return streamKeywordIndex + 6;
}

function cleanJpegData(jpegData) {
  let start = 0;
  let end = jpegData.length;

  while (start < end && (jpegData[start] === 0x0a || jpegData[start] === 0x0d || jpegData[start] === 0x20)) {
    start += 1;
  }

  while (end > start && (jpegData[end - 1] === 0x0a || jpegData[end - 1] === 0x0d || jpegData[end - 1] === 0x20)) {
    end -= 1;
  }

  return jpegData.subarray(start, end);
}

function extractJpegStreams(pdfBuffer) {
  const text = pdfBuffer.toString('latin1');
  const images = [];
  let searchFrom = 0;

  while (true) {
    const subtypeIndex = text.indexOf('/Subtype /Image', searchFrom);
    if (subtypeIndex === -1) break;

    const streamKeywordIndex = text.indexOf('stream', subtypeIndex);
    if (streamKeywordIndex === -1) break;

    const dictText = text.slice(subtypeIndex, streamKeywordIndex);
    if (!dictText.includes('/DCTDecode')) {
      searchFrom = streamKeywordIndex + 6;
      continue;
    }

    const streamStart = findStreamStart(pdfBuffer, streamKeywordIndex);
    const endStreamIndex = text.indexOf('endstream', streamStart);

    if (endStreamIndex === -1) break;

    const rawJpeg = cleanJpegData(pdfBuffer.subarray(streamStart, endStreamIndex));

    if (rawJpeg.length > 4 && rawJpeg[0] === 0xff && rawJpeg[1] === 0xd8) {
      images.push(rawJpeg);
    }

    searchFrom = endStreamIndex + 9;
  }

  return images;
}

app.post('/convert/pdf-to-jpg', express.raw({ type: 'application/pdf', limit: '30mb' }), async (req, res) => {
  if (!req.body || !req.body.length) {
    return res.status(400).json({ error: 'Upload a PDF as raw body with Content-Type: application/pdf.' });
  }

  const pdfBuffer = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body);
  const images = extractJpegStreams(pdfBuffer);

  if (!images.length) {
    return res.status(422).json({
      error: 'No embedded JPEG image streams found in this PDF.',
      hint: 'This lightweight converter currently supports PDFs that contain /DCTDecode image streams.'
    });
  }

  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const runDir = path.join(OUTPUT_ROOT, runId);
  await fs.mkdir(runDir, { recursive: true });

  const files = [];
  for (let i = 0; i < images.length; i += 1) {
    const filename = `page-${String(i + 1).padStart(3, '0')}.jpg`;
    const absolutePath = path.join(runDir, filename);
    await fs.writeFile(absolutePath, images[i]);
    files.push({
      filename,
      url: `/output/${runId}/${filename}`
    });
  }

  return res.json({
    message: 'Converted embedded JPEG streams from PDF into JPG files.',
    count: files.length,
    files
  });
});

app.get('/health', (req, res) => {
  res.json({ ok: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  await fs.mkdir(OUTPUT_ROOT, { recursive: true });
  console.log(`Server running on port ${PORT}`);
});
