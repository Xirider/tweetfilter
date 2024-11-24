document.addEventListener('DOMContentLoaded', function() {
  // Load saved settings
  chrome.storage.local.get(['apiKey', 'filterCondition'], function(result) {
    if (result.apiKey) {
      document.getElementById('apiKey').value = result.apiKey;
    }
    if (result.filterCondition) {
      document.getElementById('filterCondition').value = result.filterCondition;
    }
  });

  // Save settings
  document.getElementById('saveSettings').addEventListener('click', function() {
    const apiKey = document.getElementById('apiKey').value;
    const filterCondition = document.getElementById('filterCondition').value;

    if (!apiKey || !filterCondition) {
      showStatus('Please fill in all fields', 'error');
      return;
    }

    chrome.storage.local.set({
      apiKey: apiKey,
      filterCondition: filterCondition
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
});

function showStatus(message, type) {
  const status = document.getElementById('status');
  status.textContent = message;
  status.style.backgroundColor = type === 'error' ? '#ffebee' : '#e8f5e9';
  status.style.color = type === 'error' ? '#c62828' : '#2e7d32';
} 