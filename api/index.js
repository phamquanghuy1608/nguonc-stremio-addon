const express = require('express');
const cors = require('cors');
const crypto = globalThis.crypto;

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 7003;
const TMDB_API_KEY = process.env.TMDB_API_KEY || '8476a7ab80ad76f0936744df0430e67c';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// -------------------------------------------------------------
// In-Memory Cache (TTL)
// -------------------------------------------------------------
const cache = new Map();
function getCached(key) {
  const item = cache.get(key);
  if (!item) return null;
  if (Date.now() > item.expiresAt) {
    cache.delete(key);
    return null;
  }
  return item.data;
}

function setCached(key, data, ttlMs = 15 * 60 * 1000) {
  cache.set(key, { data, expiresAt: Date.now() + ttlMs });
}

function stripHtml(html) {
  if (!html) return '';
  return String(html)
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

async function resolveTitleFromTmdbOrImdb(id, type) {
  try {
    const isTv = type === 'series';
    if (id.startsWith('tt')) {
      const imdbId = id.split(':')[0];
      const findUrl = `https://api.themoviedb.org/3/find/${imdbId}?api_key=${TMDB_API_KEY}&external_source=imdb_id`;
      const r = await fetch(findUrl, { headers: { 'User-Agent': UA } });
      if (r.ok) {
        const d = await r.json();
        if (d.movie_results?.length) {
          return { title: d.movie_results[0].title, originalTitle: d.movie_results[0].original_title, year: d.movie_results[0].release_date?.slice(0, 4) };
        }
        if (d.tv_results?.length) {
          return { title: d.tv_results[0].name, originalTitle: d.tv_results[0].original_name, year: d.tv_results[0].first_air_date?.slice(0, 4) };
        }
      }
    } else if (id.startsWith('tmdb:')) {
      const tmdbId = id.replace('tmdb:', '').split(':')[0];
      const endpoint = isTv ? 'tv' : 'movie';
      const tmdbUrl = `https://api.themoviedb.org/3/${endpoint}/${tmdbId}?api_key=${TMDB_API_KEY}&language=vi-VN`;
      const r = await fetch(tmdbUrl, { headers: { 'User-Agent': UA } });
      if (r.ok) {
        const d = await r.json();
        return {
          title: d.title || d.name,
          originalTitle: d.original_title || d.original_name,
          year: (d.release_date || d.first_air_date || '').slice(0, 4)
        };
      }
    }
  } catch (err) {
    console.warn('[TMDB Lookup Error]', err.message);
  }
  return null;
}

async function resolveStreamC(embedUrl) {
  if (!embedUrl) return null;
  const cacheKey = `streamc:${embedUrl}`;
  const hit = getCached(cacheKey);
  if (hit) return hit;

  try {
    const embedOrigin = new URL(embedUrl).origin;
    const res = await fetch(embedUrl, {
      method: 'POST',
      headers: {
        'User-Agent': UA,
        'Referer': embedUrl,
        'Origin': embedOrigin,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        action: 'bootstrap',
        referrer: 'https://phim.nguonc.com/',
        frame_origins: ['https://phim.nguonc.com'],
        request_grant: true,
        playlist_format: 'hls',
        pretty_url: true,
        path_chunks: true,
        bootstrap_format: 'aesgcm-v1'
      })
    });

    if (!res.ok) return null;
    const env = await res.json();
    if (!env || env.format !== 'aesgcm-v1' || !env.data || !env.iv) return null;

    const cipherBytes = Buffer.from(env.data, 'base64');
    const ivBytes = Buffer.from(env.iv, 'hex');
    const s = new TextEncoder().encode('stream-bootstrap-v1\n' + embedUrl);
    const hash = await crypto.subtle.digest('SHA-256', s);
    const key = await crypto.subtle.importKey('raw', hash, 'AES-GCM', false, ['decrypt']);
    const decryptedBuf = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: ivBytes, additionalData: s, tagLength: 128 },
      key,
      cipherBytes
    );

    const decrypted = JSON.parse(new TextDecoder('utf-8').decode(decryptedBuf));
    const playlistUrl = decrypted.preissued?.playlist;
    if (!playlistUrl) return null;

    const result = {
      playlistUrl,
      embedOrigin,
      expiresAt: decrypted.preissued?.expiresAt ? decrypted.preissued.expiresAt * 1000 : Date.now() + 60 * 60 * 1000
    };

    setCached(cacheKey, result, 20 * 60 * 1000);
    return result;
  } catch (err) {
    console.warn(`[StreamC Extract Error] ${embedUrl}: ${err.message}`);
    return null;
  }
}

