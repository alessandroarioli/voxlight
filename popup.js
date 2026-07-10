const voiceSel = document.getElementById('voice');
const rateInput = document.getElementById('rate');
const pitchInput = document.getElementById('pitch');
const rateVal = document.getElementById('rateVal');
const pitchVal = document.getElementById('pitchVal');

function loadVoices(savedName) {
  const voices = speechSynthesis.getVoices();
  if (!voices.length) return false;
  voiceSel.innerHTML = '<option value="">Auto (prefer local)</option>';
  for (const v of voices) {
    const opt = document.createElement('option');
    opt.value = v.name;
    opt.textContent = `${v.name} (${v.lang})${v.localService ? ' · local' : ''}`;
    if (v.name === savedName) opt.selected = true;
    voiceSel.appendChild(opt);
  }
  return true;
}

chrome.storage.sync.get({ voiceName: '', rate: 1, pitch: 1 }, (prefs) => {
  rateInput.value = prefs.rate;
  pitchInput.value = prefs.pitch;
  updateLabels();
  if (!loadVoices(prefs.voiceName)) {
    speechSynthesis.addEventListener('voiceschanged', () => loadVoices(prefs.voiceName), {
      once: true,
    });
  }
});

function updateLabels() {
  rateVal.textContent = `${Number(rateInput.value).toFixed(1)}×`;
  pitchVal.textContent = Number(pitchInput.value).toFixed(1);
}

function save() {
  chrome.storage.sync.set({
    voiceName: voiceSel.value,
    rate: Number(rateInput.value),
    pitch: Number(pitchInput.value),
  });
}

voiceSel.addEventListener('change', save);
for (const input of [rateInput, pitchInput]) {
  input.addEventListener('input', () => {
    updateLabels();
    save();
  });
}

document.getElementById('preview').addEventListener('click', () => {
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance('Voxlight reads your selection with this voice.');
  const v = speechSynthesis.getVoices().find((v) => v.name === voiceSel.value);
  if (v) u.voice = v;
  u.rate = Number(rateInput.value);
  u.pitch = Number(pitchInput.value);
  speechSynthesis.speak(u);
});

document.getElementById('stop').addEventListener('click', () => speechSynthesis.cancel());
