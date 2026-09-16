interface Window {
  agentApi: {
    pairDevice: (pairingCode: string, deviceName: string) => Promise<{ success: boolean; error?: string }>;
    getDefaultStationName: () => Promise<string>;
  };
}

document.addEventListener('DOMContentLoaded', async () => {
  const form = document.getElementById('pairing-form') as HTMLFormElement;
  const boxes = Array.from(document.querySelectorAll<HTMLInputElement>('.code-box'));
  const deviceNameInput = document.getElementById('device-name') as HTMLInputElement;
  const statusEl = document.getElementById('status-message') as HTMLElement;
  const submitBtn = document.getElementById('submit-btn') as HTMLButtonElement;
  const spinner = submitBtn.querySelector('.spinner') as HTMLElement;
  const btnText = submitBtn.querySelector('.btn-text') as HTMLElement;

  // Load default station name from main process
  try {
    const defaultName = await window.agentApi.getDefaultStationName();
    if (defaultName && deviceNameInput) {
      deviceNameInput.value = defaultName;
    }
  } catch (err) {
    console.error('Failed to get default station name', err);
  }

  // Handle 6-character box input navigation
  boxes.forEach((box, index) => {
    box.addEventListener('input', (e: Event) => {
      const target = e.target as HTMLInputElement;
      const val = target.value.trim().toUpperCase();
      target.value = val ? val.slice(-1) : '';

      if (target.value && index < boxes.length - 1) {
        boxes[index + 1].focus();
      }
    });

    box.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Backspace' && !box.value && index > 0) {
        boxes[index - 1].focus();
      }
    });

    box.addEventListener('paste', (e: ClipboardEvent) => {
      e.preventDefault();
      const pastedData = e.clipboardData?.getData('text').trim().toUpperCase() || '';
      const cleanChars = pastedData.replace(/[^A-Z0-9]/g, '').slice(0, 6);

      cleanChars.split('').forEach((char, i) => {
        if (boxes[i]) {
          boxes[i].value = char;
        }
      });

      const nextFocus = Math.min(cleanChars.length, boxes.length - 1);
      boxes[nextFocus]?.focus();
    });
  });

  // Handle Form Submission
  form.addEventListener('submit', async (e: Event) => {
    e.preventDefault();
    statusEl.textContent = '';
    statusEl.className = 'status-message';

    const code = boxes.map((b) => b.value.trim().toUpperCase()).join('');
    const stationName = deviceNameInput.value.trim() || 'Shop-Station';

    if (code.length !== 6) {
      statusEl.textContent = 'Please enter all 6 characters of the pairing code.';
      statusEl.classList.add('error');
      return;
    }

    submitBtn.disabled = true;
    spinner.classList.remove('hidden');
    btnText.textContent = 'Verifying with PrintIt...';

    try {
      const response = await window.agentApi.pairDevice(code, stationName);
      if (response.success) {
        statusEl.textContent = 'Pairing successful! Connecting agent to shop...';
        statusEl.classList.add('success');
        btnText.textContent = 'Paired!';
      } else {
        statusEl.textContent = response.error || 'Failed to pair device. Please check code.';
        statusEl.classList.add('error');
        submitBtn.disabled = false;
        spinner.classList.add('hidden');
        btnText.textContent = 'Connect & Pair Agent';
      }
    } catch (err: any) {
      statusEl.textContent = err?.message || 'Network error connecting to PrintIt.';
      statusEl.classList.add('error');
      submitBtn.disabled = false;
      spinner.classList.add('hidden');
      btnText.textContent = 'Connect & Pair Agent';
    }
  });
});
