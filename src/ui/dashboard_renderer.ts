interface Window {
  dashboardApi: {
    getStatus: () => Promise<{
      shopId: string;
      shopName?: string;
      deviceId: string;
      deviceName: string;
      selectedPrinter?: string;
      isPaired: boolean;
    }>;
    getPrinters: () => Promise<Array<{ name: string; isDefault: boolean }>>;
    selectPrinter: (name: string) => Promise<boolean>;
    testPrint: () => Promise<{ success: boolean; savedPath?: string; error?: string }>;
    getRecentJobs: () => Promise<Array<{ job_id: string; printed_at: string; status: string }>>;
    openSecureFolder: () => Promise<boolean>;
    repairDevice: () => Promise<boolean>;
    getAutostart: () => Promise<boolean>;
    setAutostart: (enabled: boolean) => Promise<boolean>;
  };
}

document.addEventListener('DOMContentLoaded', async () => {
  const shopNameVal = document.getElementById('shop-name-val') as HTMLElement;
  const shopIdVal = document.getElementById('shop-id-val') as HTMLElement;
  const stationNameVal = document.getElementById('station-name-val') as HTMLElement;
  const printerSelect = document.getElementById('printer-select') as HTMLSelectElement;
  const refreshPrintersBtn = document.getElementById('refresh-printers-btn') as HTMLButtonElement;
  const testPrintBtn = document.getElementById('test-print-btn') as HTMLButtonElement;
  const testPrintFeedback = document.getElementById('test-print-feedback') as HTMLElement;
  const jobsTableBody = document.getElementById('jobs-table-body') as HTMLElement;
  const jobsCountBadge = document.getElementById('jobs-count-badge') as HTMLElement;
  const openTempBtn = document.getElementById('open-temp-btn') as HTMLButtonElement;
  const repairBtn = document.getElementById('repair-btn') as HTMLButtonElement;

  async function loadStatus() {
    try {
      const status = await window.dashboardApi.getStatus();
      if (status) {
        if (shopNameVal) {
          shopNameVal.textContent = status.shopName || 'Shop Connected';
        }
        shopIdVal.textContent = status.shopId || 'Not connected';
        stationNameVal.textContent = status.deviceName || 'Counter-Station-1';
      }
    } catch (err) {
      console.error('Failed to load status:', err);
    }
  }

  async function loadPrinters() {
    try {
      const [printers, status] = await Promise.all([
        window.dashboardApi.getPrinters(),
        window.dashboardApi.getStatus()
      ]);

      printerSelect.innerHTML = '';

      if (!printers || printers.length === 0) {
        const opt = document.createElement('option');
        opt.value = '';
        opt.textContent = 'No printers detected';
        printerSelect.appendChild(opt);
        return;
      }

      printers.forEach((p) => {
        const opt = document.createElement('option');
        opt.value = p.name;
        opt.textContent = `${p.name}${p.isDefault ? ' (Default)' : ''}`;
        if (status.selectedPrinter && status.selectedPrinter === p.name) {
          opt.selected = true;
        } else if (!status.selectedPrinter && p.isDefault) {
          opt.selected = true;
        }
        printerSelect.appendChild(opt);
      });
    } catch (err) {
      console.error('Failed to load printers:', err);
    }
  }

  async function loadRecentJobs() {
    try {
      const jobs = await window.dashboardApi.getRecentJobs();
      if (!jobs || jobs.length === 0) {
        jobsCountBadge.textContent = '0 jobs';
        jobsTableBody.innerHTML = `
          <tr class="empty-row">
            <td colspan="4">No print jobs processed yet on this station. Ready to receive orders!</td>
          </tr>
        `;
        return;
      }

      jobsCountBadge.textContent = `${jobs.length} job(s)`;
      jobsTableBody.innerHTML = jobs
        .map((j) => {
          const time = new Date(j.printed_at).toLocaleTimeString();
          return `
            <tr>
              <td class="mono">${j.job_id.slice(0, 12)}...</td>
              <td><span class="badge-success">${j.status}</span></td>
              <td>🛡️ Auto-Purged</td>
              <td>${time}</td>
            </tr>
          `;
        })
        .join('');
    } catch (err) {
      console.error('Failed to load recent jobs:', err);
    }
  }

  // Handle printer selection change
  printerSelect.addEventListener('change', async () => {
    const selected = printerSelect.value;
    if (selected) {
      await window.dashboardApi.selectPrinter(selected);
      testPrintFeedback.textContent = `Active printer set to: ${selected}`;
      testPrintFeedback.className = 'feedback-msg success';
      setTimeout(() => {
        testPrintFeedback.textContent = '';
      }, 4000);
    }
  });

  refreshPrintersBtn.addEventListener('click', async () => {
    await loadPrinters();
    testPrintFeedback.textContent = 'Printers list refreshed!';
    testPrintFeedback.className = 'feedback-msg success';
    setTimeout(() => {
      testPrintFeedback.textContent = '';
    }, 2500);
  });

  // Handle Test Print
  testPrintBtn.addEventListener('click', async () => {
    testPrintBtn.disabled = true;
    testPrintFeedback.textContent = 'Generating & dispatching test print...';
    testPrintFeedback.className = 'feedback-msg';

    try {
      const res = await window.dashboardApi.testPrint();
      if (res.success) {
        testPrintFeedback.textContent = res.savedPath
          ? `Virtual print slip created! File opened in File Explorer.`
          : `Test print sent to printer successfully!`;
        testPrintFeedback.className = 'feedback-msg success';
        await loadRecentJobs();
      } else {
        testPrintFeedback.textContent = `Print failed: ${res.error || 'Unknown error'}`;
        testPrintFeedback.className = 'feedback-msg error';
      }
    } catch (err: any) {
      testPrintFeedback.textContent = `Error: ${err?.message || 'Print dispatch failed'}`;
      testPrintFeedback.className = 'feedback-msg error';
    } finally {
      testPrintBtn.disabled = false;
    }
  });

  // Handle open temp directory
  openTempBtn.addEventListener('click', async () => {
    await window.dashboardApi.openSecureFolder();
  });

  // Handle re-pair station
  repairBtn.addEventListener('click', async () => {
    const confirmed = confirm('Are you sure you want to unpair this station? You will need a new pairing code from your Shopkeeper Portal.');
    if (confirmed) {
      await window.dashboardApi.repairDevice();
    }
  });

  
  const autostartToggle = document.getElementById('autostart-toggle') as HTMLInputElement;
  const autostartStatusBadge = document.getElementById('autostart-status-badge') as HTMLElement;

  async function loadAutostart() {
    try {
      const isAutostart = await window.dashboardApi.getAutostart();
      if (autostartToggle) {
        autostartToggle.checked = isAutostart;
      }
      if (autostartStatusBadge) {
        autostartStatusBadge.textContent = isAutostart ? 'Enabled (Default)' : 'Disabled';
        autostartStatusBadge.className = isAutostart ? 'badge-success' : 'badge-disabled';
      }
    } catch (e) {
      console.error('Failed to load autostart setting:', e);
    }
  }

  if (autostartToggle) {
    autostartToggle.addEventListener('change', async () => {
      const enabled = autostartToggle.checked;
      await window.dashboardApi.setAutostart(enabled);
      if (autostartStatusBadge) {
        autostartStatusBadge.textContent = enabled ? 'Enabled' : 'Disabled';
        autostartStatusBadge.className = enabled ? 'badge-success' : 'badge-disabled';
      }
      testPrintFeedback.textContent = `Windows auto-launch ${enabled ? 'enabled' : 'disabled'}.`;
      testPrintFeedback.className = 'feedback-msg success';
      setTimeout(() => {
        testPrintFeedback.textContent = '';
      }, 3000);
    });
  }

  // Initial load
  await loadStatus();
  await loadAutostart();
  await loadPrinters();
  await loadRecentJobs();

  // Periodic polling for new jobs
  setInterval(loadRecentJobs, 5000);
});
