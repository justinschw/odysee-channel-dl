#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { pipeline } = require('stream');
const { promisify } = require('util');
const YTDlpWrap = require('yt-dlp-wrap').default;
const streamPipeline = promisify(pipeline);
const https = require('https');
const http = require('http');
const odysee = require('./lib/odysee');

function parseArgs() {
  const argv = require('minimist')(process.argv.slice(2), {
    string: ['channel-name', 'output-dir', 'oldest-date', 'page-size', 'ytdlp-path', 'ffmpeg-path', 'podcast-url-prefix'],
    alias: {
      'channel-name': 'channelName',
      'output-dir': 'outputDir',
      'oldest-date': 'oldestDate',
      'page-size': 'pageSize',
      'ytdlp-path': 'ytdlpPath',
      'ffmpeg-path': 'ffmpegPath',
      'podcast-url-prefix': 'podcastUrlPrefix'
    },
    default: {}
  });

  const env = process.env;

  const channelName = argv['channel-name'] || env.CHANNEL_NAME || argv.channelName;
  const outputDir = argv['output-dir'] || env.OUTPUT_DIR || argv.outputDir;
  const oldestDateRaw = argv['oldest-date'] || env.OLDEST_DATE || argv.oldestDate;
  const pageSize = parseInt(argv['page-size'] || env.PAGE_SIZE || argv.pageSize || '50', 10) || 50;
  const audioOnly = argv['audio-only'] || env.AUDIO_ONLY || false;
  const ytdlpPath = argv['ytdlp-path'] || env.YTDLP_PATH || argv.ytdlpPath || null;
  const ffmpegPath = argv['ffmpeg-path'] || env.FFMPEG_PATH || argv.ffmpegPath || null;
  const rss = argv['rss'] || env.RSS || false;
  const rssPath = argv['rss-path'] || env.RSS_PATH || argv.rssPath || null;
  const podcastTitle = argv['podcast-title'] || env.PODCAST_TITLE || argv.podcastTitle || null;
  const podcastUrlPrefix = argv['podcast-url-prefix'] || env.PODCAST_URL_PREFIX || argv.podcastUrlPrefix || null;

  if (!channelName) {
    throw new Error('channelName is required (env: CHANNEL_NAME or --channel-name)');
  }
  if (!outputDir) {
    throw new Error('outputDir is required (env: OUTPUT_DIR or --output-dir)');
  }

  // Parse oldestDate in MM/DD/YYYY if provided
  let oldestDate = null;
  if (oldestDateRaw) {
    // Accept MM/DD/YYYY
    const m = oldestDateRaw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (m) {
      const mm = parseInt(m[1], 10);
      const dd = parseInt(m[2], 10);
      const yyyy = parseInt(m[3], 10);
      // Note: Date month is 0-based
      oldestDate = new Date(yyyy, mm - 1, dd);
    } else {
      // Fallback: try to parse any other ISO-like string
      const d = new Date(oldestDateRaw);
      if (!isNaN(d.getTime())) oldestDate = d;
      else throw new Error('oldestDate must be in MM/DD/YYYY format (e.g. 12/31/2023)');
    }
  }

  return { channelName, outputDir, oldestDate, pageSize, audioOnly: !!audioOnly, ytdlpPath, ffmpegPath, rss: !!rss, rssPath, podcastTitle, podcastUrlPrefix };
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function filenameSafe(name) {
  return name.replace(/[\\/:*?"<>|]/g, '_');
}

async function downloadToFile(url, filepath, audioOnly, ytdlpPath, ffmpegPath) {

  return new Promise((resolve, reject) => {
    const ytdlp = ytdlpPath ? new YTDlpWrap(ytdlpPath) : new YTDlpWrap();

    // Build args. Put output template before URL to be explicit.
    const args = ['-x'];

    if (audioOnly) {
      // extract audio and convert to m4a
      args.push(
        '-f',
        'bestaudio/best',
        '--remux-video',
        'm4a',
        '--ffmpeg-location',
        ffmpegPath
      );
      args.push('-o', filepath);
      args.push(url);
    } else {
      // download best video+audio merged
      args.push('-f', 'bestaudio[ext=m4a]+bestvideo[ext=mp4]/best');
      args.push('-o', filepath);
      args.push(url);
    }

    const ytdlee = ytdlp.exec(args);

    ytdlee.on('progress', progress => {
      if (progress && progress.percent && process.env.LOG_DEBUG === '1') {
        process.stdout.write(`\rDownloading... ${progress.percent.toFixed(1)}% `);
      }
    });

    ytdlee.on('ytDlpEvent', (eventType, eventData) => {
      console.log(eventType, eventData);
    });

    ytdlee.on('error', err => {
      return reject(err);
    });

    ytdlee.on('close', code => {
      if (code === 0) {
        return resolve();
      } else {
        return reject(new Error(`yt-dlp exited with code ${code}`));
      }
    });

  });
}

async function processChannel({ channelName, outputDir, oldestDate, pageSize, audioOnly, ytdlpPath, ffmpegPath, rss, rssPath, podcastTitle, podcastUrlPrefix }) {
  ensureDir(outputDir);
  
  // Collect metadata for RSS generation
  const rssItems = [];
  // Simple local JSON cache to avoid repeated API calls and populate rssItems
  const cacheFile = path.join(outputDir, 'feed.json');
  const knownUrls = new Set();
  const knownBasenames = new Set();
  if (rss && fs.existsSync(cacheFile)) {
    try {
      const json = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
      if (Array.isArray(json.items)) {
        for (const it of json.items) {
          rssItems.push(it);
          if (it.sourceUrl) knownUrls.add(it.sourceUrl);
          if (it.file) knownBasenames.add(path.basename(it.file));
        }
        console.log(`Loaded ${rssItems.length} items from cache ${cacheFile}`);
      }
    } catch (e) {
      console.error('Failed to load rss cache:', e.message || e);
    }
  }

  let page = 1;
  let processing = true;
  while (processing) {
    console.log(`Fetching page ${page} (pageSize=${pageSize})`);
    let items;
    try {
      items = await odysee.getChannelListings(channelName, page, pageSize);
    } catch (err) {
      console.error('Failed to fetch channel listings:', err.message || err);
      break;
    }

    if (!items || items.length === 0) {
      console.log('No more items found, exiting.');
      break;
    }

    for (const item of items) {
      // item: { title, date, url }
      // After processing an item, if we detect the next items are already known via their source URL or filename
      // we can stop early. We'll check the next items in the current page quickly (cheap) and break if any match known.
      try {
        const nextKnown = items.slice(items.indexOf(item) + 1).some(next => knownUrls.has(next.url) || knownBasenames.has(filenameSafe(next.title) + (audioOnly ? '.m4a' : '.mp4')));
        if (nextKnown) {
          console.log('Encountered an already-known episode in the upcoming items; stopping to avoid extra API calls.');
          processing = false;
        }
      } catch (e) {
        // noop
      }
      
      const created = item.date ? new Date(item.date * 1000) : null; // original code returns timestamp in seconds
      if (oldestDate && created && created < oldestDate) {
        console.log(`Reached oldestDate cutoff at ${item.title} (${created.toISOString()}). Stopping.`);
        processing = false;
        break;
      }

      const safeTitle = filenameSafe(item.title || 'untitled');
      let outPath;
      if (audioOnly) {
        outPath = path.join(outputDir, `${safeTitle}.m4a`);
      } else {
        outPath = path.join(outputDir, `${safeTitle}.mp4`);
      }
      if (fs.existsSync(outPath)) {
        console.log(`Skipping ${item.title} — already exists.`);
        if (rss) {
          rssItems.push({
            title: item.title,
            file: outPath,
            url: `${podcastUrlPrefix}/${path.basename(outPath)}`,
            date: created,
            description: item.title,
            sourceUrl: item.url
          });
        }
        continue;
      }

      console.log(`Getting download link for ${item.title}...`);
      let info;
      try {
        info = await odysee.getDownloadUrl(item.url);
      } catch (err) {
        console.error(`Failed to get download URL for ${item.title}:`, err.message || err);
        continue;
      }

      const downloadUrl = info.contentUrl;
      if (!downloadUrl) {
        console.error(`No download URL found for ${item.title}, skipping.`);
        continue;
      }

      try {
        console.log(`Downloading ${item.title} -> ${outPath}`);
        await downloadToFile(downloadUrl, outPath, audioOnly, ytdlpPath, ffmpegPath);
        console.log(`Downloaded ${item.title}`);
        // collect metadata
        if (rss) {
          const newItem = {
            title: item.title,
            file: outPath,
            url: `${podcastUrlPrefix}/${path.basename(outPath)}`,
            date: created,
            description: item.title,
            sourceUrl: item.url
          };
          rssItems.push(newItem);
          knownUrls.add(item.url);
          knownBasenames.add(path.basename(outPath));
        }
      } catch (err) {
        console.error(`Failed to download ${item.title}:`, err.message || err);
        // remove partial file
        try { if (fs.existsSync(outPath)) fs.unlinkSync(outPath); } catch {}
      }
    }

    if (items.length < pageSize) {
      console.log('Last page of results reached, exiting.');
      break;
    }
    page += 1;
  }

  // Save cache file
  try { fs.writeFileSync(cacheFile, JSON.stringify({ items: rssItems }, null, 2), 'utf8'); } catch (e) {}

  // After processing pages, optionally write RSS
  if (rss) {
    const feedFile = rssPath || path.join(outputDir, 'feed.xml');
    const feedTitle = podcastTitle || channelName;
    generateRss(feedTitle, rssItems.sort((a,b) => (b.date||0) - (a.date||0)), feedFile);
  }
}

function isoDate(d) {
  if (!d) return new Date().toUTCString();
  return new Date(d).toUTCString();
}

function generateRss(feedTitle, items, rssFilePath) {
  // Simple RSS 2.0 generation
  const buildItem = (it) => {
    let enclosureUrl;
    // Guess mime type by extension
    const ext = path.extname(it.file || '').toLowerCase();
    const mime = ext === '.mp4' ? 'video/mp4' : (ext === '.m4a' || ext === '.mp3' ? 'audio/mpeg' : 'application/octet-stream');
    return `  <item>\n    <title>${escapeXml(it.title)}</title>\n    <description>${escapeXml(it.description || '')}</description>\n    <pubDate>${isoDate(it.date)}</pubDate>\n    <enclosure url="${escapeXml(it.url)}" type="${mime}"/>\n  </item>`;
  };

  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0">\n<channel>\n  <title>${escapeXml(feedTitle)}</title>\n${items.map(buildItem).join('\n')}\n</channel>\n</rss>`;
  fs.writeFileSync(rssFilePath, xml, 'utf8');
  console.log(`RSS written to ${rssFilePath}`);
}

function escapeXml(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

async function main() {
  let opts;
  try {
    opts = parseArgs();
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }

  try {
    await processChannel(opts);
    console.log('Done.');
  } catch (err) {
    console.error('Fatal error:', err);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}
