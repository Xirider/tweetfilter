document.addEventListener('DOMContentLoaded', function() {
  // Load saved settings
  chrome.storage.local.get(['apiKey', 'filterCondition', 'isEnabled', 'tweetClassifications'], function(result) {
    if (result.apiKey) {
      document.getElementById('apiKey').value = result.apiKey;
    }
    if (result.filterCondition) {
      document.getElementById('filterCondition').value = result.filterCondition;
    }
    
    // Handle enable/disable toggle
    const enableFilter = document.getElementById('enableFilter');
    enableFilter.checked = result.isEnabled === undefined ? true : result.isEnabled;
    
    // Calculate and display time saved
    const statsGroup = document.querySelector('.stats-group');
    if (result.tweetClassifications) {
      const classifications = JSON.parse(result.tweetClassifications);
      const numTweetsFiltered = Object.values(classifications).filter(decision => !decision).length;
      
      if (numTweetsFiltered > 0) {
        const avgWordsPerTweet = 10;
        const wordsPerMinute = 200; // Average reading speed
        const minutesSaved = (numTweetsFiltered * avgWordsPerTweet) / wordsPerMinute;
        
        // Convert to appropriate unit
        let timeDisplay;
        if (minutesSaved < 60) {
          timeDisplay = `${Math.round(minutesSaved)} minutes`;
        } else if (minutesSaved < 1440) { // Less than 24 hours
          const hours = Math.round(minutesSaved / 60 * 10) / 10; // Round to 1 decimal
          timeDisplay = `${hours} hours`;
        } else {
          const days = Math.round(minutesSaved / 1440 * 10) / 10; // Round to 1 decimal
          timeDisplay = `${days} days`;
        }
        
        document.getElementById('timeSaved').textContent = timeDisplay;
        statsGroup.style.display = 'block';
      } else {
        statsGroup.style.display = 'none';
      }
    } else {
      statsGroup.style.display = 'none';
    }
  });

  // Save settings
  document.getElementById('saveSettings').addEventListener('click', function() {
    const apiKey = document.getElementById('apiKey').value;
    const filterCondition = document.getElementById('filterCondition').value;
    const isEnabled = document.getElementById('enableFilter').checked;

    if (!apiKey || !filterCondition) {
      showStatus('Please fill in all fields', 'error');
      return;
    }

    chrome.storage.local.set({
      apiKey: apiKey,
      filterCondition: filterCondition,
      isEnabled: isEnabled
    }, function() {
      showStatus('Settings saved successfully!', 'success');
      // Notify content script that settings have been updated
      chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
        if (tabs[0]) {
          chrome.tabs.sendMessage(tabs[0].id, {
            type: 'SETTINGS_UPDATED'
          });
        }
      });
    });
  });

  // Handle enable/disable toggle changes
  document.getElementById('enableFilter').addEventListener('change', function(e) {
    chrome.storage.local.set({ isEnabled: e.target.checked }, function() {
      chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
        if (tabs[0]) {
          chrome.tabs.sendMessage(tabs[0].id, {
            type: 'SETTINGS_UPDATED'
          });
        }
      });
    });
  });
});

function showStatus(message, type) {
  const status = document.getElementById('status');
  status.textContent = message;
  status.className = `status show ${type}`;
  
  // Hide the status message after 3 seconds
  setTimeout(() => {
    status.className = 'status';
  }, 3000);
} 