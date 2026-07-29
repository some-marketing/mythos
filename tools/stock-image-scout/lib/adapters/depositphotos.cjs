'use strict';

/**
 * depositphotos.cjs — Depositphotos provider search adapter.
 */

function slugify(text) {
  return text
    .toString()
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')           // Replace spaces with -
    .replace(/[^\w\-]+/g, '')       // Remove all non-word chars
    .replace(/\-\-+/g, '-');         // Replace multiple - with single -
}

function parsePage(html, requestedOrientation = 'horizontal') {
  const candidates = [];
  
  // Find all a-tags with href including /photo/
  const aRegex = /<a\s+[^>]*href=["']([^"']*\/photo\/[^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = aRegex.exec(html)) !== null) {
    const url = match[1];
    const innerHtml = match[2];
    
    // Extract ID (6-12 digits followed by .html)
    const idMatch = /(\d{6,12})\.html/.exec(url);
    if (!idMatch) continue;
    const id = idMatch[1];
    
    // Extract title from title attribute of the anchor or alt of image
    let title = '';
    const titleMatch = /title=["']([^"']*)["']/i.exec(match[0]);
    if (titleMatch) {
      title = titleMatch[1];
    }
    
    const altMatch = /alt=["']([^"']*)["']/i.exec(innerHtml);
    if (altMatch && !title) {
      title = altMatch[1];
    }
    
    if (!title) {
      title = `Depositphotos Image ${id}`;
    }
    
    // Extract thumbnail URL
    let thumbnail = '';
    const srcMatch = /src=["']([^"']*)["']/i.exec(innerHtml);
    if (srcMatch) {
      thumbnail = srcMatch[1];
    } else {
      const dataSrcMatch = /data-src=["']([^"']*)["']/i.exec(innerHtml);
      if (dataSrcMatch) {
        thumbnail = dataSrcMatch[1];
      }
    }
    
    if (!thumbnail) {
      thumbnail = `https://depositphotos.com/thumb/${id}-thumbnail.jpg`;
    }
    
    // Resolve relative URLs
    let absoluteUrl = url;
    if (url.startsWith('/')) {
      absoluteUrl = 'https://depositphotos.com' + url;
    }
    let absoluteThumbnail = thumbnail;
    if (thumbnail.startsWith('/')) {
      absoluteThumbnail = 'https://depositphotos.com' + thumbnail;
    }
    
    candidates.push({
      id,
      url: absoluteUrl,
      title,
      thumbnail: absoluteThumbnail,
      orientation: requestedOrientation || 'horizontal',
      downloadable_under_plan: false
    });
  }
  
  // Deduplicate by ID
  const deduped = [];
  const seenIds = new Set();
  for (const cand of candidates) {
    if (!seenIds.has(cand.id)) {
      seenIds.add(cand.id);
      deduped.push(cand);
    }
  }
  
  return deduped;
}

function getInfo() {
  return {
    name: 'depositphotos',
    type: 'browser',
    description: 'Depositphotos Browser-driven search adapter'
  };
}

async function checkSession(pageOrHtml) {
  let html = '';
  if (typeof pageOrHtml === 'string') {
    html = pageOrHtml;
  } else if (pageOrHtml && typeof pageOrHtml.content === 'function') {
    html = await pageOrHtml.content();
  } else {
    throw new Error('checkSession requires a Playwright Page or HTML string');
  }

  const hasAvatar = /profile-avatar|class=["'][^"']*avatar[^"']*["']|alt=["']User Avatar["']/i.test(html);
  const hasPlansBalance = /Plans\s*&\s*Balance/i.test(html);
  const hasAllInOne = /DOWNLOAD\s+USING:\s+All-In-One/i.test(html);

  const logged_in = hasAvatar && hasPlansBalance;
  const signals = {
    has_avatar: hasAvatar,
    has_plans_balance: hasPlansBalance,
    has_all_in_one: hasAllInOne
  };

  return {
    logged_in,
    signals
  };
}

async function search(pageOrHtml, params = {}) {
  const keyword = params.keyword || '';
  const orientation = params.orientation || 'horizontal';
  const peopleAge = params.peopleAge || 7;
  const offset = params.offset || 0;

  const slug = slugify(keyword);
  const url = `https://depositphotos.com/photos/${slug}.html?filter=all&orientation=${orientation}&people_age=${peopleAge}&offset=${offset}`;

  let html = '';
  if (typeof pageOrHtml === 'string') {
    html = pageOrHtml;
  } else if (pageOrHtml && typeof pageOrHtml.goto === 'function') {
    await pageOrHtml.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    try {
      await pageOrHtml.waitForSelector('a[href*="/photo/"]', { timeout: 10000 });
    } catch (e) {
      // Ignore if no results found, let the parser handle empty pages
    }
    html = await pageOrHtml.content();
  } else {
    throw new Error('search requires a Playwright Page or HTML string');
  }

  const sessionStatus = await checkSession(html);
  const candidates = parsePage(html, orientation);

  for (const cand of candidates) {
    cand.downloadable_under_plan = sessionStatus.signals.has_all_in_one;
  }

  return candidates;
}

module.exports = {
  slugify,
  parsePage,
  getInfo,
  checkSession,
  search
};