const MANIFEST = {
  id: 'org.stremio.nguonc',
  version: '1.0.0',
  name: 'NguonC (Phim Online)',
  description: 'Xem phim lẻ, phim bộ, hoạt hình thuyết minh & vietsub từ NguonC (phim.nguonc.com)',
  logo: 'https://img.nguonc.com/images/img-6f4dad12be11077f1fd5ff0bc0c4f8d72b9708c882e65dc1bdbad6bac79e1455.png',
  resources: ['catalog', 'meta', 'stream'],
  types: ['movie', 'series'],
  idPrefixes: ['nguonc:', 'tt', 'tmdb:'],
  catalogs: [
    {
      type: 'movie',
      id: 'nguonc-phim-moi',
      name: 'NguonC — Mới Cập Nhật',
      extra: [
        { name: 'search', isRequired: false },
        { name: 'skip', isRequired: false }
      ]
    },
    {
      type: 'series',
      id: 'nguonc-phim-bo',
      name: 'NguonC — Phim Bộ',
      extra: [
        { name: 'search', isRequired: false },
        { name: 'skip', isRequired: false }
      ]
    },
    {
      type: 'movie',
      id: 'nguonc-phim-le',
      name: 'NguonC — Phim Lẻ',
      extra: [
        { name: 'search', isRequired: false },
        { name: 'skip', isRequired: false }
      ]
    },
    {
      type: 'series',
      id: 'nguonc-hoat-hinh',
      name: 'NguonC — Hoạt Hình',
      extra: [
        { name: 'search', isRequired: false },
        { name: 'skip', isRequired: false }
      ]
    },
    {
      type: 'series',
      id: 'nguonc-tv-shows',
      name: 'NguonC — TV Shows',
      extra: [
        { name: 'search', isRequired: false },
        { name: 'skip', isRequired: false }
      ]
    }
  ],
  behaviorHints: {
    configurable: false,
    configurationRequired: false
  }
};

app.get('/manifest.json', (_req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.json(MANIFEST);
});

function formatMetaItem(it) {
  const isSeries = parseInt(it.total_episodes, 10) > 1 || (it.current_episode && !/full/i.test(String(it.current_episode)));
  const genres = it.category ? Object.values(it.category).flatMap(c => c.list ? c.list.map(l => l.name) : []) : [];
  
  return {
    id: `nguonc:${it.slug}`,
    type: isSeries ? 'series' : 'movie',
    name: it.name,
    originalName: it.original_name,
    poster: it.poster_url || it.thumb_url,
    posterShape: 'poster',
    background: it.thumb_url || it.poster_url,
    releaseInfo: [it.quality, it.language, it.year].filter(Boolean).join(' · '),
    description: `Năm: ${it.year || 'N/A'} | Thời lượng: ${it.time || 'N/A'}\nTrạng thái: ${it.current_episode || 'HD'}\nThể loại: ${genres.join(', ') || 'N/A'}`
  };
}

async function handleCatalog(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  try {
    const { type, id } = req.params;
    let search = req.query.search;
    let skip = parseInt(req.query.skip, 10) || 0;

    if (req.params.extra) {
      const extraParts = req.params.extra.split('&');
      for (const part of extraParts) {
        const [k, v] = part.split('=');
        if (k === 'search') search = decodeURIComponent(v);
        if (k === 'skip') skip = parseInt(v, 10) || 0;
      }
    }

    const page = Math.max(1, Math.floor(skip / 10) + 1);

    if (search && search.trim()) {
      const q = search.trim();
      const cacheKey = `search:${q}:${page}`;
      const hit = getCached(cacheKey);
      if (hit) return res.json({ metas: hit });

      const searchUrl = `https://phim.nguonc.com/api/films/search?keyword=${encodeURIComponent(q)}&page=${page}`;
      const r = await fetch(searchUrl, { headers: { 'User-Agent': UA } });
      if (!r.ok) return res.json({ metas: [] });
      const data = await r.json();
      const metas = (data.items || []).map(formatMetaItem);
      setCached(cacheKey, metas, 5 * 60 * 1000);
      return res.json({ metas });
    }

    let path = '/films/phim-moi-cap-nhat';
    if (id === 'nguonc-phim-bo') {
      path = '/films/danh-sach/phim-bo';
    } else if (id === 'nguonc-phim-le') {
      path = '/films/danh-sach/phim-le';
    } else if (id === 'nguonc-hoat-hinh') {
      path = '/films/danh-sach/hoat-hinh';
    } else if (id === 'nguonc-tv-shows') {
      path = '/films/danh-sach/tv-shows';
    } else if (type === 'series') {
      path = '/films/danh-sach/phim-bo';
    }

    const cacheKey = `cat:${path}:${page}`;
    const hit = getCached(cacheKey);
    if (hit) return res.json({ metas: hit });

    const apiUrl = `https://phim.nguonc.com/api${path}?page=${page}`;
    const r = await fetch(apiUrl, { headers: { 'User-Agent': UA } });
    if (!r.ok) return res.json({ metas: [] });
    const data = await r.json();
    const metas = (data.items || []).map(formatMetaItem);
    setCached(cacheKey, metas, 10 * 60 * 1000);
    return res.json({ metas });
  } catch (err) {
    console.error('[Catalog Error]', err.message);
    res.json({ metas: [] });
  }
}

