// Add hash function at the top
function hashString(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return hash.toString(36); // Convert to base36 for shorter string
}

// Cache for storing classification results
const tweetCache = new Map();
const pendingClassifications = new Map(); // Track in-flight requests
let pendingCacheSaves = 0;
const CACHE_SAVE_THRESHOLD = 10; // Force save after 10 new classifications

// Initialize settings
let settings = {
  apiKey: '',
  filterCondition: '',
  isEnabled: true // Default to enabled
};

// Load settings when content script starts
chrome.storage.local.get(['apiKey', 'filterCondition', 'isEnabled', 'tweetClassifications'], function(result) {
  settings = {
    apiKey: result.apiKey || '',
    filterCondition: result.filterCondition || '',
    isEnabled: result.isEnabled === undefined ? true : result.isEnabled
  };
  
  if (settings.apiKey && settings.filterCondition && settings.isEnabled) {
    startTweetProcessing();
  }
  
  // Load cache
  if (result.tweetClassifications) {
    const storedCache = JSON.parse(result.tweetClassifications);
    Object.entries(storedCache).forEach(([hash, decision]) => {
      tweetCache.set(hash, decision);
    });
    console.log(`[Tweet Filter] Loaded ${tweetCache.size} cached classifications`);
  }
});

// Listen for settings updates
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'SETTINGS_UPDATED') {
    chrome.storage.local.get(['apiKey', 'filterCondition', 'isEnabled'], function(result) {
      settings = {
        apiKey: result.apiKey || '',
        filterCondition: result.filterCondition || '',
        isEnabled: result.isEnabled === undefined ? true : result.isEnabled
      };
      
      if (settings.apiKey && settings.filterCondition && settings.isEnabled) {
        startTweetProcessing();
      } else if (!settings.isEnabled) {
        // If disabled, show all hidden tweets
        document.querySelectorAll('article[data-testid="tweet"][data-processed="true"]').forEach(tweet => {
          tweet.style.visibility = '';
          tweet.style.height = '';
          tweet.style.margin = '';
          tweet.style.padding = '';
          tweet.style.minHeight = '';
          tweet.style.overflow = '';
        });
      }
    });
  }
});

// Check if we're on the home timeline
function isHomeTimeline() {
  return window.location.pathname === '/home';
}

// Save cache to storage
const saveCacheToStorage = debounce(() => {
  const cacheObject = {};
  tweetCache.forEach((value, key) => {
    cacheObject[key] = value;
  });
  chrome.storage.local.set({ tweetClassifications: JSON.stringify(cacheObject) });
  pendingCacheSaves = 0;
  console.log(`[Tweet Filter] Saved ${tweetCache.size} classifications to storage`);
}, 100); // Reduced to 100ms

// Force save cache if needed
function saveCache(force = false) {
  pendingCacheSaves++;
  if (force || pendingCacheSaves >= CACHE_SAVE_THRESHOLD) {
    saveCacheToStorage.flush(); // Immediately execute the debounced function
  } else {
    saveCacheToStorage();
  }
}

function startTweetProcessing() {
  if (!isHomeTimeline()) {
    console.log('[Tweet Filter] Not on home timeline, extension inactive');
    return;
  }

  // Process initial tweets
  processTweets();
  
  // Set up a single observer for both scroll and DOM changes
  const processThrottled = throttle(processTweets, 50);
  
  // Handle scroll events
  window.addEventListener('scroll', () => {
    if (isHomeTimeline()) processThrottled();
  });
  
  // Set up mutation observer
  const tweetObserver = new MutationObserver((mutations) => {
    if (isHomeTimeline()) processThrottled();
  });
  
  // Start observing with a more reliable setup
  setupTimelineObserver(tweetObserver);
}

function setupTimelineObserver(observer) {
  const timelineSelector = 'div[data-testid="primaryColumn"]';
  const timeline = document.querySelector(timelineSelector);
  
  if (timeline) {
    observer.observe(timeline, {
      childList: true,
      subtree: true
    });
  } else {
    // If timeline isn't ready, wait for it using MutationObserver instead of setInterval
    const bodyObserver = new MutationObserver((mutations, obs) => {
      const timeline = document.querySelector(timelineSelector);
      if (timeline) {
        observer.observe(timeline, {
          childList: true,
          subtree: true
        });
        obs.disconnect(); // Stop observing body once timeline is found
      }
    });
    
    bodyObserver.observe(document.body, {
      childList: true,
      subtree: true
    });
  }
}

