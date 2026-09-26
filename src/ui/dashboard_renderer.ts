interface Window {
  dashboardApi: {
    getStatus: () => Promise<{
      shopId: string;
      shopName?: string;
      deviceId: string;
      deviceName: string;
      selectedPrinter?: string;
      selectedPrinterBw?: string;
      selectedPrinterColor?: string;
      isPaired: boolean;
    }>;
    getPrinters: () => Promise<Array<{ name: string; isDefault: boolean }>>;
    selectPrinter: (name: string) => Promise<boolean>;
    selectPrinterBw: (name: string) => Promise<boolean>;
    selectPrinterColor: (name: string) => Promise<boolean>;
    testPrint: () => Promise<{ success: boolean; savedPath?: string; error?: string }>;
    getRecentJobs: () => Promise<Array<{ job_id: string; printed_at: string; status: string }>>;
    openSecureFolder: () => Promise<boolean>;
    repairDevice: () => Promise<boolean>;
    getAutostart: () => Promise<boolean>;
    setAutostart: (enabled: boolean) => Promise<boolean>;
    onActivityLog: (callback: (entry: { message: string; timestamp: string }) => void) => void;
  };
}

document.addEventListener('DOMContentLoaded', async () => {
  const shopNameVal = document.getElementById('shop-name-val') as HTMLElement;
  const shopIdVal = document.getElementById('shop-id-val') as HTMLElement;
  const stationNameVal = document.getElementById('station-name-val') as HTMLElement;
  const printerSelect = document.getElementById('printer-select') as HTMLSelectElement;
  const printerSelectBw = document.getElementById('printer-select-bw') as HTMLSelectElement;
  const printerSelectColor = document.getElementById('printer-select-color') as HTMLSelectElement;
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

      const populateSelect = (selectEl: HTMLSelectElement, selectedVal?: string) => {
        if (!selectEl) return;
        selectEl.innerHTML = '';

        if (!printers || printers.length === 0) {
          const opt = document.createElement('option');
          opt.value = '';
          opt.textContent = 'No printers detected';
          selectEl.appendChild(opt);
          return;
        }

        printers.forEach((p) => {
          const opt = document.createElement('option');
          opt.value = p.name;
          opt.textContent = `${p.name}${p.isDefault ? ' (OS Default)' : ''}`;
          if (selectedVal && selectedVal === p.name) {
            opt.selected = true;
          } else if (!selectedVal && p.isDefault) {
            opt.selected = true;
          }
          selectEl.appendChild(opt);
        });
      };

      populateSelect(printerSelect, status.selectedPrinter);
      populateSelect(printerSelectBw, status.selectedPrinterBw || status.selectedPrinter);
      populateSelect(printerSelectColor, status.selectedPrinterColor || status.selectedPrinter);
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

  // Handle printer selection changes
  if (printerSelect) {
    printerSelect.addEventListener('change', async () => {
      const selected = printerSelect.value;
      if (selected) {
        await window.dashboardApi.selectPrinter(selected);
        showFeedback(`General fallback printer set to: ${selected}`);
      }
    });
  }

  if (printerSelectBw) {
    printerSelectBw.addEventListener('change', async () => {
      const selected = printerSelectBw.value;
      if (selected) {
        await window.dashboardApi.selectPrinterBw(selected);
        showFeedback(`Default B&W printer set to: ${selected}`);
      }
    });
  }

  if (printerSelectColor) {
    printerSelectColor.addEventListener('change', async () => {
      const selected = printerSelectColor.value;
      if (selected) {
        await window.dashboardApi.selectPrinterColor(selected);
        showFeedback(`Default Color printer set to: ${selected}`);
      }
    });
  }

  function showFeedback(msg: string, isError = false) {
    if (!testPrintFeedback) return;
    testPrintFeedback.textContent = msg;
    testPrintFeedback.className = isError ? 'feedback-msg error' : 'feedback-msg success';
    setTimeout(() => {
      if (testPrintFeedback.textContent === msg) {
        testPrintFeedback.textContent = '';
      }
    }, 4000);
  }

  refreshPrintersBtn.addEventListener('click', async () => {
    await loadPrinters();
    showFeedback('Printers list refreshed!');
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

  // Periodic polling for new jobs (SQLite history)
  setInterval(loadRecentJobs, 5000);

  // ── Reprint Activity Log ───────────────────────────────────────────────────
  // Listen for live push-events from the ReprintPoller (main process)
  // and display them in the activity log section if it exists in the HTML.
  const activityLog = document.getElementById('reprint-activity-log') as HTMLElement | null;
  const MAX_ACTIVITY_ENTRIES = 50;

  if (activityLog && window.dashboardApi.onActivityLog) {
    window.dashboardApi.onActivityLog((entry) => {
      const isSuccess = entry.message.startsWith('✅');
      const time = new Date(entry.timestamp).toLocaleTimeString();

      const row = document.createElement('div');
      row.className = `activity-entry ${isSuccess ? 'activity-success' : 'activity-warning'}`;
      row.innerHTML = `<span class="activity-time">${time}</span><span class="activity-msg">${entry.message}</span>`;

      // Prepend so newest is at top
      activityLog.insertBefore(row, activityLog.firstChild);

      // Trim to max entries
      while (activityLog.children.length > MAX_ACTIVITY_ENTRIES) {
        activityLog.removeChild(activityLog.lastChild!);
      }
    });
  }
});