app.get('/catalog/:type/:id.json', handleCatalog);
app.get('/catalog/:type/:id/:extra.json', handleCatalog);

app.get('/meta/:type/:id.json', async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  try {
    const { type, id } = req.params;
    let slug = null;

    if (id.startsWith('nguonc:')) {
      slug = id.replace('nguonc:', '').split(':')[0];
    } else if (id.startsWith('tt') || id.startsWith('tmdb:')) {
      const resolved = await resolveTitleFromTmdbOrImdb(id, type);
      if (resolved?.title) {
        const searchUrl = `https://phim.nguonc.com/api/films/search?keyword=${encodeURIComponent(resolved.title)}&page=1`;
        const sr = await fetch(searchUrl, { headers: { 'User-Agent': UA } });
        if (sr.ok) {
          const sd = await sr.json();
          if (sd.items?.length) slug = sd.items[0].slug;
        }
      }
    }

    if (!slug) return res.json({ meta: null });

    const cacheKey = `meta:${slug}`;
    const hit = getCached(cacheKey);
    if (hit) return res.json({ meta: hit });

    const detailUrl = `https://phim.nguonc.com/api/film/${encodeURIComponent(slug)}`;
    const r = await fetch(detailUrl, { headers: { 'User-Agent': UA } });
    if (!r.ok) return res.json({ meta: null });

    const data = await r.json();
    const m = data.movie;
    if (!m) return res.json({ meta: null });

    const isSeries = parseInt(m.total_episodes, 10) > 1 || (m.current_episode && !/full/i.test(String(m.current_episode)));
    const genres = m.category ? Object.values(m.category).flatMap(c => c.list ? c.list.map(l => l.name) : []) : [];

    const videos = [];
    if (isSeries && m.episodes?.length) {
      const firstServerItems = m.episodes[0].items || [];
      for (let i = 0; i < firstServerItems.length; i++) {
        const ep = firstServerItems[i];
        const epNum = parseInt(String(ep.name).replace(/\D/g, ''), 10) || (i + 1);
        videos.push({
          id: `nguonc:${slug}:1:${epNum}`,
          title: `Tập ${ep.name}`,
          season: 1,
          episode: epNum,
          released: m.created || new Date().toISOString()
        });
      }
    }

    const meta = {
      id: `nguonc:${slug}`,
      type: isSeries ? 'series' : 'movie',
      name: m.name,
      originalName: m.original_name,
      poster: m.poster_url || m.thumb_url,
      posterShape: 'poster',
      background: m.thumb_url || m.poster_url,
      releaseInfo: [m.quality, m.language, m.year].filter(Boolean).join(' · '),
      year: m.year,
      genres,
      description: stripHtml(m.description),
      cast: m.casts ? m.casts.split(',').map(s => s.trim()) : [],
      director: m.director ? [m.director] : [],
      videos: videos.length ? videos : undefined
    };

    setCached(cacheKey, meta, 30 * 60 * 1000);
    return res.json({ meta });
  } catch (err) {
    console.error('[Meta Error]', err.message);
    res.json({ meta: null });
  }
});