async function processTweets() {
  if (!settings.isEnabled) return;
  
  const tweets = Array.from(document.querySelectorAll('article[data-testid="tweet"]:not([data-processed="true"])'))
    .filter(tweet => {
      const rect = tweet.getBoundingClientRect();
      return rect.top <= window.innerHeight * 2;
    })
    .sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);

  const processPromises = tweets.map(async (tweet) => {
    try {
      tweet.setAttribute('data-processed', 'true');
      
      const tweetData = extractTweetText(tweet);
      if (!tweetData.text) return;

      // Create a hash of username and text
      const cacheKey = hashString(`${tweetData.username}:${tweetData.text}`);

      // Use cached result if available
      const cachedResult = tweetCache.get(cacheKey);
      if (cachedResult !== undefined) {
        applyFilterAction(tweet, cachedResult);
        return;
      }

      // Use existing classification promise if available
      if (pendingClassifications.has(cacheKey)) {
        const decision = await pendingClassifications.get(cacheKey);
        applyFilterAction(tweet, decision);
        return;
      }

      // Create new classification promise
      const classificationPromise = classifyTweet(tweetData);
      pendingClassifications.set(cacheKey, classificationPromise);

      const shouldKeep = await classificationPromise;
      pendingClassifications.delete(cacheKey);
      
      console.log(`[Tweet Filter] New classification for @${tweetData.username}: "${tweetData.text.slice(0, 50)}..." -> ${shouldKeep ? 'keep' : 'remove'}`);
      
      tweetCache.set(cacheKey, shouldKeep);
      saveCache();
      
      applyFilterAction(tweet, shouldKeep);
    } catch (error) {
      console.error('Error processing tweet:', error);
      const cacheKey = tweetData ? hashString(`${tweetData.username}:${tweetData.text}`) : null;
      if (cacheKey) pendingClassifications.delete(cacheKey);
    }
  });

  await Promise.all(processPromises);
}
function extractTweetText(tweetElement) {
  const textElement = tweetElement.querySelector('div[data-testid="tweetText"]');
  const usernameElement = tweetElement.querySelector('div[data-testid="User-Name"] div');
  
  const text = textElement ? textElement.textContent.trim() : '';
  const username = usernameElement ? usernameElement.textContent.trim() : '';
  
  return { text, username };
}

async function classifyTweet(tweetData) {
  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${settings.apiKey}`
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini-2024-07-18',
        messages: [
          {
            role: 'system',
            content: `You are a tweet classifier. Analyze the tweet and determine if it should be kept or removed based on these conditions: <conditions>${settings.filterCondition}</conditions>`
          },
          {
            role: 'user',
            content: `<tweet>
              <username>${tweetData.username}</username>
              <content>${tweetData.text}</content>
            </tweet>`
          }
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "tweet_classification",
            schema: {
              type: "object",
              properties: {
                keep_tweet: {
                  type: "boolean",
                  description: "Whether the tweet should be kept (true) or removed (false)"
                }
              },
              required: ["keep_tweet"],
              additionalProperties: false
            },
            strict: true
          }
        }
      })
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    const decision = JSON.parse(data.choices[0].message.content);
    return decision.keep_tweet;
  } catch (error) {
    console.error('Error classifying tweet:', error);
    return true; // Keep tweet on error
  }
}

function applyFilterAction(tweetElement, shouldKeep) {
  if (!shouldKeep) {
    // Instead of display: none, we'll make it invisible but maintain its space
    tweetElement.style.visibility = 'hidden';
    tweetElement.style.minHeight = '0';
    tweetElement.style.height = '0';
    tweetElement.style.margin = '0';
    tweetElement.style.padding = '0';
    tweetElement.style.overflow = 'hidden';
    // Add transition for smoother height change
    tweetElement.style.transition = 'height 0.2s ease-out, margin 0.2s ease-out, padding 0.2s ease-out';
  }
}

// Utility function to debounce with flush capability
function debounce(func, wait) {
  let timeout;
  
  function debounced(...args) {
    const later = () => {
      clearTimeout(timeout);
      func.apply(this, args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  }
  
  debounced.flush = function() {
    clearTimeout(timeout);
    func.apply(this);
  };
  
  return debounced;
}

// Throttle the scroll event handler
const throttle = (func, limit) => {
  let inThrottle;
  return function(...args) {
    if (!inThrottle) {
      func.apply(this, args);
      inThrottle = true;
      setTimeout(() => inThrottle = false, limit);
    }
  };
}; 