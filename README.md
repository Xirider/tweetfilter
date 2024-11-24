# Tweet Filter AI Chrome Extension

A Chrome extension that uses GPT-4 to filter tweets on X.com (formerly Twitter) based on custom conditions.

## Features

- Filter tweets in real-time using GPT-4
- Custom filter conditions that you can set and update
- Automatic processing of new tweets as they appear
- Local storage of filter decisions for performance
- Simple and clean UI

## Installation

1. Clone this repository or download the files
2. Open Chrome and go to `chrome://extensions/`
3. Enable "Developer mode" in the top right
4. Click "Load unpacked" and select the directory containing these files

## Setup

1. Get an OpenAI API key from [OpenAI's platform](https://platform.openai.com/)
2. Click the extension icon in Chrome
3. Enter your OpenAI API key
4. Set your filter condition (e.g., "Remove tweets that are promotional or contain spam")
5. Click "Save Settings"

## Usage

1. Go to X.com (Twitter)
2. The extension will automatically start filtering tweets based on your condition
3. Filtered tweets will be hidden from view
4. You can update your filter condition at any time by clicking the extension icon

## Notes

- The extension uses the GPT-4 model for classification
- API calls are made directly from the extension to OpenAI
- Your API key and filter conditions are stored locally in Chrome storage
- Hidden tweets can be revealed by refreshing the page

## Privacy & Security

- Your OpenAI API key is stored locally in Chrome's secure storage
- No data is sent to any servers except OpenAI's API
- Tweet content is only processed locally and through OpenAI's API