app.get('/stream/:type/:id.json', async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  try {
    const { type, id } = req.params;
    let slug = null;
    let targetSeason = 1;
    let targetEpisode = 1;
    let rawEpSlug = null;
    const isSeries = type === 'series';

    if (id.startsWith('nguonc:')) {
      const parts = id.replace('nguonc:', '').split(':');
      slug = parts[0];
      if (parts.length === 2) {
        rawEpSlug = parts[1];
        const num = parseInt(parts[1].replace(/\D/g, ''), 10);
        if (num) targetEpisode = num;
      } else if (parts.length >= 3) {
        targetSeason = parseInt(parts[1], 10) || 1;
        targetEpisode = parseInt(parts[2].replace(/\D/g, ''), 10) || 1;
        rawEpSlug = parts[2];
      }
    } else if (id.startsWith('tt') || id.startsWith('tmdb:')) {
      const parts = id.split(':');
      if (parts.length >= 3) {
        targetSeason = parseInt(parts[1], 10) || 1;
        targetEpisode = parseInt(parts[2].replace(/\D/g, ''), 10) || 1;
      }
      const resolved = await resolveTitleFromTmdbOrImdb(id, type);
      if (resolved?.title) {
        const searchUrl = `https://phim.nguonc.com/api/films/search?keyword=${encodeURIComponent(resolved.title)}&page=1`;
        const sr = await fetch(searchUrl, { headers: { 'User-Agent': UA } });
        if (sr.ok) {
          const sd = await sr.json();
          if (sd.items?.length) slug = sd.items[0].slug;
        }
      }
    }

    if (!slug) return res.json({ streams: [] });

    const host = req.headers.host;
    const protocol = req.headers['x-forwarded-proto'] || 'https';
    const serverBase = `${protocol}://${host}`;

    const detailUrl = `https://phim.nguonc.com/api/film/${encodeURIComponent(slug)}`;
    const r = await fetch(detailUrl, { headers: { 'User-Agent': UA } });
    if (!r.ok) return res.json({ streams: [] });

    const data = await r.json();
    const movie = data.movie;
    if (!movie || !movie.episodes?.length) return res.json({ streams: [] });

    const streams = [];

    for (const server of movie.episodes) {
      const serverName = server.server_name || 'NguonC';
      const items = server.items || [];
      if (!items.length) continue;

      let matchedEp = null;
      if (!isSeries) {
        matchedEp = items[0];
      } else {
        matchedEp = items.find(it => {
          if (rawEpSlug && it.slug === rawEpSlug) return true;
          const n = parseInt(String(it.name).replace(/\D/g, ''), 10);
          return n === targetEpisode;
        }) || items[targetEpisode - 1] || items[0];
      }

      if (!matchedEp || !matchedEp.embed) continue;

      const extracted = await resolveStreamC(matchedEp.embed);
      if (!extracted || !extracted.playlistUrl) continue;

      const proxyUrl = `${serverBase}/proxy/hls.m3u8?url=${encodeURIComponent(extracted.playlistUrl)}&ref=${encodeURIComponent(extracted.embedOrigin)}`;

      streams.push({
        name: `[NguonC] ${serverName}`,
        title: `${movie.name} - Tập ${matchedEp.name} (HLS Proxy)`,
        url: proxyUrl,
        behaviorHints: {
          notWebReady: true
        }
      });

      streams.push({
        name: `[NguonC Direct] ${serverName}`,
        title: `${movie.name} - Tập ${matchedEp.name} (Direct Stream)`,
        url: extracted.playlistUrl,
        behaviorHints: {
          notWebReady: true,
          proxyHeaders: {
            request: {
              'User-Agent': UA,
              'Referer': extracted.embedOrigin
            }
          }
        }
      });
    }

    return res.json({ streams });
  } catch (err) {
    console.error('[Stream Error]', err.message);
    res.json({ streams: [] });
  }
});

