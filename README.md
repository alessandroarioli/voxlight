# 🔊 Voxlight

Select text on any page, hear it read aloud, and watch a highlight follow the words as they're spoken. *Voice + highlight = Voxlight.*

## Install

1. Open `chrome://extensions`
2. Enable **Developer mode** (top right)
3. Click **Load unpacked** and pick this folder

## Use

1. Select text on any page
2. Right-click → **🔊 Read aloud with Voxlight** (or press **Alt+Shift+S**)
3. Words highlight as they're spoken; the already-read part stays tinted
4. Pause/resume or stop from the floating pill (or press **Esc**)

Voice, speed, and pitch: click the Voxlight toolbar icon.

## How it works

- **Speech** — Web Speech API (`speechSynthesis`), no server, no API keys.
- **Highlight** — CSS Custom Highlight API: paints ranges without touching the page's DOM, so nothing breaks.
- **Word tracking** — `onboundary` events from the utterance give the character index of each spoken word, mapped back to DOM positions.
- **On-demand injection** — no content script runs until you invoke Voxlight (`activeTab` + `scripting`); nothing touches pages you don't read aloud.
- **Fallback** — some voices (e.g. Google network voices) never fire word boundaries; Voxlight detects this and paces the highlight by estimated word timing instead.
- Long selections are chunked at sentence boundaries to dodge Chrome's long-utterance stall, plus a periodic `resume()` keepalive.

## Tips

- **Local voices** (marked `· local` in settings) give the most accurate highlight tracking.
- Doesn't work on `chrome://` pages, the Chrome Web Store, or the built-in PDF viewer — Chrome blocks content scripts there.
