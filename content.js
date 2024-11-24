// Cache for storing classification results
const tweetCache = new Map();
const pendingClassifications = new Map(); // Track in-flight requests
let pendingCacheSaves = 0;
const CACHE_SAVE_THRESHOLD = 10; // Force save after 10 new classifications

// Load cache from storage on startup
chrome.storage.local.get(['tweetClassifications'], function(result) {
  if (result.tweetClassifications) {
    const storedCache = JSON.parse(result.tweetClassifications);
    Object.entries(storedCache).forEach(([text, decision]) => {
      tweetCache.set(text, decision);
    });
    console.log(`[Tweet Filter] Loaded ${tweetCache.size} cached classifications`);
  }
});

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


// Initialize settings
let settings = {
  apiKey: '',
  filterCondition: ''
};

// Load settings when content script starts
chrome.storage.local.get(['apiKey', 'filterCondition'], function(result) {
  settings = result;
  if (settings.apiKey && settings.filterCondition) {
    startTweetProcessing();
  }
});

// Listen for settings updates
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'SETTINGS_UPDATED') {
    chrome.storage.local.get(['apiKey', 'filterCondition'], function(result) {
      settings = result;
      if (settings.apiKey && settings.filterCondition) {
        startTweetProcessing();
      }
    });
  }
});

function startTweetProcessing() {
  // Initial processing
  processTweets();
  
  // Set up observer for new tweets
  const tweetObserver = new MutationObserver(debounce(processTweets, 50));
  
  // Start observing the timeline
  observeTimeline(tweetObserver);
}

function observeTimeline(observer) {
  const timelineSelector = 'div[data-testid="primaryColumn"]';
  const checkTimeline = setInterval(() => {
    const timeline = document.querySelector(timelineSelector);
    if (timeline) {
      clearInterval(checkTimeline);
      observer.observe(timeline, {
        childList: true,
        subtree: true
      });
    }
  }, 1000);
}

async function processTweets() {
  const tweets = document.querySelectorAll('article[data-testid="tweet"]:not([data-processed="true"])');
  let newClassifications = 0;
  
  for (const tweet of tweets) {
    try {
      // Mark tweet as processed
      tweet.setAttribute('data-processed', 'true');
      
      // Extract tweet text
      const tweetText = extractTweetText(tweet);
      if (!tweetText) continue;
      
      // Check cache first
      const cachedResult = tweetCache.get(tweetText);
      if (cachedResult !== undefined) {
        console.log(`[Tweet Filter] Cached Result:
Tweet: "${tweetText}"
Decision: ${cachedResult ? 'KEEP' : 'REMOVE'}`);
        applyFilterAction(tweet, cachedResult);
        continue;
      }

      // Check if we're already classifying this tweet
      if (pendingClassifications.has(tweetText)) {
        console.log(`[Tweet Filter] Classification in progress for: "${tweetText}"`);
        const decision = await pendingClassifications.get(tweetText);
        applyFilterAction(tweet, decision);
        continue;
      }
      
      // Create promise for this classification
      const classificationPromise = classifyTweet(tweetText);
      pendingClassifications.set(tweetText, classificationPromise);
      
      // Classify tweet
      const shouldKeep = await classificationPromise;
      pendingClassifications.delete(tweetText); // Remove from pending after completion
      newClassifications++;
      
      // Cache the result
      tweetCache.set(tweetText, shouldKeep);
      
      // Save to storage (force save if we've processed many new tweets)
      saveCache(newClassifications >= CACHE_SAVE_THRESHOLD);
      
      // Log the result
      console.log(`[Tweet Filter] New Classification:
Tweet: "${tweetText}"
Decision: ${shouldKeep ? 'KEEP' : 'REMOVE'}`);
      
      // Apply the filter action
      applyFilterAction(tweet, shouldKeep);
    } catch (error) {
      console.error('Error processing tweet:', error);
      // Clean up pending classification on error
      const tweetText = extractTweetText(tweet);
      if (tweetText) {
        pendingClassifications.delete(tweetText);
      }
    }
  }
}

function extractTweetText(tweetElement) {
  const textElement = tweetElement.querySelector('div[data-testid="tweetText"]');
  return textElement ? textElement.textContent.trim() : '';
}

async function classifyTweet(tweetText) {
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
            content: `You are a tweet classifier. Analyze the tweet and determine if it should be kept or removed based on this condition: ${settings.filterCondition}`
          },
          {
            role: 'user',
            content: `<tweet>${tweetText}</tweet>`
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
    tweetElement.style.display = 'none';
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