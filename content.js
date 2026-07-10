// Voxlight — read the current selection aloud with a follow-along highlight.
(() => {
  if (window.__voxlightLoaded) return;
  window.__voxlightLoaded = true;

  const HIGHLIGHT_WORD = 'voxlight-word';
  const HIGHLIGHT_SPOKEN = 'voxlight-spoken';
  const supportsHighlights = typeof CSS !== 'undefined' && 'highlights' in CSS;

  let session = null;

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg && msg.type === 'voxlight-speak') startFromSelection();
  });

  document.addEventListener(
    'keydown',
    (e) => {
      if (e.key === 'Escape' && session) stopSession();
    },
    true
  );

  function startFromSelection() {
    stopSession();
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return;
    const segments = collectTextSegments(sel.getRangeAt(0));
    const fullText = segments.map((s) => s.text).join('');
    if (!fullText.trim()) return;
    chrome.storage.sync.get({ voiceName: '', rate: 1, pitch: 1 }, (prefs) => {
      whenVoicesReady((voices) => {
        session = new Session(segments, fullText, prefs, voices);
        session.start();
      });
    });
  }

  function stopSession() {
    if (session) {
      session.stop();
      session = null;
    }
  }

  // ---------- selection → text segments (char offsets ↔ DOM positions) ----------

  function collectTextSegments(range) {
    // Selection inside a single text node: no walk needed.
    if (
      range.startContainer === range.endContainer &&
      range.startContainer.nodeType === Node.TEXT_NODE
    ) {
      const node = range.startContainer;
      const text = node.data.slice(range.startOffset, range.endOffset);
      return text ? [{ node, start: range.startOffset, text, globalStart: 0 }] : [];
    }

    const root =
      range.commonAncestorContainer.nodeType === Node.TEXT_NODE
        ? range.commonAncestorContainer.parentNode
        : range.commonAncestorContainer;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!range.intersectsNode(node)) return NodeFilter.FILTER_REJECT;
        const tag = node.parentElement && node.parentElement.tagName;
        if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT') {
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      },
    });

    const segments = [];
    let globalStart = 0;
    let node;
    while ((node = walker.nextNode())) {
      const start = node === range.startContainer ? range.startOffset : 0;
      const end = node === range.endContainer ? range.endOffset : node.data.length;
      const text = node.data.slice(start, end);
      if (!text) continue;
      segments.push({ node, start, text, globalStart });
      globalStart += text.length;
    }
    return segments;
  }

  function positionFor(segments, globalIndex) {
    let lo = 0;
    let hi = segments.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      const seg = segments[mid];
      if (seg.globalStart + seg.text.length <= globalIndex) lo = mid + 1;
      else hi = mid;
    }
    const seg = segments[lo];
    const local = Math.max(0, Math.min(globalIndex - seg.globalStart, seg.text.length));
    return { node: seg.node, offset: seg.start + local };
  }

  function makeRange(segments, from, to) {
    const a = positionFor(segments, from);
    const b = positionFor(segments, to);
    const range = document.createRange();
    range.setStart(a.node, a.offset);
    range.setEnd(b.node, b.offset);
    return range;
  }

  // ---------- voices ----------

  function whenVoicesReady(cb) {
    const voices = speechSynthesis.getVoices();
    if (voices.length) return cb(voices);
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      speechSynthesis.removeEventListener('voiceschanged', finish);
      cb(speechSynthesis.getVoices());
    };
    speechSynthesis.addEventListener('voiceschanged', finish);
    setTimeout(finish, 1500);
  }

  function pickVoice(voices, name) {
    if (name) {
      const chosen = voices.find((v) => v.name === name);
      if (chosen) return chosen;
    }
    const lang = (document.documentElement.lang || navigator.language || 'en').slice(0, 2);
    // Local voices fire word-boundary events reliably; prefer them.
    return (
      voices.find((v) => v.localService && v.lang.slice(0, 2) === lang) ||
      voices.find((v) => v.localService) ||
      voices.find((v) => v.lang.slice(0, 2) === lang) ||
      null
    );
  }

  // ---------- reading session ----------

  const CHUNK_LEN = 200; // short utterances dodge Chrome's long-utterance stall

  function chunkText(fullText) {
    const chunks = [];
    let offset = 0;
    while (offset < fullText.length) {
      let end = Math.min(offset + CHUNK_LEN, fullText.length);
      if (end < fullText.length) {
        const slice = fullText.slice(offset, end);
        let cut = Math.max(
          slice.lastIndexOf('. '),
          slice.lastIndexOf('! '),
          slice.lastIndexOf('? '),
          slice.lastIndexOf('\n')
        );
        if (cut < CHUNK_LEN * 0.4) cut = slice.lastIndexOf(' ');
        if (cut > 0) end = offset + cut + 1;
      }
      chunks.push({ text: fullText.slice(offset, end), offset });
      offset = end;
    }
    return chunks;
  }

  class Session {
    constructor(segments, fullText, prefs, voices) {
      this.segments = segments;
      this.fullText = fullText;
      this.prefs = prefs;
      this.voice = pickVoice(voices, prefs.voiceName);
      this.chunks = chunkText(fullText);
      this.stopped = false;
      this.paused = false;
      this.utterance = null; // held to dodge Chrome's utterance-GC bug
      this.estimatorTimer = null;
      this.watchdog = null;
      this.pill = null;
    }

    start() {
      speechSynthesis.cancel();
      this.showPill();
      // Chrome silently pauses long speech after ~15s with some voices; nudge it.
      this.keepalive = setInterval(() => {
        if (!this.paused && speechSynthesis.speaking) speechSynthesis.resume();
      }, 10000);
      this.speakChunk(0);
    }

    speakChunk(i) {
      if (this.stopped) return;
      if (i >= this.chunks.length) return this.stop();
      const chunk = this.chunks[i];
      const u = new SpeechSynthesisUtterance(chunk.text);
      if (this.voice) u.voice = this.voice;
      u.rate = this.prefs.rate;
      u.pitch = this.prefs.pitch;

      let sawBoundary = false;
      u.onboundary = (e) => {
        if (e.name && e.name !== 'word') return;
        sawBoundary = true;
        this.stopEstimator();
        this.highlightWordAt(chunk.offset + e.charIndex);
      };
      u.onstart = () => {
        // No boundary events after 700ms → voice doesn't emit them; estimate timing.
        this.watchdog = setTimeout(() => {
          if (!sawBoundary && !this.stopped) this.startEstimator(chunk);
        }, 700);
      };
      const advance = () => {
        clearTimeout(this.watchdog);
        this.stopEstimator();
        if (!this.stopped) this.speakChunk(i + 1);
      };
      u.onend = advance;
      u.onerror = (e) => {
        if (e.error === 'canceled' || e.error === 'interrupted') return;
        advance();
      };

      this.utterance = u;
      speechSynthesis.speak(u);
    }

    highlightWordAt(globalIndex) {
      const m = /\S+/.exec(this.fullText.slice(globalIndex, globalIndex + 100));
      if (!m) return;
      const start = globalIndex + m.index;
      this.paint(start, start + m[0].length);
    }

    paint(wordStart, wordEnd) {
      if (!supportsHighlights) return;
      try {
        const wordRange = makeRange(this.segments, wordStart, wordEnd);
        CSS.highlights.set(HIGHLIGHT_WORD, new Highlight(wordRange));
        if (wordStart > 0) {
          CSS.highlights.set(
            HIGHLIGHT_SPOKEN,
            new Highlight(makeRange(this.segments, 0, wordStart))
          );
        }
        this.keepInView(wordRange);
      } catch (_) {
        // Page mutated the selected nodes mid-read; skip this word.
      }
    }

    keepInView(range) {
      const rect = range.getBoundingClientRect();
      if (rect.height === 0) return;
      if (rect.top < 60 || rect.bottom > window.innerHeight - 60) {
        const el =
          range.startContainer.nodeType === Node.TEXT_NODE
            ? range.startContainer.parentElement
            : range.startContainer;
        if (el) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }
    }

    // Fallback for voices without boundary events: pace words by length.
    startEstimator(chunk) {
      this.stopEstimator();
      const words = [];
      const re = /\S+/g;
      let m;
      while ((m = re.exec(chunk.text))) {
        words.push({ start: chunk.offset + m.index, len: m[0].length });
      }
      if (!words.length) return;
      const msPerChar = 60000 / (900 * (this.prefs.rate || 1)); // ≈180 wpm baseline
      let idx = 0;
      const step = () => {
        if (this.stopped || idx >= words.length) return;
        if (this.paused) {
          this.estimatorTimer = setTimeout(step, 200);
          return;
        }
        const w = words[idx++];
        this.highlightWordAt(w.start);
        this.estimatorTimer = setTimeout(step, Math.max(120, (w.len + 1) * msPerChar));
      };
      step();
    }

    stopEstimator() {
      clearTimeout(this.estimatorTimer);
      this.estimatorTimer = null;
    }

    togglePause() {
      if (this.paused) {
        this.paused = false;
        speechSynthesis.resume();
      } else {
        this.paused = true;
        speechSynthesis.pause();
      }
      this.updatePill();
    }

    stop() {
      if (this.stopped) return;
      this.stopped = true;
      clearInterval(this.keepalive);
      clearTimeout(this.watchdog);
      this.stopEstimator();
      speechSynthesis.cancel();
      if (supportsHighlights) {
        CSS.highlights.delete(HIGHLIGHT_WORD);
        CSS.highlights.delete(HIGHLIGHT_SPOKEN);
      }
      if (this.pill) this.pill.remove();
      if (session === this) session = null;
    }

    // ---------- floating control pill ----------

    showPill() {
      const host = document.createElement('div');
      host.style.cssText =
        'position:fixed;bottom:24px;right:24px;z-index:2147483647;';
      const root = host.attachShadow({ mode: 'open' });
      root.innerHTML = `
        <style>
          .pill {
            display: flex; align-items: center; gap: 8px;
            background: #1e1b4b; color: #fff;
            padding: 8px 14px; border-radius: 999px;
            font: 13px/1 -apple-system, system-ui, sans-serif;
            box-shadow: 0 4px 16px rgba(0,0,0,.35);
            user-select: none;
          }
          .name { font-weight: 600; letter-spacing: .02em; }
          button {
            all: unset; cursor: pointer; font-size: 14px;
            width: 26px; height: 26px; border-radius: 50%;
            display: flex; align-items: center; justify-content: center;
            background: rgba(255,255,255,.12);
          }
          button:hover { background: rgba(255,255,255,.25); }
        </style>
        <div class="pill">
          <span class="name">Voxlight</span>
          <button class="pause" title="Pause / resume">⏸</button>
          <button class="stop" title="Stop (Esc)">✕</button>
        </div>`;
      root.querySelector('.pause').addEventListener('click', () => this.togglePause());
      root.querySelector('.stop').addEventListener('click', () => this.stop());
      document.documentElement.appendChild(host);
      this.pill = host;
    }

    updatePill() {
      if (!this.pill) return;
      const btn = this.pill.shadowRoot.querySelector('.pause');
      btn.textContent = this.paused ? '▶' : '⏸';
    }
  }
})();