// Proxy HLS Playlist
app.get('/proxy/hls.m3u8', async (req, res) => {
  const { url: playlistUrl, ref } = req.query;
  if (!playlistUrl) return res.status(400).send('Missing url parameter');

  try {
    const upstreamRes = await fetch(playlistUrl, {
      headers: {
        'User-Agent': UA,
        'Referer': ref || 'https://phim.nguonc.com/'
      }
    });

    if (!upstreamRes.ok) {
      return res.status(upstreamRes.status).send(`Upstream Playlist Error: ${upstreamRes.statusText}`);
    }

    const playlistText = await upstreamRes.text();
    const host = req.headers.host;
    const protocol = req.headers['x-forwarded-proto'] || 'https';
    const serverBase = `${protocol}://${host}`;

    const lines = playlistText.split('\n');
    const rewritten = lines.map(line => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return line;

      let chunkUrl = trimmed;
      if (!chunkUrl.startsWith('http://') && !chunkUrl.startsWith('https://')) {
        chunkUrl = new URL(chunkUrl, playlistUrl).href;
      }

      return `${serverBase}/proxy/ts?url=${encodeURIComponent(chunkUrl)}&ref=${encodeURIComponent(ref || '')}`;
    }).join('\n');

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
    res.setHeader('Cache-Control', 'no-cache');
    res.send(rewritten);
  } catch (err) {
    console.error('[Proxy HLS Error]', err.message);
    res.status(502).send(`HLS Proxy Error: ${err.message}`);
  }
});

// Proxy TS Chunk
app.get('/proxy/ts', async (req, res) => {
  const { url: chunkUrl, ref } = req.query;
  if (!chunkUrl) return res.status(400).send('Missing url parameter');

  try {
    const upstreamRes = await fetch(chunkUrl, {
      headers: {
        'User-Agent': UA,
        'Referer': ref || 'https://phim.nguonc.com/'
      }
    });

    if (!upstreamRes.ok) {
      return res.status(upstreamRes.status).send(`Upstream TS Chunk Error: ${upstreamRes.statusText}`);
    }

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Type', 'video/mp2t');
    res.setHeader('Cache-Control', 'public, max-age=86400, immutable');

    if (upstreamRes.headers.get('content-length')) {
      res.setHeader('Content-Length', upstreamRes.headers.get('content-length'));
    }

    const reader = upstreamRes.body.getReader();
    async function pump() {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          res.end();
          break;
        }
        res.write(value);
      }
    }
    await pump();
  } catch (err) {
    if (!res.headersSent) {
      res.status(502).send(`TS Chunk Proxy Error: ${err.message}`);
    } else {
      res.end();
    }
  }
});

// Landing Page
app.get('/', (req, res) => {
  const host = req.headers.host;
  const protocol = req.headers['x-forwarded-proto'] || 'https';
  const manifestUrl = `${protocol}://${host}/manifest.json`;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(`
<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="UTF-8">
  <title>NguonC Stremio Addon (Vercel)</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0f172a; color: #f8fafc; margin: 0; padding: 40px 20px; display: flex; justify-content: center; }
    .card { background: #1e293b; border-radius: 14px; max-width: 580px; width: 100%; padding: 32px; box-shadow: 0 10px 25px rgba(0,0,0,0.5); border: 1px solid #334155; }
    h1 { color: #38bdf8; margin-top: 0; font-size: 26px; display: flex; align-items: center; gap: 10px; }
    p { color: #94a3b8; line-height: 1.6; }
    .btn { display: inline-block; background: #0284c7; color: #fff; text-decoration: none; padding: 12px 24px; border-radius: 8px; font-weight: 600; margin-top: 15px; transition: background 0.2s; }
    .btn:hover { background: #0369a1; }
    .code-box { background: #0f172a; padding: 12px; border-radius: 6px; font-family: monospace; color: #a5f3fc; word-break: break-all; margin: 15px 0; border: 1px solid #1e293b; }
    .badge { display: inline-block; background: #065f46; color: #34d399; padding: 4px 10px; border-radius: 20px; font-size: 13px; font-weight: bold; }
  </style>
</head>
<body>
  <div class="card">
    <div style="display: flex; justify-content: space-between; align-items: center;">
      <h1>🎬 NguonC Streams</h1>
      <span class="badge">Vercel Serverless</span>
    </div>
    <p>Addon tìm kiếm và stream phim từ nguồn <b>NguonC (phim.nguonc.com)</b> cho Stremio và Nuvio. Serverless chạy trên Vercel tương tự KKPhim.</p>
    
    <label style="font-size: 13px; color: #cbd5e1; font-weight: bold;">Link Cài Đặt Addon Vào Stremio / Nuvio:</label>
    <div class="code-box">${manifestUrl}</div>

    <a class="btn" href="stremio://${host}/manifest.json">📲 Cài Đặt Vào Stremio / Nuvio</a>
  </div>
</body>
</html>
  `);
});

// Export for Vercel Serverless Function
module.exports = app;

if (process.env.NODE_ENV !== 'production' && require.main === module) {
  app.listen(PORT, () => console.log(`Listening on http://localhost:${PORT}`));
}
