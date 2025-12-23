'use strict';
const axios = require('axios');
const cheerio = require('cheerio');

function getChannelListings(channelName, page = 1, pageSize = 20) {
  return new Promise(function (resolve, reject) {
    const url = `https://api.na-backend.odysee.com/api/v1/proxy`;
    const headers = {
      'Content-Type': 'application/json'
    };
    const data = {
      jsonrpc: "2.0",
      method: "claim_search",
      params: {
        channel: channelName,
        page,
        page_size: pageSize,
        order_by: ["release_time"],
        claim_type: ["stream"],
        no_totals: true,
        has_source: true
      }
    }
    axios.post(url, data, { headers }).then(response => {
      if (response.data.error) {
        return reject(response.data.error);
      }
      // Parse out relevant info
      let results = [];
      response.data.result.items.forEach(item => {
        results.push({
          title: item.name,
          date: item.timestamp,
          url: `https://odysee.com/${channelName}/${item.name}`
        })
      });
      return resolve(results);
    });
  });
}

/**
* Fetches an Odysee video page and extracts video metadata
* from the JSON-LD VideoObject block.
*
* @param {string} videoUrl - Full Odysee video page URL
* @returns {Promise<{contentUrl: string, raw: object}>}
*/
async function getDownloadUrl(videoUrl) {
  if (!videoUrl || typeof videoUrl !== 'string') {
    throw new Error('A valid Odysee video URL is required');
  }


  const res = await fetch(videoUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; odysee-scraper/0.1.0)'
    }
  });


  if (!res.ok) {
    throw new Error(`Failed to fetch page: ${res.status} ${res.statusText}`);
  }


  const html = await res.text();
  const $ = cheerio.load(html);


  let videoObject = null;


  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const json = JSON.parse($(el).html());


      if (json['@type'] === 'VideoObject' && json.contentUrl) {
        videoObject = json;
        return false; // break
      }
    } catch {
      // ignore malformed JSON blocks
    }
  });


  if (!videoObject) {
    throw new Error('VideoObject JSON-LD not found');
  }


  return {
    contentUrl: videoObject.contentUrl,
    raw: videoObject
  };
}
module.exports.getChannelListings = getChannelListings;
module.exports.getDownloadUrl = getDownloadUrl;
