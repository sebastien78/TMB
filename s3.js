const VERSION = "20250305-22:10";
let backupIntervalRunning = false;
let wasImportSuccessful = false;
let isExportInProgress = false;
let isImportInProgress = false;
let isConsoleLoggingEnabled =
  new URLSearchParams(window.location.search).get("log") === "true";
const TIME_BACKUP_INTERVAL = 15;
const TIME_BACKUP_FILE_PREFIX = `T-${TIME_BACKUP_INTERVAL}`;
let awsSdkLoadPromise = null;
const awsSdkPromise = loadAwsSdk();
let isPageFullyLoaded = false;
let backupInterval = null;
let isWaitingForUserInput = false;
let cloudOperationQueue = [];
let isProcessingQueue = false;
let cloudFileSize = 0;
let localFileSize = 0;
let isLocalDataModified = false;

const hintCssLink = document.createElement("link");
hintCssLink.rel = "stylesheet";
hintCssLink.href = "https://cdn.jsdelivr.net/npm/hint.css/hint.min.css";
document.head.appendChild(hintCssLink);

const syncStatusStyles = document.createElement("style");
syncStatusStyles.textContent = `
    #sync-status {
        position: fixed;
        background: rgba(0, 0, 0, 0.7);
        color: white;
        padding: 10px 14px;
        border-radius: 8px;
        font-size: 14px;
        z-index: 1000;
        cursor: move;
        user-select: none;
        transition: all 0.3s ease;
        display: flex;
        align-items: center;
        gap: 12px;
        max-width: 95%;
        flex-wrap: nowrap;
        overflow-x: auto;
    }
    #sync-status.minimized {
        max-width: 40px;
        height: 40px;
        padding: 8px;
        overflow: hidden;
        justify-content: center;
        cursor: pointer;
    }
    #sync-status.minimized .sync-indicator {
        margin: 0;
        padding: 0;
    }
    #sync-status.minimized .sync-indicator span:not(.sync-dot),
    #sync-status.minimized .import-indicator,
    #sync-status.minimized .export-indicator,
    #sync-status.minimized .mode-switch,
    #sync-status.minimized .minimize-btn {
        display: none;
    }
    .minimize-btn {
        cursor: pointer;
        padding: 2px;
        line-height: 1;
        border-radius: 4px;
        margin-left: auto;
        opacity: 0.7;
        transition: opacity 0.2s;
        position: absolute;
        right: 8px;
        top: 4px;
    }
    .minimize-btn:hover {
        opacity: 1;
    }
    #sync-status.minimized .minimize-btn {
        transform: rotate(180deg);
    }
    .sync-failed {
        color: #ff4444;
    }
    .sync-indicator {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        flex-shrink: 0;
        padding: 4px 0;
    }
    .import-indicator, .export-indicator {
        white-space: nowrap;
        flex-shrink: 0;
        cursor: pointer;
        padding: 6px 8px;
        border-radius: 4px;
        transition: background-color 0.2s;
        min-height: 32px;
        display: inline-flex;
        align-items: center;
    }
    .import-indicator:active, .export-indicator:active {
        background-color: rgba(255, 255, 255, 0.2);
    }
    .sync-dot {
        width: 10px;
        height: 10px;
        border-radius: 50%;
        display: inline-block;
        flex-shrink: 0;
        box-shadow: 0 0 2px rgba(0, 0, 0, 0.3);
        border: 1px solid rgba(255, 255, 255, 0.2);
    }
    @keyframes spin {
        from { transform: rotate(0deg); }
        to { transform: rotate(360deg); }
    }
    .sync-spinner {
        display: inline-block;
        animation: spin 1s linear infinite;
        font-size: 16px;
    }
    .mode-switch {
        display: inline-flex;
        align-items: center;
        position: relative;
        margin-left: 8px;
        height: 20px;
        vertical-align: middle;
        flex-shrink: 0;
        padding: 4px;
    }
    .mode-switch-input {
        height: 0;
        width: 0;
        visibility: hidden;
        position: absolute;
    }
    .mode-switch-label {
        cursor: pointer;
        width: 40px;
        height: 20px;
        background: #444;
        display: inline-flex;
        align-items: center;
        border-radius: 20px;
        position: relative;
        flex-shrink: 0;
        vertical-align: middle;
    }
    .mode-switch-label:after {
        content: '';
        position: absolute;
        top: 2px;
        left: 2px;
        width: 16px;
        height: 16px;
        background: #fff;
        border-radius: 16px;
        transition: 0.2s;
    }
    .mode-switch-input:checked + .mode-switch-label {
        background: #10B981;
    }
    .mode-switch-input:checked + .mode-switch-label:after {
        left: calc(100% - 2px);
        transform: translateX(-100%);
    }
    .mode-switch-text {
        font-size: 12px;
        margin-left: 6px;
        line-height: 1;
        display: inline-flex;
        align-items: center;
        vertical-align: middle;
        flex-shrink: 0;
    }
`;
document.head.appendChild(syncStatusStyles);

let lastImportTime = null;
let lastExportTime = null;
let lastImportStatus = null;
let lastExportStatus = null;

function getImportThreshold() {
  return parseFloat(localStorage.getItem("import-size-threshold")) || 1;
}

function getExportThreshold() {
  return parseFloat(localStorage.getItem("export-size-threshold")) || 10;
}

function initializeLoggingState() {
  const urlParams = new URLSearchParams(window.location.search);
  const logParam = urlParams.get("log");
  const syncStatusParam = urlParams.get("syncstatus");

  if (logParam === "true") {
    isConsoleLoggingEnabled = true;
    logToConsole("info", `Typingmind cloud backup version ${VERSION}`);
  }

  if (syncStatusParam === "true") {
    localStorage.setItem("sync-status-hidden", "false");
    urlParams.delete("syncstatus");
    const newUrl =
      window.location.pathname +
      (urlParams.toString() ? "?" + urlParams.toString() : "");
    window.history.replaceState({}, "", newUrl);
  }
}

function createSyncStatus() {
  if (document.getElementById("sync-status")) return;

  const syncStatus = document.createElement("div");
  syncStatus.id = "sync-status";
  syncStatus.classList.add("minimized");

  const isHidden = localStorage.getItem("sync-status-hidden") === "true";
  if (isHidden) {
    syncStatus.style.display = "none";
  }

  const isMobile = window.innerWidth <= 768;
  const defaultPosition = isMobile
    ? { x: "left: 20px", y: "top: 60px" }
    : { x: "right: 20px", y: "top: 20px" };

  const savedPosition = JSON.parse(
    localStorage.getItem("sync-status-position") ||
      JSON.stringify(defaultPosition)
  );
  Object.entries(savedPosition).forEach(([axis, value]) => {
    const [side, offset] = value.split(":");
    syncStatus.style[side.trim()] = offset.trim();
  });

  let isDragging = false;
  let currentX;
  let currentY;
  let initialX;
  let initialY;
  let xOffset = 0;
  let yOffset = 0;
  let longPressTimer = null;
  const LONG_PRESS_DURATION = 500; // 500ms for long press

  function dragStart(e) {
    // Only apply long press for direct clicks on the minimized sync status container
    if (syncStatus.classList.contains("minimized") && e.target === syncStatus) {
      // For minimized state, start a timer for long press
      longPressTimer = setTimeout(() => {
        initiateDrag(e);
      }, LONG_PRESS_DURATION);

      // Add event listeners to cancel long press if mouse/touch moves or ends
      const cancelLongPress = () => {
        if (longPressTimer) {
          clearTimeout(longPressTimer);
          longPressTimer = null;
        }
      };

      document.addEventListener("mousemove", cancelLongPress, { once: true });
      document.addEventListener("mouseup", cancelLongPress, { once: true });
      document.addEventListener("touchmove", cancelLongPress, { once: true });
      document.addEventListener("touchend", cancelLongPress, { once: true });
    } else {
      // For non-minimized state or child elements, start drag immediately
      initiateDrag(e);
    }
  }

  function initiateDrag(e) {
    if (e.type === "touchstart" || e.type.includes("touch")) {
      initialX = e.touches[0].clientX - xOffset;
      initialY = e.touches[0].clientY - yOffset;
    } else {
      initialX = e.clientX - xOffset;
      initialY = e.clientY - yOffset;
    }

    if (e.target === syncStatus) {
      isDragging = true;
      syncStatus.classList.add("dragging");
    }
  }

  function dragEnd() {
    if (longPressTimer) {
      clearTimeout(longPressTimer);
      longPressTimer = null;
    }

    if (!isDragging) return;

    isDragging = false;
    syncStatus.classList.remove("dragging");

    const rect = syncStatus.getBoundingClientRect();
    const position = {
      x:
        rect.left < window.innerWidth / 2
          ? `left: ${rect.left}px`
          : `right: ${window.innerWidth - rect.right}px`,
      y:
        rect.top < window.innerHeight / 2
          ? `top: ${rect.top}px`
          : `bottom: ${window.innerHeight - rect.bottom}px`,
    };
    localStorage.setItem("sync-status-position", JSON.stringify(position));
  }

  function drag(e) {
    if (!isDragging) return;

    e.preventDefault();

    if (e.type === "touchmove") {
      currentX = e.touches[0].clientX - initialX;
      currentY = e.touches[0].clientY - initialY;
    } else {
      currentX = e.clientX - initialX;
      currentY = e.clientY - initialY;
    }

    xOffset = currentX;
    yOffset = currentY;

    syncStatus.style.transform = `translate(${currentX}px, ${currentY}px)`;
  }

  syncStatus.addEventListener("mousedown", dragStart);
  syncStatus.addEventListener("touchstart", dragStart, { passive: true });
  document.addEventListener("mousemove", drag);
  document.addEventListener("touchmove", drag, { passive: false });
  document.addEventListener("mouseup", dragEnd);
  document.addEventListener("touchend", dragEnd);

  document.body.appendChild(syncStatus);
  updateSyncStatus();
}

function updateSyncStatus() {
  setTimeout(() => {
    const syncStatus = document.getElementById("sync-status");
    if (!syncStatus) return;

    const formatTime = (timestamp) => {
      if (!timestamp) return "";
      const seconds = Math.floor((Date.now() - timestamp) / 1000);
      return seconds < 60
        ? `${seconds}s ago`
        : seconds < 3600
        ? `${Math.floor(seconds / 60)}m ago`
        : `${Math.floor(seconds / 3600)}h ago`;
    };

    const getSyncStatus = () => {
      if (localStorage.getItem("sync-mode") === "backup") return "";

      if (cloudFileSize === 0 || localFileSize === 0) return "";
      const isSynced =
        !isLocalDataModified && Math.abs(cloudFileSize - localFileSize) === 0;
      return `<span class="sync-indicator">
        <span class="sync-dot" style="background-color: ${
          isSynced ? "#10B981" : "#EF4444"
        }"></span>
        <span>${isSynced ? "Synced" : "Not synced"}</span>
      </span>`;
    };

    const getOperationStatus = () => {
      if (isImportInProgress || isExportInProgress) {
        return `<span class="sync-indicator">
          <span class="sync-dot" style="background-color: #3B82F6"></span>
          <span class="sync-spinner">↻</span>
        </span>`;
      }
      return "";
    };

    const importStatus =
      !isImportInProgress && lastImportTime
        ? `<span class="import-indicator" data-action="import">⬇️ ${formatTime(
            lastImportTime
          )}</span>`
        : "";

    const exportStatus =
      !isExportInProgress && lastExportTime
        ? `<span class="export-indicator" data-action="export">⬆️ ${formatTime(
            lastExportTime
          )}</span>`
        : "";

    const syncIndicator = getOperationStatus() || getSyncStatus();
    const modeSwitch = `
      <div class="mode-switch" title="Toggle between Sync and Backup modes">
        <input type="checkbox" id="mode-switch-input" class="mode-switch-input" ${
          localStorage.getItem("sync-mode") !== "backup" ? "checked" : ""
        }>
        <label for="mode-switch-input" class="mode-switch-label"></label>
        <span class="mode-switch-text">${
          localStorage.getItem("sync-mode") === "backup" ? "Backup" : "Sync"
        }</span>
      </div>
    `;

    const minimizeBtn =
      '<button class="minimize-btn" title="Minimize">—</button>';

    const statusContent = [
      syncIndicator,
      importStatus,
      exportStatus,
      modeSwitch,
      minimizeBtn,
    ]
      .filter(Boolean)
      .join(" ");

    if (statusContent) {
      syncStatus.innerHTML = statusContent;
      syncStatus.style.display = "block";

      // Add click handler for minimized state
      syncStatus.addEventListener("click", (e) => {
        if (syncStatus.classList.contains("minimized")) {
          syncStatus.classList.remove("minimized");
        }
      });

      const minimizeButton = syncStatus.querySelector(".minimize-btn");
      if (minimizeButton) {
        minimizeButton.addEventListener("click", (e) => {
          e.stopPropagation();
          syncStatus.classList.add("minimized");
        });
      }

      // Add event listener to the mode switch
      const modeSwitchInput = document.getElementById("mode-switch-input");
      if (modeSwitchInput) {
        modeSwitchInput.addEventListener("change", function () {
          const newMode = this.checked ? "sync" : "backup";
          localStorage.setItem("sync-mode", newMode);
          const modeText = document.querySelector(".mode-switch-text");
          if (modeText) {
            modeText.textContent = newMode === "sync" ? "Sync" : "Backup";
          }
          logToConsole("info", `Mode changed to: ${newMode}`);

          // If switching to sync mode, trigger an import
          if (newMode === "sync" && !isImportInProgress) {
            queueCloudOperation("mode-change-import", importFromS3);
          }
        });
      }

      // Add double-tap event listeners for import/export indicators
      setupDoubleTapListener(
        syncStatus.querySelector(".import-indicator"),
        () => {
          if (!isImportInProgress) {
            logToConsole(
              "info",
              "Double-tap detected on import indicator, triggering import"
            );
            queueCloudOperation("manual-import", importFromS3);
          }
        }
      );

      setupDoubleTapListener(
        syncStatus.querySelector(".export-indicator"),
        () => {
          if (!isExportInProgress) {
            logToConsole(
              "info",
              "Double-tap detected on export indicator, triggering export"
            );
            queueCloudOperation("manual-export", backupToS3);
          }
        }
      );
    } else {
      syncStatus.style.display = "none";
    }
  }, 500);
}

// Helper function to set up double-tap detection
function setupDoubleTapListener(element, callback) {
  if (!element) return;

  let lastTap = 0;
  const tapDelay = 300; // milliseconds

  element.addEventListener("click", function (e) {
    const currentTime = new Date().getTime();
    const tapLength = currentTime - lastTap;

    if (tapLength < tapDelay && tapLength > 0) {
      e.preventDefault();
      callback();
    }

    lastTap = currentTime;
  });
}

async function processCloudOperationQueue() {
  if (isProcessingQueue || cloudOperationQueue.length === 0) {
    return;
  }

  isProcessingQueue = true;
  logToConsole(
    "info",
    `Processing cloud operation queue (${cloudOperationQueue.length} items)`
  );

  while (cloudOperationQueue.length > 0) {
    const nextOperation = cloudOperationQueue[0];
    try {
      logToConsole("info", `Executing queued operation: ${nextOperation.name}`);
      await nextOperation.operation();

      // Add a small delay after each operation to ensure proper completion
      await new Promise((resolve) => setTimeout(resolve, 1000));

      logToConsole("success", `Completed operation: ${nextOperation.name}`);
      cloudOperationQueue.shift();
    } catch (error) {
      logToConsole(
        "error",
        `Error executing queued operation ${nextOperation.name}:`,
        error
      );
      cloudOperationQueue.shift();

      // Add a delay after errors to prevent rapid retries
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }

  isProcessingQueue = false;
  logToConsole("info", "Cloud operation queue processing completed");
}

function queueCloudOperation(name, operation) {
  if (cloudOperationQueue.length > 0) {
    const lastOperation = cloudOperationQueue[cloudOperationQueue.length - 1];
    if (lastOperation.name === name) {
      logToConsole("skip", `Skipping duplicate operation: ${name}`);
      return;
    }
  }

  cloudOperationQueue.push({ name, operation });
  logToConsole("info", `Added ${name} to cloud operation queue`);
  processCloudOperationQueue();
}

async function importFromS3() {
  if (isImportInProgress) {
    logToConsole("skip", "Import already in progress, queueing this import");
    queueCloudOperation("import", importFromS3);
    return;
  }

  isImportInProgress = true;
  try {
    lastImportStatus = "in-progress";
    updateSyncStatus();
    logToConsole("download", "Starting import from S3...");

    logToConsole("info", "Device Info", {
      userAgent: navigator.userAgent,
      platform: navigator.platform,
      isMobile: /Mobi|Android/i.test(navigator.userAgent),
    });

    const bucketName = localStorage.getItem("aws-bucket");
    const awsRegion = localStorage.getItem("aws-region");
    const awsAccessKey = localStorage.getItem("aws-access-key");
    const awsSecretKey = localStorage.getItem("aws-secret-key");
    const awsEndpoint = localStorage.getItem("aws-endpoint");
    if (typeof AWS === "undefined") {
      await loadAwsSdk();
    }
    const awsConfig = {
      accessKeyId: awsAccessKey,
      secretAccessKey: awsSecretKey,
      region: awsRegion,
    };
    if (awsEndpoint) {
      awsConfig.endpoint = awsEndpoint;
    }
    AWS.config.update(awsConfig);
    let s3 = new AWS.S3();
    const params = {
      Bucket: bucketName,
      Key: "typingmind-backup.json",
    };

    let cloudData;
    let s3Data = await s3.getObject(params).promise();
    cloudFileSize = s3Data.Body.length;

    if (cloudFileSize === 0) {
      logToConsole("warning", "Empty backup file found in S3");
      resetSizes();
      wasImportSuccessful = true;
      const message = "No valid backup found in cloud storage...";
      await showCustomAlert(message, "No Backup Found");
      return false;
    }

    cloudLastModified = s3Data.LastModified;
    cloudData = await decryptData(new Uint8Array(s3Data.Body));

    logToConsole("success", "Cloud data stats:", {
      totalSize: `${cloudFileSize} bytes`,
      lastModified: cloudLastModified,
      localStorageKeys: Object.keys(cloudData.localStorage || {}).length,
      localStorageSize: JSON.stringify(cloudData.localStorage || {}).length,
      indexedDBKeys: Object.keys(cloudData.indexedDB || {}).length,
      indexedDBSize: JSON.stringify(cloudData.indexedDB || {}).length,
    });

    const lastSync = localStorage.getItem("last-cloud-sync");
    logToConsole("info", "Last sync time:", lastSync);

    const currentData = await exportBackupData();
    const currentLocalStorageKeys = new Set(
      Object.keys(currentData.localStorage || {})
    );
    const currentIndexedDBKeys = new Set(
      Object.keys(currentData.indexedDB || {})
    );

    logToConsole("info", "Current local data stats:", {
      totalSize: `${new Blob([JSON.stringify(currentData)]).size} bytes`,
      localStorageKeys: Object.keys(currentData.localStorage || {}).length,
      localStorageSize: JSON.stringify(currentData.localStorage || {}).length,
      indexedDBKeys: Object.keys(currentData.indexedDB || {}).length,
      indexedDBSize: JSON.stringify(currentData.indexedDB || {}).length,
    });

    const cloudLocalStorageKeys = new Set(
      Object.keys(cloudData.localStorage || {})
    );
    const cloudIndexedDBKeys = new Set(Object.keys(cloudData.indexedDB || {}));

    const keyDifferences = {
      localStorage: {
        onlyInCloud: [...cloudLocalStorageKeys].filter(
          (key) => !currentLocalStorageKeys.has(key)
        ),
        onlyInLocal: [...currentLocalStorageKeys].filter(
          (key) => !cloudLocalStorageKeys.has(key)
        ),
      },
      indexedDB: {
        onlyInCloud: [...cloudIndexedDBKeys].filter(
          (key) => !currentIndexedDBKeys.has(key)
        ),
        onlyInLocal: [...currentIndexedDBKeys].filter(
          (key) => !cloudIndexedDBKeys.has(key)
        ),
      },
    };

    logToConsole("info", "Key differences:", {
      localStorage: {
        onlyInCloud:
          keyDifferences.localStorage.onlyInCloud.length > 0
            ? keyDifferences.localStorage.onlyInCloud
            : "none",
        onlyInLocal:
          keyDifferences.localStorage.onlyInLocal.length > 0
            ? keyDifferences.localStorage.onlyInLocal
            : "none",
        totalCloud: cloudLocalStorageKeys.size,
        totalLocal: currentLocalStorageKeys.size,
      },
      indexedDB: {
        onlyInCloud:
          keyDifferences.indexedDB.onlyInCloud.length > 0
            ? keyDifferences.indexedDB.onlyInCloud
            : "none",
        onlyInLocal:
          keyDifferences.indexedDB.onlyInLocal.length > 0
            ? keyDifferences.indexedDB.onlyInLocal
            : "none",
        totalCloud: cloudIndexedDBKeys.size,
        totalLocal: currentIndexedDBKeys.size,
      },
    });

    const currentDataStr = JSON.stringify(currentData);
    localFileSize = new Blob([currentDataStr]).size;
    const sizeDiffPercentage =
      cloudFileSize && localFileSize
        ? Math.abs(((cloudFileSize - localFileSize) / localFileSize) * 100)
        : 0;

    const shouldAlertOnSmallerCloud = getShouldAlertOnSmallerCloud();
    const TOLERANCE_BYTES = 5;
    const isCloudSignificantlySmaller =
      shouldAlertOnSmallerCloud &&
      cloudFileSize < localFileSize - TOLERANCE_BYTES;

    logToConsole("progress", "Size comparison:", {
      cloudSize: `${cloudFileSize} bytes`,
      localSize: `${localFileSize} bytes`,
      difference: `${cloudFileSize - localFileSize} bytes${
        sizeDiffPercentage ? ` (${sizeDiffPercentage.toFixed(4)}%)` : ""
      }`,
      isCloudSmaller: isCloudSignificantlySmaller,
      tolerance: `${TOLERANCE_BYTES} bytes`,
    });

    const shouldPrompt =
      (localFileSize > 0 && sizeDiffPercentage > getImportThreshold()) ||
      isCloudSignificantlySmaller;

    if (shouldPrompt) {
      try {
        isWaitingForUserInput = true;
        logToConsole("info", `Showing prompt to user...`);
        const existingIntervals = [backupInterval];
        existingIntervals.forEach((interval) => {
          if (interval) {
            logToConsole("pause", `Clearing backupinterval ${interval}`);
            clearInterval(interval);
          }
        });
        backupInterval = null;
        backupIntervalRunning = false;
        localStorage.setItem("activeTabBackupRunning", "false");

        let message = `Cloud backup size: ${
          cloudFileSize || "Unknown"
        } bytes\n`;
        message += `Local data size: ${localFileSize} bytes\n`;
        if (cloudFileSize) {
          message += `Size difference: ${sizeDiffPercentage.toFixed(2)}%\n\n`;
        }
        if (cloudFileSize && sizeDiffPercentage > getImportThreshold()) {
          message += `⚠️ Size difference exceeds ${getImportThreshold()}%\n`;
        }
        if (isCloudSignificantlySmaller) {
          message += "⚠️ Warning: Cloud backup is smaller than local data\n";
        }
        message +=
          '\nDo you want to proceed with importing the cloud backup? Clicking "Proceed" will overwrite your local data. If you "Cancel", the local data will overwrite the cloud backup.';

        const shouldProceed = await showCustomAlert(
          message,
          "Confirmation required",
          [
            { text: "Cancel", primary: false },
            { text: "Proceed", primary: true },
          ]
        );

        if (!shouldProceed) {
          logToConsole("info", `Import cancelled by user`);
          isWaitingForUserInput = false;

          // Add this line to restart the backup interval when import is cancelled
          startBackupInterval();

          return false;
        }
      } catch (error) {
        logToConsole("error", "Error during import prompt:", error);
        throw error;
      } finally {
        isWaitingForUserInput = false;
      }
    }
    logToConsole("info", `Fetching data from S3...`);
    logToConsole("info", `S3 getObject params:`, {
      bucket: bucketName,
      key: params.Key,
    });
    let data;
    try {
      data = await s3.getObject(params).promise();
      logToConsole("success", "S3 data fetched successfully:", {
        contentLength: data.Body?.length || 0,
      });
    } catch (fetchError) {
      logToConsole("error", `Failed to fetch from S3:`, fetchError);
      throw fetchError;
    }
    const encryptedContent = new Uint8Array(data.Body);
    try {
      logToConsole("encrypt", `Starting decryption...`);
      importedData = await decryptData(encryptedContent);
      logToConsole("success", `Decryption successful`);
    } catch (error) {
      logToConsole("error", `Decryption failed:`, error);
      throw new Error(
        "Failed to decrypt backup. Please check your encryption key."
      );
    }
    importDataToStorage(importedData);
    const currentTime = new Date().toLocaleString();
    var element = document.getElementById("last-sync-msg");
    if (element !== null) {
      element.innerText = `Last sync done at ${currentTime}`;
    }
    logToConsole("success", `Import completed successfully`);
    wasImportSuccessful = true;
    lastImportStatus = "success";
    lastImportTime = Date.now();
    return true;
  } catch (error) {
    lastImportStatus = "failed";
    lastImportTime = null;
    resetSizes();
    updateSyncStatus();
    logToConsole("error", `Import failed with error:`, error);

    // Also ensure backup interval is restarted on error
    if (!backupIntervalRunning) {
      startBackupInterval();
    }

    throw error;
  } finally {
    isImportInProgress = false;
    updateSyncStatus();
  }
}

async function backupToS3() {
  if (isExportInProgress) {
    logToConsole("skip", "Export already in progress, queueing this export");
    queueCloudOperation("export", backupToS3);
    return;
  }

  isExportInProgress = true;
  let data = null;
  let dataStr = null;
  let blob = null;

  try {
    lastExportStatus = "in-progress";
    updateSyncStatus();
    logToConsole("start", "Starting export to S3...");
    const bucketName = localStorage.getItem("aws-bucket");
    const awsRegion = localStorage.getItem("aws-region");
    const awsAccessKey = localStorage.getItem("aws-access-key");
    const awsSecretKey = localStorage.getItem("aws-secret-key");
    const awsEndpoint = localStorage.getItem("aws-endpoint");

    if (typeof AWS === "undefined") {
      await loadAwsSdk();
    }

    const awsConfig = {
      accessKeyId: awsAccessKey,
      secretAccessKey: awsSecretKey,
      region: awsRegion,
    };
    if (awsEndpoint) {
      awsConfig.endpoint = awsEndpoint;
    }
    AWS.config.update(awsConfig);

    const s3 = new AWS.S3();
    await cleanupIncompleteMultipartUploads(s3, bucketName);

    data = await exportBackupData();
    logToConsole("start", "Starting backup encryption");
    const encryptedData = await encryptData(data);
    blob = new Blob([encryptedData], { type: "application/octet-stream" });
    logToConsole("info", "Blob created");

    const dataSize = blob.size;
    localFileSize = dataSize;

    try {
      const currentCloudData = await s3
        .getObject({
          Bucket: bucketName,
          Key: "typingmind-backup.json",
        })
        .promise();
      cloudFileSize = currentCloudData.Body.length;
    } catch (error) {
      if (error.code !== "NoSuchKey") {
        throw error;
      }
      cloudFileSize = 0;
    }
    cloudFileSize = dataSize;
    isLocalDataModified = false;
    updateSyncStatus();

    if (dataSize < 100) {
      throw new Error("Final backup blob is too small or empty");
    }

    const localSize = dataSize;
    const sizeDiffPercentage = Math.abs(
      ((localSize - cloudFileSize) / cloudFileSize) * 100
    );

    logToConsole("progress", "Export size comparison:", {
      cloudSize: `${cloudFileSize} bytes`,
      localSize: `${localSize} bytes`,
      difference: `${
        localSize - cloudFileSize
      } bytes (${sizeDiffPercentage.toFixed(4)}%)`,
    });

    if (sizeDiffPercentage > getExportThreshold()) {
      isWaitingForUserInput = true;
      const message = `Warning: The new backup size (${localSize} bytes) differs significantly from the current cloud backup (${cloudFileSize} bytes) by ${sizeDiffPercentage.toFixed(
        2
      )}% (threshold: ${getExportThreshold()}%).\n\nDo you want to proceed with the upload?`;
      const shouldProceed = await showCustomAlert(
        message,
        "Size Difference Warning",
        [
          { text: "Cancel", primary: false },
          { text: "Proceed", primary: true },
        ]
      );
      isWaitingForUserInput = false;
      if (!shouldProceed) {
        logToConsole("info", "Export cancelled due to size difference");
        throw new Error("Export cancelled due to significant size difference");
      }
    }

    if (dataSize > 5 * 1024 * 1024) {
      try {
        logToConsole(
          "start",
          `Starting multipart upload for file size: ${dataSize} bytes`
        );
        const createMultipartParams = {
          Bucket: bucketName,
          Key: "typingmind-backup.json",
          ContentType: "application/json",
          ServerSideEncryption: "AES256",
        };
        const multipart = await s3
          .createMultipartUpload(createMultipartParams)
          .promise();
        logToConsole(
          "success",
          `Created multipart upload with ID: ${multipart.UploadId}`
        );

        const uploadedParts = [];
        let partNumber = 1;
        const totalParts = Math.ceil(dataSize / (5 * 1024 * 1024));

        for (let start = 0; start < dataSize; start += 5 * 1024 * 1024) {
          const end = Math.min(start + 5 * 1024 * 1024, dataSize);
          const chunk = blob.slice(start, end);
          logToConsole(
            "info",
            `Processing part ${partNumber}/${totalParts} (${chunk.size} bytes)`
          );

          let uploadSuccess = false;
          let lastError = null;
          let retryCount = 0;
          const maxRetries = 3;
          const baseDelay = 2000;

          while (!uploadSuccess && retryCount < maxRetries) {
            try {
              logToConsole(
                "upload",
                `Uploading part ${partNumber}/${totalParts} (attempt ${
                  retryCount + 1
                }/${maxRetries})`
              );

              const arrayBuffer = await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(reader.result);
                reader.onerror = () => reject(reader.error);
                reader.readAsArrayBuffer(chunk);
              });

              const partParams = {
                Body: arrayBuffer,
                Bucket: bucketName,
                Key: "typingmind-backup.json",
                PartNumber: partNumber,
                UploadId: multipart.UploadId,
              };

              const uploadResult = await s3.uploadPart(partParams).promise();
              logToConsole(
                "success",
                `Successfully uploaded part ${partNumber}/${totalParts} (ETag: ${uploadResult.ETag})`
              );

              uploadedParts.push({
                ETag: uploadResult.ETag,
                PartNumber: partNumber,
              });
              uploadSuccess = true;
            } catch (error) {
              lastError = error;
              retryCount++;
              logToConsole(
                "error",
                `Error uploading part ${partNumber}/${totalParts} (attempt ${retryCount}):`,
                error
              );

              if (retryCount === maxRetries) {
                logToConsole(
                  "error",
                  `All retries failed for part ${partNumber}, aborting multipart upload`
                );
                try {
                  await s3
                    .abortMultipartUpload({
                      Bucket: bucketName,
                      Key: "typingmind-backup.json",
                      UploadId: multipart.UploadId,
                    })
                    .promise();
                  logToConsole("info", "Multipart upload aborted successfully");
                } catch (abortError) {
                  logToConsole(
                    "error",
                    "Error aborting multipart upload:",
                    abortError
                  );
                }
                throw new Error(
                  `Failed to upload part ${partNumber} after ${maxRetries} attempts: ${lastError.message}`
                );
              }

              const delay = Math.min(
                baseDelay * Math.pow(2, retryCount) + Math.random() * 1000,
                30000
              );
              logToConsole(
                "info",
                `Retrying part ${partNumber} in ${Math.round(
                  delay / 1000
                )} seconds`
              );
              await new Promise((resolve) => setTimeout(resolve, delay));
            }
          }

          partNumber++;
          const progress = Math.round(
            ((start + 5 * 1024 * 1024) / dataSize) * 100
          );
          logToConsole(
            "progress",
            `Overall upload progress: ${Math.min(progress, 100)}%`
          );
        }

        logToConsole(
          "success",
          `All parts uploaded, completing multipart upload`
        );
        const sortedParts = uploadedParts.sort(
          (a, b) => a.PartNumber - b.PartNumber
        );
        logToConsole("success", `Sorted parts for completion:`, sortedParts);

        const completeParams = {
          Bucket: bucketName,
          Key: "typingmind-backup.json",
          UploadId: multipart.UploadId,
          MultipartUpload: {
            Parts: sortedParts.map((part) => ({
              ETag: part.ETag,
              PartNumber: part.PartNumber,
            })),
          },
        };

        logToConsole(
          "info",
          `Complete multipart upload params:`,
          JSON.stringify(completeParams, null, 2)
        );

        try {
          logToConsole("info", `Sending complete multipart upload request`);
          const completeResult = await s3
            .completeMultipartUpload(completeParams)
            .promise();
          logToConsole(
            "info",
            `Complete multipart upload response:`,
            completeResult
          );

          logToConsole("success", `Multipart upload completed successfully`);
        } catch (completeError) {
          logToConsole("error", "Complete multipart upload failed:", {
            error: completeError,
            params: completeParams,
            uploadId: multipart.UploadId,
            partsCount: sortedParts.length,
            firstPart: sortedParts[0],
            lastPart: sortedParts[sortedParts.length - 1],
          });
          throw completeError;
        }
      } catch (error) {
        logToConsole("error", `Multipart upload failed with error:`, error);
        await cleanupIncompleteMultipartUploads(s3, bucketName);
        logToConsole("info", "Falling back to standard upload...");
        await s3
          .putObject({
            Bucket: bucketName,
            Key: "typingmind-backup.json",
            Body: encryptedData,
            ContentType: "application/json",
            ServerSideEncryption: "AES256",
          })
          .promise();

        logToConsole("success", `Multipart upload completed successfully`);
      }
    } else {
      logToConsole("start", "Starting standard upload to S3");
      await s3
        .putObject({
          Bucket: bucketName,
          Key: "typingmind-backup.json",
          Body: encryptedData,
          ContentType: "application/json",
          ServerSideEncryption: "AES256",
        })
        .promise();

      logToConsole("success", `Multipart upload completed successfully`);
    }

    await handleTimeBasedBackup();
    const currentTime = new Date().toLocaleString();
    localStorage.setItem("last-cloud-sync", currentTime);

    lastExportStatus = "success";
    lastExportTime = Date.now();

    const element = document.getElementById("last-sync-msg");
    if (element) {
      element.innerText = `Last sync done at ${currentTime}`;
    }

    if (document.querySelector('[data-element-id="sync-modal-dbbackup"]')) {
      await loadBackupFiles();
    }

    logToConsole("success", "Export completed successfully");

    // --- DÉBUT DU BLOC MODIFIÉ PAR L'IA (Étape 1) ---
    try {
        logToConsole("info", "Updating sync-manifest.json...");

        const s3 = new AWS.S3();
        
        const manifest = {
            last_sync_utc: new Date().toISOString()
        };

        const manifestParams = {
            Bucket: bucketName,
            Key: 'sync-manifest.json',
            Body: JSON.stringify(manifest, null, 2),
            ContentType: 'application/json'
        };

        await s3.putObject(manifestParams).promise();

        logToConsole("success", "sync-manifest.json updated successfully.");

    } catch (manifestError) {
        logToConsole("error", "Failed to update sync-manifest.json", manifestError);
    }
    
    return true;
    // --- FIN DU BLOC MODIFIÉ PAR L'IA (Étape 1) ---
    
  } catch (error) {
    lastExportStatus = "failed";
    lastExportTime = null;
    updateSyncStatus();
    logToConsole("error", "Export failed:", error);
    throw error;
  } finally {
    data = null;
    dataStr = null;
    blob = null;
    isExportInProgress = false;
    updateSyncStatus();
  }
}

setInterval(updateSyncStatus, 1000);

(async function checkDOMOrRunBackup() {
  initializeLoggingState();
  await awsSdkPromise;
  createSyncStatus();
  if (document.readyState !== "loading") {
    await handleDOMReady();
  } else {
    window.addEventListener("DOMContentLoaded", handleDOMReady);
  }
})();

async function handleDOMReady() {
  window.removeEventListener("DOMContentLoaded", handleDOMReady);
  isPageFullyLoaded = true;
  const bucketName = localStorage.getItem("aws-bucket");
  const awsAccessKey = localStorage.getItem("aws-access-key");
  const awsSecretKey = localStorage.getItem("aws-secret-key");

  if (!bucketName || !awsAccessKey || !awsSecretKey) {
    logToConsole("info", "Backup not configured, skipping initialization");
    return;
  }

  const encryptionKey = localStorage.getItem("encryption-key");
  try {
    if (localStorage.getItem("sync-mode") === "backup") {
      logToConsole(
        "info",
        "Running in backup mode - skipping automatic import"
      );
      wasImportSuccessful = true;
      startBackupInterval();
      return;
    }

    var importSuccessful = await checkAndImportBackup();
    isPageFullyLoaded = true;
    if (importSuccessful) {
      const storedSuffix = localStorage.getItem("last-daily-backup-in-s3");
      const today = new Date();
      const currentDateSuffix = `${today.getFullYear()}${String(
        today.getMonth() + 1
      ).padStart(2, "0")}${String(today.getDate()).padStart(2, "0")}`;

      if (!storedSuffix || currentDateSuffix > storedSuffix) {
        await handleBackupFiles();
      }
      wasImportSuccessful = true;
      startBackupInterval();
    } else {
      wasImportSuccessful = true;
      startBackupInterval();
    }
  } catch (error) {
    logToConsole("error", "Failed to initialize backup:", error);
    isPageFullyLoaded = true;
    if (error.code === "NoSuchKey") {
      wasImportSuccessful = true;
      logToConsole(
        "start",
        "No existing backup found in S3 - starting fresh backup"
      );
      startBackupInterval();
    } else if (
      error.code === "CredentialsError" ||
      error.code === "InvalidAccessKeyId"
    ) {
      logToConsole("error", "AWS credential error, not starting backup");
    } else {
      logToConsole(
        "error",
        `Unknown error during import, not starting backup. Error: ${error.message}`
      );
    }
    return;
  }
}

const cloudSyncBtn = document.createElement("button");
cloudSyncBtn.setAttribute("data-element-id", "cloud-sync-button");
cloudSyncBtn.className =
  "cursor-default group flex items-center justify-center p-1 text-sm font-medium flex-col group focus:outline-0 focus:text-white text-white/70";
const cloudIconSVG = `
<svg class="w-6 h-6 flex-shrink-0" width="24px" height="24px" fill="none" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
    <path fill-rule="evenodd" clip-rule="evenodd" d="M19 9.76c-.12-3.13-2.68-5.64-5.83-5.64-2.59 0-4.77 1.68-5.53 4.01-.19-.03-.39-.04-.57-.04-2.45 0-4.44 1.99-4.44 4.44 0 2.45 1.99 4.44 4.44 4.44h11.93c2.03 0 3.67-1.64 3.67-3.67 0-1.95-1.52-3.55-3.44-3.65zm-5.83-3.64c2.15 0 3.93 1.6 4.21 3.68l.12.88.88.08c1.12.11 1.99 1.05 1.99 2.19 0 1.21-.99 2.2-2.2 2.2H7.07c-1.64 0-2.97-1.33-2.97-2.97 0-1.64 1.33-2.97 2.97-2.97.36 0 .72.07 1.05.2l.8.32.33-.8c.59-1.39 1.95-2.28 3.45-2.28z" fill="currentColor"></path>
    <path fill-rule="evenodd" clip-rule="evenodd" d="M12 15.33v-5.33M9.67 12.33L12 14.67l2.33-2.34" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"></path>
</svg>
`;
const textSpan = document.createElement("span");
textSpan.className =
  "font-normal self-stretch text-center text-xs leading-4 md:leading-none";
textSpan.innerText = "Backup";
const iconSpan = document.createElement("span");
iconSpan.className =
  "block group-hover:bg-white/30 w-[35px] h-[35px] transition-all rounded-lg flex items-center justify-center group-hover:text-white/90";
iconSpan.innerHTML = cloudIconSVG;
cloudSyncBtn.appendChild(iconSpan);
cloudSyncBtn.appendChild(textSpan);

function insertCloudSyncButton() {
  const teamsButton = document.querySelector(
    '[data-element-id="workspace-tab-teams"]'
  );

  if (teamsButton && teamsButton.parentNode) {
    teamsButton.parentNode.insertBefore(cloudSyncBtn, teamsButton.nextSibling);
    return true;
  }
  return false;
}

const observer = new MutationObserver((mutations) => {
  if (insertCloudSyncButton()) {
    observer.disconnect();
  }
});

observer.observe(document.body, {
  childList: true,
  subtree: true,
});

const maxAttempts = 10;
let attempts = 0;
const interval = setInterval(() => {
  if (insertCloudSyncButton() || attempts >= maxAttempts) {
    clearInterval(interval);
  }
  attempts++;
}, 1000);

cloudSyncBtn.addEventListener("click", function () {
  openSyncModal();
});

let lastBackupTime = 0;

function openSyncModal() {
  var existingModal = document.querySelector(
    'div[data-element-id="sync-modal-dbbackup"]'
  );
  if (existingModal) {
    return;
  }
  var modalPopup = document.createElement("div");
  modalPopup.style.cssText =
    "padding-left: 10px; padding-right: 10px; overflow-y: auto;";
  modalPopup.setAttribute("data-element-id", "sync-modal-dbbackup");
  modalPopup.className =
    "bg-opacity-75 fixed inset-0 bg-gray-800 transition-all flex items-start justify-center z-[60] p-4 overflow-y-auto";
  modalPopup.innerHTML = `
        <div class="inline-block w-full align-bottom bg-white dark:bg-zinc-950 rounded-lg px-4 pb-4 text-left shadow-xl transform transition-all sm:my-8 sm:p-6 sm:align-middle pt-4 overflow-hidden sm:max-w-lg mt-4">
            <div class="text-gray-800 dark:text-white text-left text-sm">
                <div class="flex justify-center items-center mb-3">
                    <h3 class="text-center text-xl font-bold">Backup & Sync</h3>
                    <button class="ml-2 text-blue-600 text-lg hint--bottom-left hint--rounded hint--large" 
                        aria-label="Fill form & Save. If you are using Amazon S3 - fill in S3 Bucket Name, AWS Region, AWS Access Key, AWS Secret Key and Encryption key.&#10;&#10;Initial backup: You will need to click on Export to create your first backup in S3. Thereafter, automatic backups are done to S3 as per Backup Interval if the browser tab is active.&#10;&#10;Restore backup: If S3 already has an existing backup, this extension will automatically pick it and restore the local data.&#10;&#10;Adhoc Backup & Restore: Use the Export and Import to perform on-demand backup or restore. Note that this overwrites the main backup/local data.&#10;&#10;Snapshot: Creates an instant no-touch backup that will not be overwritten.&#10;&#10;Download: You can select the backup data to be download and click on Download button to download it for local storage.&#10;&#10;Restore: Select the backup you want to restore and Click on Restore. The typingmind data will be restored to the selected backup data/date.">ⓘ</button>
                </div>
                <div class="space-y-3">
                    <div>
                        <div class="mt-4 bg-gray-100 px-3 py-2 rounded-lg border border-gray-200 dark:bg-zinc-800 dark:border-gray-600">
                            <div class="flex items-center justify-between mb-1">
                                <label class="block text-sm font-medium text-gray-700 dark:text-gray-400">Available Backups</label>
                                <button id="refresh-backups-btn" class="text-sm text-blue-600 hover:text-blue-800 disabled:opacity-50" disabled>
                                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path>
                                    </svg>
                                </button>
                            </div>
                            <div class="space-y-2">
                                <div class="w-full">
                                    <select id="backup-files" class="w-full px-2 py-1.5 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm dark:bg-zinc-700">
                                        <option value="">Please configure AWS credentials first</option>
                                    </select>
                                </div>
                                <div class="flex justify-end space-x-2">
                                    <button id="download-backup-btn" class="z-1 px-2 py-1.5 text-sm text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed" disabled>
                                        Download
                                    </button>
                                    <button id="restore-backup-btn" class="z-1 px-2 py-1.5 text-sm text-white bg-green-600 rounded-md hover:bg-green-700 disabled:bg-gray-400 disabled:cursor-not-allowed" disabled>
                                        Restore
                                    </button>
                                    <button id="delete-backup-btn" class="z-1 px-2 py-1.5 text-sm text-white bg-red-600 rounded-md hover:bg-red-700 disabled:bg-gray-400 disabled:cursor-not-allowed" disabled>
                                        Delete
                                    </button>
                                </div>
                            </div>
                        </div>
                        <div class="mt-4 bg-gray-100 px-3 py-2 rounded-lg border border-gray-200 dark:bg-zinc-800 dark:border-gray-600">
                            <div class="space-y-2">
                                <div class="flex items-center space-x-4 mb-4">
                                    <label class="text-sm font-medium text-gray-700 dark:text-gray-400">Mode:</label>
                                    <label class="inline-flex items-center">
                                        <input type="radio" name="sync-mode" value="sync" class="form-radio text-blue-600" ${
                                          localStorage.getItem("sync-mode") !==
                                          "backup"
                                            ? "checked"
                                            : ""
                                        }>
                                        <span class="ml-2">Sync</span>
                                        <button class="ml-1 text-blue-600 text-lg hint--top-right hint--rounded hint--medium" aria-label="Automatically syncs data between devices. When enabled, data will be imported from cloud on app start.">ⓘ</button>
                                    </label>
                                    <label class="inline-flex items-center">
                                        <input type="radio" name="sync-mode" value="backup" class="form-radio text-blue-600" ${
                                          localStorage.getItem("sync-mode") ===
                                          "backup"
                                            ? "checked"
                                            : ""
                                        }>
                                        <span class="ml-2">Backup</span>
                                        <button class="ml-1 text-blue-600 text-lg hint--top-left hint--rounded hint--medium" aria-label="Only creates backups. No automatic import from cloud on app start. Use Import button to manually restore data.">ⓘ</button>
                                    </label>
                                </div>
                                <div class="flex space-x-4">
                                    <div class="w-2/3">
                                        <label for="aws-bucket" class="block text-sm font-medium text-gray-700 dark:text-gray-400">Bucket Name <span class="text-red-500">*</span></label>
                                        <input id="aws-bucket" name="aws-bucket" type="text" class="z-1 w-full px-2 py-1.5 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm dark:bg-zinc-700" autocomplete="off" required>
                                    </div>
                                    <div class="w-1/3">
                                        <label for="aws-region" class="block text-sm font-medium text-gray-700 dark:text-gray-400">Region <span class="text-red-500">*</span></label>
                                        <input id="aws-region" name="aws-region" type="text" class="z-1 w-full px-2 py-1.5 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm dark:bg-zinc-700" autocomplete="off" required>
                                    </div>
                                </div>
                                <div>
                                    <label for="aws-access-key" class="block text-sm font-medium text-gray-700 dark:text-gray-400">Access Key <span class="text-red-500">*</span></label>
                                    <input id="aws-access-key" name="aws-access-key" type="password" class="z-1 w-full px-2 py-1.5 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm dark:bg-zinc-700" autocomplete="off" required>
                                </div>
                                <div>
                                    <label for="aws-secret-key" class="block text-sm font-medium text-gray-700 dark:text-gray-400">Secret Key <span class="text-red-500">*</span></label>
                                    <input id="aws-secret-key" name="aws-secret-key" type="password" class="z-1 w-full px-2 py-1.5 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm dark:bg-zinc-700" autocomplete="off" required>
                                </div>
                                <div>
                                    <label for="aws-endpoint" class="block text-sm font-medium text-gray-700 dark:text-gray-400">
                                        S3 Compatible Storage Endpoint
                                        <button class="ml-1 text-blue-600 text-lg hint--top hint--rounded hint--medium" aria-label="For Amazon AWS, leave this blank. For S3 compatible cloud services like Cloudflare, iDrive and the likes, populate this.">ⓘ</button>
                                    </label>
                                    <input id="aws-endpoint" name="aws-endpoint" type="text" class="z-1 w-full px-2 py-1.5 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm dark:bg-zinc-700" autocomplete="off">
                                </div>
                                <div class="flex space-x-4">
                                    <div class="w-1/2">
                                        <label for="backup-interval" class="block text-sm font-medium text-gray-700 dark:text-gray-400">Backup Interval
                                        <button class="ml-1 text-blue-600 text-lg hint--top-right hint--rounded hint--medium" aria-label="How often do you want to backup your data to cloud? Minimum 15 seconds, Default: 60 seconds">ⓘ</button></label>
                                        <input id="backup-interval" name="backup-interval" type="number" min="30" placeholder="Default: 60" class="z-1 w-full px-2 py-1.5 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm dark:bg-zinc-700" autocomplete="off" required>
                                    </div>
                                    <div class="w-1/2">
                                        <label for="encryption-key" class="block text-sm font-medium text-gray-700 dark:text-gray-400">
                                            Encryption Key <span class="text-red-500">*</span>
                                            <button class="ml-1 text-blue-600 text-lg hint--top-left hint--rounded hint--medium" aria-label="Choose a secure 8+ character string. This is to encrypt the backup file before uploading to cloud. Securely store this somewhere as you will need this to restore backup from cloud.">ⓘ</button>
                                        </label>
                                        <input id="encryption-key" name="encryption-key" type="password" class="z-1 w-full px-2 py-1.5 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm dark:bg-zinc-700" autocomplete="off" required>
                                    </div>
                                </div>
                                <div class="mt-2 bg-gray-100 px-3 py-2 rounded-lg border border-gray-200 dark:bg-zinc-800 dark:border-gray-600">
                                    <label class="block text-sm font-medium text-gray-700 dark:text-gray-400">
                                        Backup Size Safety Check
                                        <button class="ml-1 text-blue-600 text-lg hint--top hint--rounded hint--large" aria-label="This is to prevent unintentional corruption of app data. When exporting, the local data size and the cloud data size is compared and if the difference percentage exceeds the configured threshold, you are asked to provide a confirmation before the cloud data is overwritten. If you feel this is a mistake and cloud data should not be overwritten, click on Cancel else click on Proceed. Similarly while importing, the cloud data size and local data size is compared and if the difference percentage exceeds the configured threshold, you are asked to provide a confirmation before the local data is overwritten. If you feel your local data is more recent and should not be overwritten, click on Cancel else click on Proceed.">ⓘ</button>
                                    </label>
                                    <div class="mt-1 flex space-x-4">
                                        <div class="w-1/2">
                                            <label for="import-threshold" class="block text-sm font-medium text-gray-700 dark:text-gray-400">Import (%)</label>
                                            <input id="import-threshold" name="import-threshold" type="number" step="0.1" min="0" placeholder="Default: 1" class="z-1 w-full px-2 py-1.5 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm dark:bg-zinc-700" autocomplete="off">
                                        </div>
                                        <div class="w-1/2">
                                            <label for="export-threshold" class="block text-sm font-medium text-gray-700 dark:text-gray-400">Export (%)</label>
                                            <input id="export-threshold" name="export-threshold" type="number" step="0.1" min="0" placeholder="Default: 10" class="z-1 w-full px-2 py-1.5 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm dark:bg-zinc-700" autocomplete="off">
                                        </div>
                                    </div>
                                    <div class="mt-2 flex items-center">
                                        <input type="checkbox" id="alert-smaller-cloud" class="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded">
                                        <label for="alert-smaller-cloud" class="ml-2 block text-sm text-gray-700 dark:text-gray-400">
                                            Alert if cloud backup is smaller during import
                                        </label>
                                    </div>
                                </div>
                                <div class="flex justify-between space-x-2">
                                    <button id="save-aws-details-btn" type="button" class="z-1 inline-flex items-center px-3 py-1.5 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:bg-gray-400 disabled:cursor-default transition-colors" disabled>
                                        Save
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                     <div class="flex items-center justify-end mb-4 space-x-2">
                         <span class="text-sm text-gray-600 dark:text-gray-400">
                             Console Logging
                             <button class="ml-1 text-blue-600 text-lg hint--top-left hint--rounded hint--medium" aria-label="Use this to enable detailed logging in Browser console for troubleshooting purpose. Clicking on this button will instantly start logging. However, earlier events will not be logged. You could add ?log=true to the page URL and reload the page to start logging from the beginning of the page load.">ⓘ</button>
                         </span>
                         <input type="checkbox" id="console-logging-toggle" class="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded cursor-pointer">
                     </div>
                    <div class="flex justify-between space-x-2 mt-4">
                        <button id="export-to-s3-btn" type="button" class="z-1 inline-flex items-center px-2 py-1 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:bg-gray-400 disabled:cursor-default transition-colors" disabled>
                            <svg stroke="currentColor" fill="currentColor" stroke-width="0" viewBox="0 0 1024 1024" fill-rule="evenodd" class="w-4 h-4 mr-2" height="1em" width="1em" xmlns="http://www.w3.org/2000/svg">
                                <path d="M880 112H144c-17.7 0-32 14.3-32 32v736c0 17.7 14.3 32 32 32h360c4.4 0 8-3.6 8-8v-56c0-4.4-3.6-8-8-8H184V184h656v320c0 4.4-3.6 8 8 8h56c4.4 0 8-3.6 8-8V144c0-17.7-14.3-32-32-32ZM770.87 824.869l-52.2 52.2c-4.7 4.7-1.9 12.8 4.7 13.6l179.4 21c5.1.6 9.5-3.7 8.9-8.9l-21-179.4c-.8-6.6-8.9-9.4-13.6-4.7l-52.4 52.4-256.2-256.2c-3.1-3.1-8.2-3.1-11.3 0l-42.4 42.4c-3.1 3.1-3.1 8.2 0 11.3l256.1 256.3Z"></path>
                            </svg><span>Export</span>
                        </button>
                        <button id="import-from-s3-btn" type="button" class="z-1 inline-flex items-center px-2 py-1 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:bg-gray-400 disabled:cursor-default transition-colors" disabled>
                            <svg stroke="currentColor" fill="currentColor" stroke-width="0" viewBox="0 0 1024 1024" fill-rule="evenodd" class="w-4 h-4 mr-2" height="1em" width="1em" xmlns="http://www.w3.org/2000/svg">
                                <path d="M880 112H144c-17.7 0-32 14.3-32 32v736c0 17.7 14.3 32 32 32h360c4.4 0 8-3.6 8-8v-56c0-4.4-3.6-8-8-8H184V184h656v320c0 4.4-3.6 8 8 8h56c4.4 0 8-3.6 8-8V144c0-17.7-14.3-32-32-32ZM653.3 599.4l52.2-52.2c4.7-4.7 1.9-12.8-4.7-13.6l-179.4-21c-5.1-.6-9.5 3.7-8.9 8.9l21 179.4c.8 6.6 8.9 9.4 13.6 4.7l52.4-52.4 256.2 256.2c3.1 3.1 8.2 3.1 11.3 0l42.4-42.4c3.1-3.1 3.1-8.2 0-11.3L653.3 599.4Z"></path>
                            </svg><span>Import</span>
                        </button>
                        <button id="snapshot-btn" type="button" class="z-1 inline-flex items-center px-2 py-1 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:bg-gray-400 disabled:cursor-default transition-colors" disabled>
				<svg stroke="currentColor" fill="currentColor" stroke-width="0" viewBox="0 0 16 16" class="w-4 h-4 mr-2" height="1em" width="1em" xmlns="http://www.w3.org/2000/svg">
				    <path d="M15 12a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h1.172a3 3 0 0 0 2.12-.879l.83-.828A1 1 0 0 1 6.827 3h2.344a1 1 0 0 1 .707.293l.828.828A3 3 0 0 0 12.828 5H14a1 1 0 0 1 1 1v6zM2 4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-1.172a2 2 0 0 1-1.414-.586l-.828-.828A2 2 0 0 0 9.172 2H6.828a2 2 0 0 0-1.414.586l-.828.828A2 2 0 0 1 3.172 4H2z"/>
				    <path d="M8 11a2.5 2.5 0 1 1 0-5 2.5 2.5 0 0 1 0 5zm0 1a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM3 6.5a.5.5 0 1 1-1 0 .5.5 0 0 1 1 0z"/>
				</svg><span>Snapshot</span>
			</button>
        		<button id="close-modal-btn" type="button" class="z-1 inline-flex items-center px-2 py-1 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-red-600 hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500">
        			<span>Close</span>
    			</button>
    		</div>
	        <div class="text-center mt-4">
		    <span id="last-sync-msg"></span>
	        </div>
	        <div id="action-msg" class="text-center"></div>
	    </div>
	</div>
</div>`;
  document.body.appendChild(modalPopup);
  loadBackupFiles();

  const awsBucketInput = document.getElementById("aws-bucket");
  const awsRegionInput = document.getElementById("aws-region");
  const awsAccessKeyInput = document.getElementById("aws-access-key");
  const awsSecretKeyInput = document.getElementById("aws-secret-key");
  const awsEndpointInput = document.getElementById("aws-endpoint");
  const backupIntervalInput = document.getElementById("backup-interval");
  const encryptionKeyInput = document.getElementById("encryption-key");
  const importThresholdInput = document.getElementById("import-threshold");
  const exportThresholdInput = document.getElementById("export-threshold");
  const closeButton = document.getElementById("close-modal-btn");

  const savedBucket = localStorage.getItem("aws-bucket");
  const savedRegion = localStorage.getItem("aws-region");
  const savedAccessKey = localStorage.getItem("aws-access-key");
  const savedSecretKey = localStorage.getItem("aws-secret-key");
  const savedEndpoint = localStorage.getItem("aws-endpoint");
  const lastSync = localStorage.getItem("last-cloud-sync");
  const savedInterval = localStorage.getItem("backup-interval") || "60";
  const savedEncryptionKey = localStorage.getItem("encryption-key");
  const savedImportThreshold = localStorage.getItem("import-size-threshold");
  const savedExportThreshold = localStorage.getItem("export-size-threshold");

  if (savedBucket) awsBucketInput.value = savedBucket;
  if (savedRegion) awsRegionInput.value = savedRegion;
  if (savedAccessKey) awsAccessKeyInput.value = savedAccessKey;
  if (savedSecretKey) awsSecretKeyInput.value = savedSecretKey;
  if (savedEndpoint) awsEndpointInput.value = savedEndpoint;
  if (backupIntervalInput) backupIntervalInput.value = savedInterval;
  if (savedEncryptionKey)
    document.getElementById("encryption-key").value = savedEncryptionKey;
  if (savedImportThreshold)
    document.getElementById("import-threshold").value = savedImportThreshold;
  if (savedExportThreshold)
    document.getElementById("export-threshold").value = savedExportThreshold;

  var element = document.getElementById("last-sync-msg");
  if (lastSync) {
    if (element !== null) {
      element.innerText = `Last sync done at ${lastSync}`;
      element = null;
    }
  }

  function updateButtonState() {
    const awsBucketInput = document.getElementById("aws-bucket");
    const awsRegionInput = document.getElementById("aws-region");
    const awsAccessKeyInput = document.getElementById("aws-access-key");
    const awsSecretKeyInput = document.getElementById("aws-secret-key");
    const backupIntervalInput = document.getElementById("backup-interval");
    const encryptionKeyInput = document.getElementById("encryption-key");
    const importThresholdInput = document.getElementById("import-threshold");
    const exportThresholdInput = document.getElementById("export-threshold");

    const hasRequiredFields =
      awsBucketInput?.value?.trim() &&
      awsRegionInput?.value?.trim() &&
      awsAccessKeyInput?.value?.trim() &&
      awsSecretKeyInput?.value?.trim() &&
      backupIntervalInput?.value &&
      parseInt(backupIntervalInput.value) >= 15 &&
      encryptionKeyInput?.value?.trim().length >= 8 &&
      (!importThresholdInput?.value ||
        parseFloat(importThresholdInput.value) >= 0) &&
      (!exportThresholdInput?.value ||
        parseFloat(exportThresholdInput.value) >= 0);
    const saveButton = document.getElementById("save-aws-details-btn");
    const exportButton = document.getElementById("export-to-s3-btn");
    const importButton = document.getElementById("import-from-s3-btn");
    const snapshotButton = document.getElementById("snapshot-btn");

    if (saveButton) saveButton.disabled = !hasRequiredFields;
    if (exportButton) exportButton.disabled = !hasRequiredFields;
    if (importButton) importButton.disabled = !hasRequiredFields;
    if (snapshotButton) snapshotButton.disabled = !hasRequiredFields;
  }

  modalPopup.addEventListener("click", function (event) {
    if (event.target === modalPopup) {
      modalPopup.remove();
    }
  });

  awsBucketInput.addEventListener("input", updateButtonState);
  awsRegionInput.addEventListener("input", updateButtonState);
  awsAccessKeyInput.addEventListener("input", updateButtonState);
  awsSecretKeyInput.addEventListener("input", updateButtonState);
  awsEndpointInput.addEventListener("input", updateButtonState);
  backupIntervalInput.addEventListener("input", updateButtonState);
  encryptionKeyInput.addEventListener("input", updateButtonState);
  importThresholdInput.addEventListener("input", updateButtonState);
  exportThresholdInput.addEventListener("input", updateButtonState);

  updateButtonState();

  document
    .getElementById("backup-files")
    .addEventListener("change", updateBackupButtons);
  document
    .getElementById("download-backup-btn")
    .addEventListener("click", downloadBackupFile);
  document
    .getElementById("restore-backup-btn")
    .addEventListener("click", restoreBackupFile);
  document
    .getElementById("refresh-backups-btn")
    .addEventListener("click", loadBackupFiles);
  document
    .getElementById("delete-backup-btn")
    .addEventListener("click", deleteBackupFile);

  document
    .getElementById("save-aws-details-btn")
    .addEventListener("click", async function () {
      let extensionURLs = JSON.parse(
        localStorage.getItem("TM_useExtensionURLs") || "[]"
      );
      if (!extensionURLs.some((url) => url.endsWith("s3.js"))) {
        extensionURLs.push(
          "https://itcon-pty-au.github.io/typingmind-cloud-backup/s3.js"
        );
        localStorage.setItem(
          "TM_useExtensionURLs",
          JSON.stringify(extensionURLs)
        );
      }
      const bucketName = awsBucketInput.value.trim();
      const region = awsRegionInput.value.trim();
      const accessKey = awsAccessKeyInput.value.trim();
      const secretKey = awsSecretKeyInput.value.trim();
      const endpoint = awsEndpointInput.value.trim();
      const backupInterval = document.getElementById("backup-interval").value;
      const encryptionKey = document
        .getElementById("encryption-key")
        .value.trim();
      const importThreshold = document.getElementById("import-threshold").value;
      const exportThreshold = document.getElementById("export-threshold").value;
      const selectedMode = document.querySelector(
        'input[name="sync-mode"]:checked'
      ).value;

      if (importThreshold) {
        localStorage.setItem("import-size-threshold", importThreshold);
      }
      if (exportThreshold) {
        localStorage.setItem("export-size-threshold", exportThreshold);
      }

      if (backupInterval < 15) {
        alert("Backup interval must be at least 15 seconds");
        return;
      }

      if (encryptionKey !== "") {
        if (encryptionKey.length < 8) {
          alert("Encryption key must be at least 8 characters long");
          return;
        }
        localStorage.setItem("encryption-key", encryptionKey);
      } else {
        localStorage.removeItem("encryption-key");
      }

      localStorage.setItem("aws-region", region);
      localStorage.setItem("aws-endpoint", endpoint);
      localStorage.setItem("sync-mode", selectedMode);

      try {
        await validateAwsCredentials(bucketName, accessKey, secretKey);
        localStorage.setItem("backup-interval", backupInterval);
        localStorage.setItem("aws-bucket", bucketName);
        localStorage.setItem("aws-access-key", accessKey);
        localStorage.setItem("aws-secret-key", secretKey);
        const actionMsgElement = document.getElementById("action-msg");
        actionMsgElement.textContent = "AWS details saved!";
        actionMsgElement.style.color = "white";
        setTimeout(() => {
          actionMsgElement.textContent = "";
        }, 3000);
        clearInterval(backupInterval);
        backupIntervalRunning = false;
        startBackupInterval();
        updateButtonState();
        updateBackupButtons();
        await loadBackupFiles();

        if (localStorage.getItem("sync-mode") !== "backup") {
          var importSuccessful = await checkAndImportBackup();
          const currentTime = new Date().toLocaleString();
          const lastSync = localStorage.getItem("last-cloud-sync");
          var element = document.getElementById("last-sync-msg");
          if (lastSync && importSuccessful) {
            if (element !== null) {
              element.innerText = `Last sync done at ${currentTime}`;
              element = null;
            }
          }
        } else {
          wasImportSuccessful = true;
          logToConsole(
            "info",
            "Running in backup mode - skipping automatic import"
          );
        }

        startBackupInterval();
      } catch (err) {
        const actionMsgElement = document.getElementById("action-msg");
        actionMsgElement.textContent = `Invalid AWS details: ${err.message}`;
        actionMsgElement.style.color = "red";
        localStorage.setItem("aws-bucket", "");
        localStorage.setItem("aws-access-key", "");
        localStorage.setItem("aws-secret-key", "");
        clearInterval(backupInterval);
      }
    });

  document
    .getElementById("export-to-s3-btn")
    .addEventListener("click", async function () {
      if (isExportInProgress) return;
      const exportBtn = document.getElementById("export-to-s3-btn");
      exportBtn.disabled = true;
      exportBtn.style.cursor = "not-allowed";
      exportBtn.textContent = "Exporting";
      isExportInProgress = true;

      try {
        await backupToS3();
        await loadBackupFiles();
      } finally {
        isExportInProgress = false;
        exportBtn.disabled = false;
        exportBtn.style.cursor = "pointer";
        exportBtn.innerHTML =
          '<svg stroke="currentColor" fill="currentColor" stroke-width="0" viewBox="0 0 1024 1024" fill-rule="evenodd" class="w-4 h-4 mr-2" height="1em" width="1em" xmlns="http://www.w3.org/2000/svg"><path d="M880 112H144c-17.7 0-32 14.3-32 32v736c0 17.7 14.3 32 32 32h360c4.4 0 8-3.6 8-8v-56c0-4.4-3.6-8-8-8H184V184h656v320c0 4.4-3.6 8 8 8h56c4.4 0 8-3.6 8-8V144c0-17.7-14.3-32-32-32ZM770.87 824.869l-52.2 52.2c-4.7 4.7-1.9 12.8 4.7 13.6l179.4 21c5.1.6 9.5-3.7 8.9-8.9l-21-179.4c-.8-6.6-8.9-9.4-13.6-4.7l-52.4 52.4-256.2-256.2c-3.1-3.1-8.2-3.1-11.3 0l-42.4 42.4c-3.1 3.1-3.1 8.2 0 11.3l256.1 256.3Z"></path></svg><span>Export</span>';
      }
    });

  document
    .getElementById("import-from-s3-btn")
    .addEventListener("click", async function () {
      if (isImportInProgress) return;
      const importBtn = document.getElementById("import-from-s3-btn");
      importBtn.disabled = true;
      importBtn.style.cursor = "not-allowed";
      importBtn.textContent = "Importing";
      isImportInProgress = true;

      try {
        await importFromS3();
      } finally {
        isImportInProgress = false;
        importBtn.disabled = false;
        importBtn.style.cursor = "pointer";
        importBtn.innerHTML =
          '<svg stroke="currentColor" fill="currentColor" stroke-width="0" viewBox="0 0 1024 1024" fill-rule="evenodd" class="w-4 h-4 mr-2" height="1em" width="1em" xmlns="http://www.w3.org/2000/svg"><path d="M880 112H144c-17.7 0-32 14.3-32 32v736c0 17.7 14.3 32 32 32h360c4.4 0 8-3.6 8-8v-56c0-4.4-3.6-8-8-8H184V184h656v320c0 4.4-3.6 8 8 8h56c4.4 0 8-3.6 8-8V144c0-17.7-14.3-32-32-32ZM653.3 599.4l52.2-52.2c4.7-4.7 1.9-12.8-4.7-13.6l-179.4-21c-5.1-.6-9.5 3.7-8.9 8.9l21 179.4c.8 6.6 8.9 9.4 13.6 4.7l52.4-52.4 256.2 256.2c3.1 3.1 8.2 3.1 11.3 0l42.4-42.4c3.1-3.1 3.1-8.2 0-11.3L653.3 599.4Z"></path></svg><span>Import</span>';
      }
    });

  closeButton.addEventListener("click", function () {
    modalPopup.remove();
  });

  document
    .getElementById("snapshot-btn")
    .addEventListener("click", async function () {
      const snapshotBtn = document.getElementById("snapshot-btn");
      if (snapshotBtn.disabled) return;
      snapshotBtn.disabled = true;
      snapshotBtn.style.cursor = "not-allowed";
      const originalButtonContent = snapshotBtn.innerHTML;
      snapshotBtn.innerHTML = "<span>Snapshot</span>";
      try {
        logToConsole("snapshot", "Starting snapshot creation...");
        const now = new Date();
        const timestamp =
          now.getFullYear() +
          String(now.getMonth() + 1).padStart(2, "0") +
          String(now.getDate()).padStart(2, "0") +
          "T" +
          String(now.getHours()).padStart(2, "0") +
          String(now.getMinutes()).padStart(2, "0") +
          String(now.getSeconds()).padStart(2, "0");
        const bucketName = localStorage.getItem("aws-bucket");
        const data = await exportBackupData();
        const encryptedData = await encryptData(data);
        const jszip = await loadJSZip();
        const zip = new jszip();
        zip.file(`Snapshot_${timestamp}.json`, encryptedData, {
          compression: "DEFLATE",
          compressionOptions: {
            level: 9,
          },
          binary: true,
        });
        const compressedContent = await zip.generateAsync({ type: "blob" });
        if (compressedContent.size < 100) {
          throw new Error(
            "Snapshot file is too small or empty. Upload cancelled."
          );
        }
        const s3 = new AWS.S3();
        const putParams = {
          Bucket: bucketName,
          Key: `Snapshot_${timestamp}.zip`,
          Body: compressedContent,
          ContentType: "application/zip",
          ServerSideEncryption: "AES256",
        };
        await s3.putObject(putParams).promise();
        const lastSyncElement = document.getElementById("last-sync-msg");
        const currentTime = new Date().toLocaleString();
        lastSyncElement.textContent = `Snapshot successfully saved to the cloud at ${currentTime}`;
        setTimeout(() => {
          const lastSync = localStorage.getItem("last-cloud-sync");
          if (lastSync) {
            lastSyncElement.textContent = `Last sync done at ${lastSync}`;
          }
        }, 3000);
        if (document.querySelector('[data-element-id="sync-modal-dbbackup"]')) {
          await loadBackupFiles();
        }
        logToConsole(
          "success",
          `Snapshot created successfully: Snapshot_${timestamp}.zip`
        );
      } catch (error) {
        logToConsole("error", "Snapshot creation failed:", error);
        const lastSyncElement = document.getElementById("last-sync-msg");
        lastSyncElement.textContent = `Error creating snapshot: ${error.message}`;
        setTimeout(() => {
          const lastSync = localStorage.getItem("last-cloud-sync");
          if (lastSync) {
            lastSyncElement.textContent = `Last sync done at ${lastSync}`;
          }
        }, 3000);
      } finally {
        snapshotBtn.disabled = false;
        snapshotBtn.style.cursor = "pointer";
        snapshotBtn.innerHTML = originalButtonContent;
      }
    });

  document
    .getElementById("console-logging-toggle")
    .addEventListener("change", function (e) {
      isConsoleLoggingEnabled = e.target.checked;
      if (isConsoleLoggingEnabled) {
        logToConsole("info", `Typingmind cloud backup version ${VERSION}`);
        const url = new URL(window.location);
        url.searchParams.set("log", "true");
        window.history.replaceState({}, "", url);
      } else {
        const url = new URL(window.location);
        url.searchParams.delete("log");
        window.history.replaceState({}, "", url);
      }
    });
  const consoleLoggingToggle = document.getElementById(
    "console-logging-toggle"
  );
  consoleLoggingToggle.checked = isConsoleLoggingEnabled;

  const alertSmallerCloudCheckbox = document.getElementById(
    "alert-smaller-cloud"
  );
  if (alertSmallerCloudCheckbox) {
    alertSmallerCloudCheckbox.checked = getShouldAlertOnSmallerCloud();
    alertSmallerCloudCheckbox.addEventListener("change", (e) => {
      localStorage.setItem("alert-smaller-cloud", e.target.checked);
    });
  }
}

let visibilityChangeTimeout = null;
let isProcessingVisibilityChange = false;

document.addEventListener("visibilitychange", async () => {
  logToConsole(
    "visibility",
    `Visibility changed: ${document.hidden ? "hidden" : "visible"}`
  );

  if (backupInterval) {
    logToConsole("cleanup", `Clearing backup interval ${backupInterval}`);
    clearInterval(backupInterval);
    backupInterval = null;
    backupIntervalRunning = false;
    localStorage.setItem("activeTabBackupRunning", "false");
  }

  if (document.hidden) {
    logToConsole("info", "Tab hidden - clearing backup intervals");
    return;
  }

  const bucketName = localStorage.getItem("aws-bucket");
  const awsAccessKey = localStorage.getItem("aws-access-key");
  const awsSecretKey = localStorage.getItem("aws-secret-key");

  if (!bucketName || !awsAccessKey || !awsSecretKey) {
    logToConsole("info", "Backup not configured, skipping initialization");
    return;
  }

  if (visibilityChangeTimeout) {
    clearTimeout(visibilityChangeTimeout);
  }

  // Increase the delay before processing visibility change
  visibilityChangeTimeout = setTimeout(() => {
    if (isProcessingVisibilityChange) {
      logToConsole("skip", "Already processing visibility change, skipping");
      return;
    }

    isProcessingVisibilityChange = true;
    try {
      logToConsole("active", "Tab became active");

      if (isWaitingForUserInput) {
        logToConsole(
          "skip",
          "Tab activation tasks skipped - waiting for user input"
        );
        return;
      }

      if (localStorage.getItem("sync-mode") === "backup") {
        logToConsole(
          "info",
          "Running in backup mode - skipping automatic import"
        );
        wasImportSuccessful = true;
        startBackupInterval();
        return;
      }

      // Check if we recently completed an export
      const timeSinceLastExport = lastExportTime
        ? Date.now() - lastExportTime
        : Infinity;
      const backupIntervalMs =
        parseInt(localStorage.getItem("backup-interval") || "60") * 1000 * 2;
      if (timeSinceLastExport < backupIntervalMs) {
        // Within 2x the backup interval
        logToConsole(
          "skip",
          `Skipping import as export was completed ${Math.round(
            timeSinceLastExport / 1000
          )}s ago (threshold: ${backupIntervalMs / 1000}s)`
        );
        wasImportSuccessful = true;
        startBackupInterval();
        return;
      }

      queueCloudOperation("visibility-change-import", async () => {
        try {
          logToConsole("info", "Checking for updates from S3...");
          const importSuccessful = await checkAndImportBackup();
          if (importSuccessful) {
            const currentTime = new Date().toLocaleString();
            const storedSuffix = localStorage.getItem(
              "last-daily-backup-in-s3"
            );
            const today = new Date();
            const currentDateSuffix = `${today.getFullYear()}${String(
              today.getMonth() + 1
            ).padStart(2, "0")}${String(today.getDate()).padStart(2, "0")}`;

            var element = document.getElementById("last-sync-msg");
            if (element !== null) {
              element.innerText = `Last sync done at ${currentTime}`;
              element = null;
            }
            if (!storedSuffix || currentDateSuffix > storedSuffix) {
              await handleBackupFiles();
            }
            logToConsole(
              "success",
              "Import successful, starting backup interval"
            );
            startBackupInterval();
          } else {
            wasImportSuccessful = true;
            startBackupInterval();
          }
        } catch (error) {
          logToConsole("error", "Error during tab activation:", error);
        }
      });
    } finally {
      isProcessingVisibilityChange = false;
      visibilityChangeTimeout = null;
    }
  }, 300);
});

async function handleTimeBasedBackup() {
  const bucketName = localStorage.getItem("aws-bucket");
  const lastTimeBackup = parseInt(
    localStorage.getItem("last-time-based-backup")
  );
  const currentTime = new Date().getTime();
  if (
    !lastTimeBackup ||
    isNaN(lastTimeBackup) ||
    currentTime - lastTimeBackup >= TIME_BACKUP_INTERVAL * 60 * 1000
  ) {
    logToConsole(
      "time",
      `Starting time-based backup (T-${TIME_BACKUP_INTERVAL})`
    );
    const s3 = new AWS.S3();
    try {
      const data = await exportBackupData();
      const encryptedData = await encryptData(data);
      const jszip = await loadJSZip();
      const zip = new jszip();
      zip.file(`${TIME_BACKUP_FILE_PREFIX}.json`, encryptedData, {
        compression: "DEFLATE",
        compressionOptions: {
          level: 9,
        },
        binary: true,
      });
      const compressedContent = await zip.generateAsync({ type: "blob" });
      const uploadParams = {
        Bucket: bucketName,
        Key: `${TIME_BACKUP_FILE_PREFIX}.zip`,
        Body: compressedContent,
        ContentType: "application/zip",
        ServerSideEncryption: "AES256",
      };
      await s3.putObject(uploadParams).promise();
      localStorage.setItem("last-time-based-backup", currentTime.toString());
      logToConsole("success", "Time-based backup completed");
    } catch (error) {
      logToConsole("error", "Time-based backup failed:", error);
      throw error;
    }
  } else {
    const timeUntilNextBackup =
      TIME_BACKUP_INTERVAL * 60 * 1000 - (currentTime - lastTimeBackup);
    const minutesUntilNext = Math.round(timeUntilNextBackup / 1000 / 60);
    logToConsole(
      "wait",
      `Time-based backup not yet due. Next backup in ${minutesUntilNext} minutes`
    );
  }
}

async function checkAndImportBackup() {
  const bucketName = localStorage.getItem("aws-bucket");
  const awsRegion = localStorage.getItem("aws-region");
  const awsAccessKey = localStorage.getItem("aws-access-key");
  const awsSecretKey = localStorage.getItem("aws-secret-key");
  const encryptionKey = localStorage.getItem("encryption-key");
  const awsEndpoint = localStorage.getItem("aws-endpoint");
  if (!bucketName || !awsAccessKey || !awsSecretKey || !encryptionKey) {
    wasImportSuccessful = false;
    if (!encryptionKey) {
      alert(
        "Please configure your encryption key in the backup settings before proceeding."
      );
    } else {
      alert(
        "Please configure all AWS credentials in the backup settings before proceeding."
      );
    }
    return false;
  }
  if (typeof AWS === "undefined") {
    await loadAwsSdk();
  }
  const awsConfig = {
    accessKeyId: awsAccessKey,
    secretAccessKey: awsSecretKey,
    region: awsRegion,
  };
  if (awsEndpoint) {
    awsConfig.endpoint = awsEndpoint;
  }
  AWS.config.update(awsConfig);
  try {
    const importResult = await importFromS3();
    if (importResult) {
      wasImportSuccessful = true;
      logToConsole("success", "Import successful");
      return true;
    } else {
      wasImportSuccessful = true;
      logToConsole("info", "Starting backup of local data to cloud");
      return false;
    }
  } catch (err) {
    if (err.code === "NoSuchKey") {
      alert("Backup file not found in S3! Run an adhoc 'Export' first.");
      wasImportSuccessful = true;
      return true;
    } else if (
      err.message === "Encryption key not configured" ||
      err.message ===
        "Failed to decrypt backup. Please check your encryption key."
    ) {
      alert(
        "Please configure your encryption key in the backup settings to decrypt this backup."
      );
      wasImportSuccessful = false;
      return false;
    } else if (
      err.code === "CredentialsError" ||
      err.code === "InvalidAccessKeyId"
    ) {
      localStorage.setItem("aws-bucket", "");
      localStorage.setItem("aws-access-key", "");
      localStorage.setItem("aws-secret-key", "");
      alert("Failed to connect to AWS. Please check your credentials.");
      wasImportSuccessful = false;
      return false;
    } else {
      logToConsole("error", "Import error:", err);
      alert("Error during import: " + err.message);
      wasImportSuccessful = false;
      return false;
    }
  }
}

async function loadBackupFiles() {
  const select = document.getElementById("backup-files");
  if (!select) {
    logToConsole(
      "info",
      "Backup files select element not found - modal may not be open"
    );
    return;
  }

  const bucketName = localStorage.getItem("aws-bucket");
  const awsRegion = localStorage.getItem("aws-region");
  const awsAccessKey = localStorage.getItem("aws-access-key");
  const awsSecretKey = localStorage.getItem("aws-secret-key");
  const awsEndpoint = localStorage.getItem("aws-endpoint");

  if (!bucketName || !awsAccessKey || !awsSecretKey) {
    select.innerHTML =
      '<option value="">Please configure AWS credentials first</option>';
    updateBackupButtons();
    return;
  }

  try {
    if (typeof AWS === "undefined") {
      await loadAwsSdk();
    }
    const awsConfig = {
      accessKeyId: awsAccessKey,
      secretAccessKey: awsSecretKey,
      region: awsRegion,
    };
    if (awsEndpoint) {
      awsConfig.endpoint = awsEndpoint;
    }
    AWS.config.update(awsConfig);
    const s3 = new AWS.S3();
    const data = await s3.listObjectsV2({ Bucket: bucketName }).promise();
    select.innerHTML = "";
    if (data.Contents.length === 0) {
      select.innerHTML = '<option value="">No backup files found</option>';
    } else {
      const files = data.Contents.sort(
        (a, b) => b.LastModified - a.LastModified
      );
      files.forEach((file) => {
        const option = document.createElement("option");
        option.value = file.Key;
        option.textContent = `${file.Key} (${new Date(
          file.LastModified
        ).toLocaleString()})`;
        select.appendChild(option);
      });
    }
    updateBackupButtons();
  } catch (error) {
    logToConsole("error", "Error loading backup files:", error);
    select.innerHTML = '<option value="">Error loading backups</option>';
    updateBackupButtons();
  }
}

function updateBackupButtons() {
  const select = document.getElementById("backup-files");
  const downloadBtn = document.getElementById("download-backup-btn");
  const restoreBtn = document.getElementById("restore-backup-btn");
  const deleteBtn = document.getElementById("delete-backup-btn");
  const refreshBtn = document.getElementById("refresh-backups-btn");
  const bucketConfigured =
    localStorage.getItem("aws-bucket") &&
    localStorage.getItem("aws-access-key") &&
    localStorage.getItem("aws-secret-key");
  if (refreshBtn) {
    refreshBtn.disabled = !bucketConfigured;
    refreshBtn.classList.toggle("opacity-50", !bucketConfigured);
  }
  const selectedFile = select.value;
  const isSnapshotFile = selectedFile.startsWith("Snapshot_");
  if (downloadBtn) {
    downloadBtn.disabled = !bucketConfigured || !selectedFile;
    downloadBtn.classList.toggle(
      "opacity-50",
      !bucketConfigured || !selectedFile
    );
  }
  if (restoreBtn) {
    restoreBtn.disabled =
      !bucketConfigured ||
      !selectedFile ||
      selectedFile === "typingmind-backup.json";
    restoreBtn.classList.toggle(
      "opacity-50",
      !bucketConfigured ||
        !selectedFile ||
        selectedFile === "typingmind-backup.json"
    );
  }
  if (deleteBtn) {
    deleteBtn.disabled = !bucketConfigured || !selectedFile || !isSnapshotFile;
    deleteBtn.classList.toggle(
      "opacity-50",
      !bucketConfigured || !selectedFile || !isSnapshotFile
    );
  }
}

async function downloadBackupFile() {
  const bucketName = localStorage.getItem("aws-bucket");
  const selectedFile = document.getElementById("backup-files").value;
  const s3 = new AWS.S3();
  try {
    logToConsole("download", `Starting download of ${selectedFile}`);
    const data = await s3
      .getObject({
        Bucket: bucketName,
        Key: selectedFile,
      })
      .promise();
    if (selectedFile.endsWith(".zip")) {
      const jszip = await loadJSZip();
      const zip = await jszip.loadAsync(data.Body);
      const jsonFile = Object.keys(zip.files)[0];
      const encryptedContent = await zip.file(jsonFile).async("uint8array");
      try {
        const decryptedData = await decryptData(encryptedContent);
        const decryptedBlob = new Blob(
          [JSON.stringify(decryptedData, null, 2)],
          {
            type: "application/json",
          }
        );
        const url = window.URL.createObjectURL(decryptedBlob);
        const a = document.createElement("a");
        a.href = url;
        const downloadName = selectedFile.replace(".zip", ".json");
        a.download = downloadName;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
        logToConsole("success", `File downloaded and decrypted successfully`);
      } catch (decryptError) {
        logToConsole("error", `Decryption failed:`, decryptError);
        alert(
          "Failed to decrypt the backup file. Please check your encryption key."
        );
        return;
      }
    } else {
      try {
        const encryptedContent = new Uint8Array(data.Body);
        const decryptedData = await decryptData(encryptedContent);
        const decryptedBlob = new Blob(
          [JSON.stringify(decryptedData, null, 2)],
          {
            type: "application/json",
          }
        );
        const url = window.URL.createObjectURL(decryptedBlob);
        const a = document.createElement("a");
        a.href = url;
        a.download = selectedFile;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
        logToConsole("success", `File downloaded and decrypted successfully`);
      } catch (decryptError) {
        logToConsole("error", `Decryption failed:`, decryptError);
        alert(
          "Failed to decrypt the backup file. Please check your encryption key."
        );
        return;
      }
    }
  } catch (error) {
    logToConsole("error", `Download failed:`, error);
    alert("Error downloading file: " + error.message);
  }
}

async function restoreBackupFile() {
  const bucketName = localStorage.getItem("aws-bucket");
  const s3 = new AWS.S3();
  const selectedFile = document.getElementById("backup-files").value;
  try {
    const data = await s3
      .getObject({
        Bucket: bucketName,
        Key: selectedFile,
      })
      .promise();
    try {
      const jszip = await loadJSZip();
      const zip = await jszip.loadAsync(data.Body);
      const jsonFile = Object.keys(zip.files)[0];
      const encryptedContent = await zip.file(jsonFile).async("uint8array");
      const importedData = await decryptData(encryptedContent);
      importDataToStorage(importedData);
      const currentTime = new Date().toLocaleString();
      localStorage.setItem("last-cloud-sync", currentTime);
      const element = document.getElementById("last-sync-msg");
      if (element) {
        element.innerText = `Last sync done at ${currentTime}`;
      }
      alert("Backup restored successfully!");
    } catch (error) {
      logToConsole("error", "Error restoring backup:", error);
      alert(
        "Error restoring backup: " +
          (error.message ||
            "Failed to decrypt backup. Please check your encryption key.")
      );
    }
  } catch (error) {
    logToConsole("error", "Error restoring backup:", error);
    alert("Error restoring backup: " + error.message);
  }
}

function startBackupInterval() {
  if (isWaitingForUserInput) {
    logToConsole("skip", "Skipping interval start - waiting for user input");
    return;
  }

  if (backupIntervalRunning) {
    logToConsole("skip", "Backup interval already running, skipping start");
    return;
  }

  logToConsole("start", "Starting backup interval...");

  if (backupInterval) {
    logToConsole("cleanup", `Clearing existing interval ${backupInterval}`);
    clearInterval(backupInterval);
    backupInterval = null;
    backupIntervalRunning = false;
  }

  localStorage.setItem("activeTabBackupRunning", "false");

  setTimeout(() => {
    if (isWaitingForUserInput || backupIntervalRunning) {
      logToConsole(
        "skip",
        "Another backup interval was started or waiting for user input, skipping"
      );
      return;
    }

    localStorage.setItem("activeTabBackupRunning", "true");
    const configuredInterval =
      parseInt(localStorage.getItem("backup-interval")) || 60;
    const intervalInMilliseconds = Math.max(configuredInterval * 1000, 15000);
    logToConsole(
      "info",
      `Setting backup interval to ${intervalInMilliseconds / 1000} seconds`
    );

    // Add immediate backup when starting the interval
    queueCloudOperation("immediate-backup", performBackup);

    backupIntervalRunning = true;
    backupInterval = setInterval(() => {
      if (!backupIntervalRunning) {
        logToConsole(
          "stop",
          "Backup interval flag was cleared, stopping interval"
        );
        clearInterval(backupInterval);
        return;
      }
      logToConsole("start", "Interval triggered");
      performBackup().catch((error) => {
        logToConsole("error", "Unhandled error in backup interval:", error);
      });
    }, intervalInMilliseconds);

    logToConsole(
      "success",
      `Backup interval started with ID ${backupInterval}`
    );
  }, 100);
}

async function performBackup() {
  if (isWaitingForUserInput) {
    logToConsole("pause", "Backup skipped - waiting for user input");
    return;
  }
  if (!isPageFullyLoaded) {
    logToConsole("skip", "Page not fully loaded, skipping backup");
    return;
  }
  if (document.hidden) {
    logToConsole("skip", "Tab is hidden, skipping backup");
    return;
  }
  if (isExportInProgress) {
    logToConsole(
      "skip",
      "Previous backup still in progress, queueing this iteration"
    );
    queueCloudOperation("backup", performBackup); // Changed from backupToS3 to performBackup
    return;
  }
  if (!wasImportSuccessful) {
    logToConsole("skip", "Import not yet successful, skipping backup");
    return;
  }

  try {
    await backupToS3();
    logToConsole("success", "Backup completed...");
  } catch (error) {
    logToConsole("error", "Backup failed:", error);
    if (backupIntervalRunning) {
      logToConsole("cleanup", "Clearing existing backup interval");
      clearInterval(backupInterval);
      backupInterval = null;
      backupIntervalRunning = false;
      localStorage.setItem("activeTabBackupRunning", "false");
    }
    setTimeout(() => {
      if (!backupIntervalRunning) {
        logToConsole("resume", "Restarting backup interval after failure");
        startBackupInterval();
      }
    }, 5000);
  }
}

async function loadAwsSdk() {
  if (awsSdkLoadPromise) return awsSdkLoadPromise;
  awsSdkLoadPromise = new Promise((resolve, reject) => {
    if (typeof AWS !== "undefined") {
      resolve();
      return;
    }
    const script = document.createElement("script");
    script.src = "https://sdk.amazonaws.com/js/aws-sdk-2.804.0.min.js";
    script.onload = resolve;
    script.onerror = reject;
    document.head.appendChild(script);
  });
  return awsSdkLoadPromise;
}

async function loadJSZip() {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src =
      "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.5.0/jszip.min.js";
    script.onload = () => {
      resolve(window.JSZip);
    };
    script.onerror = reject;
    document.head.appendChild(script);
  });
}

function importDataToStorage(data) {
  return new Promise((resolve, reject) => {
    const preserveKeys = [
      "import-size-threshold",
      "export-size-threshold",
      "alert-smaller-cloud",
      "encryption-key",
      "aws-bucket",
      "aws-access-key",
      "aws-secret-key",
      "aws-region",
      "aws-endpoint",
      "backup-interval",
      "sync-mode",
      "sync-status-hidden",
      "sync-status-position",
      "activeTabBackupRunning",
      "last-time-based-backup",
      "last-daily-backup-in-s3",
      "last-cloud-sync",
    ];

    Object.keys(data.localStorage).forEach((key) => {
      if (!preserveKeys.includes(key)) {
        localStorage.setItem(key, data.localStorage[key]);
        isLocalDataModified = true;
      }
    });

    const request = indexedDB.open("keyval-store");
    request.onerror = () => reject(request.error);
    request.onsuccess = function (event) {
      const db = event.target.result;
      const transaction = db.transaction(["keyval"], "readwrite");
      const objectStore = transaction.objectStore("keyval");
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      const deleteRequest = objectStore.clear();
      deleteRequest.onsuccess = function () {
        const indexedDBData = data.indexedDB;
        Object.keys(indexedDBData).forEach((key) => {
          objectStore.put(indexedDBData[key], key);
        });
      };
    };
    let extensionURLs = JSON.parse(
      localStorage.getItem("TM_useExtensionURLs") || "[]"
    );
    if (!extensionURLs.some((url) => url.endsWith("s3.js"))) {
      extensionURLs.push(
        "https://itcon-pty-au.github.io/typingmind-cloud-backup/s3.js"
      );
      localStorage.setItem(
        "TM_useExtensionURLs",
        JSON.stringify(extensionURLs)
      );
    }
  });
}

function exportBackupData() {
  return new Promise((resolve, reject) => {
    const exportData = {
      localStorage: { ...localStorage },
      indexedDB: {},
    };

    logToConsole("info", "Starting data export", {
      localStorageKeys: Object.keys(exportData.localStorage).length,
    });

    const request = indexedDB.open("keyval-store", 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = function (event) {
      const db = event.target.result;
      const transaction = db.transaction(["keyval"], "readonly");
      const store = transaction.objectStore("keyval");

      // Create a promise that resolves when all data is collected
      const collectData = new Promise((resolveData) => {
        store.getAllKeys().onsuccess = function (keyEvent) {
          const keys = keyEvent.target.result;
          logToConsole("info", "IndexedDB keys found", {
            count: keys.length,
          });

          store.getAll().onsuccess = function (valueEvent) {
            const values = valueEvent.target.result;
            keys.forEach((key, i) => {
              exportData.indexedDB[key] = values[i];
            });
            resolveData();
          };
        };
      });

      // Wait for both transaction completion and data collection
      Promise.all([
        collectData,
        new Promise((resolveTransaction) => {
          transaction.oncomplete = resolveTransaction;
        }),
      ])
        .then(() => {
          const hasLocalStorageData =
            Object.keys(exportData.localStorage).length > 0;
          const hasIndexedDBData = Object.keys(exportData.indexedDB).length > 0;

          logToConsole("info", "Export data summary", {
            localStorageKeys: Object.keys(exportData.localStorage).length,
            indexedDBKeys: Object.keys(exportData.indexedDB).length,
            localStorageSize: JSON.stringify(exportData.localStorage).length,
            indexedDBSize: JSON.stringify(exportData.indexedDB).length,
            hasLocalStorageData,
            hasIndexedDBData,
          });

          if (!hasLocalStorageData && !hasIndexedDBData) {
            reject(new Error("No data found in localStorage or IndexedDB"));
            return;
          }
          resolve(exportData);
        })
        .catch(reject);

      transaction.onerror = () => reject(transaction.error);
    };
  });
}

async function deleteBackupFile() {
  const selectedFile = document.getElementById("backup-files").value;
  if (!selectedFile.startsWith("Snapshot_")) {
    return;
  }
  const isConfirmed = await showCustomAlert(
    `Are you sure you want to delete ${selectedFile}? This action cannot be undone.`,
    "Confirm Deletion",
    [
      { text: "Cancel", primary: false },
      { text: "Delete", primary: true },
    ]
  );
  if (!isConfirmed) {
    return;
  }
  const bucketName = localStorage.getItem("aws-bucket");
  const s3 = new AWS.S3();
  try {
    await s3
      .deleteObject({
        Bucket: bucketName,
        Key: selectedFile,
      })
      .promise();
    await loadBackupFiles();
    const actionMsgElement = document.getElementById("action-msg");
    if (actionMsgElement) {
      actionMsgElement.textContent = "Backup file deleted successfully";
      actionMsgElement.style.color = "white";
      setTimeout(() => {
        actionMsgElement.textContent = "";
      }, 3000);
    }
  } catch (error) {
    logToConsole("error", "Error deleting file:", error);
    const actionMsgElement = document.getElementById("action-msg");
    if (actionMsgElement) {
      actionMsgElement.textContent = `Error deleting file: ${error.message}`;
      actionMsgElement.style.color = "red";
    }
  }
}

async function validateAwsCredentials(bucketName, accessKey, secretKey) {
  const awsRegion = localStorage.getItem("aws-region");
  const awsEndpoint = localStorage.getItem("aws-endpoint");
  if (typeof AWS === "undefined") {
    await loadAwsSdk();
  }
  const awsConfig = {
    accessKeyId: accessKey,
    secretAccessKey: secretKey,
    region: awsRegion,
  };
  if (awsEndpoint) {
    awsConfig.endpoint = awsEndpoint;
  }
  AWS.config.update(awsConfig);
  const s3 = new AWS.S3();
  const params = {
    Bucket: bucketName,
    MaxKeys: 1,
  };
  return new Promise((resolve, reject) => {
    s3.listObjectsV2(params, function (err, data) {
      if (err) {
        reject(err);
      } else {
        resolve(data);
      }
    });
  });
}

async function handleBackupFiles() {
  logToConsole("start", `Starting daily backup process...`);
  let backupFile = null;
  let backupContent = null;
  let zip = null;
  let compressedContent = null;
  const bucketName = localStorage.getItem("aws-bucket");
  const awsRegion = localStorage.getItem("aws-region");
  const awsAccessKey = localStorage.getItem("aws-access-key");
  const awsSecretKey = localStorage.getItem("aws-secret-key");
  const awsEndpoint = localStorage.getItem("aws-endpoint");
  if (typeof AWS === "undefined") {
    await loadAwsSdk();
  }
  const awsConfig = {
    accessKeyId: awsAccessKey,
    secretAccessKey: awsSecretKey,
    region: awsRegion,
  };
  if (awsEndpoint) {
    awsConfig.endpoint = awsEndpoint;
  }
  AWS.config.update(awsConfig);
  try {
    let s3 = new AWS.S3();
    const params = {
      Bucket: bucketName,
      Prefix: "typingmind-backup",
    };
    const today = new Date();
    const currentDateSuffix = `${today.getFullYear()}${String(
      today.getMonth() + 1
    ).padStart(2, "0")}${String(today.getDate()).padStart(2, "0")}`;
    const data = await s3.listObjectsV2(params).promise();
    if (data.Contents.length > 0) {
      const todaysBackupFile = data.Contents.find(
        (file) =>
          file.Key === `typingmind-backup-${currentDateSuffix}.json` ||
          file.Key === `typingmind-backup-${currentDateSuffix}.zip`
      );
      if (!todaysBackupFile) {
        const getObjectParams = {
          Bucket: bucketName,
          Key: "typingmind-backup.json",
        };
        backupFile = await s3.getObject(getObjectParams).promise();
        const decryptedData = await decryptData(
          new Uint8Array(backupFile.Body)
        );
        backupContent = await encryptData(decryptedData);
        const jszip = await loadJSZip();
        zip = new jszip();
        zip.file(`typingmind-backup-${currentDateSuffix}.json`, backupContent, {
          compression: "DEFLATE",
          compressionOptions: {
            level: 9,
          },
          binary: true,
        });
        compressedContent = await zip.generateAsync({ type: "blob" });
        if (compressedContent.size < 100) {
          throw new Error(
            "Daily backup file is too small or empty. Upload cancelled."
          );
        }
        const zipKey = `typingmind-backup-${currentDateSuffix}.zip`;
        const uploadParams = {
          Bucket: bucketName,
          Key: zipKey,
          Body: compressedContent,
          ContentType: "application/zip",
          ServerSideEncryption: "AES256",
        };
        await s3.putObject(uploadParams).promise();
        logToConsole("success", `Daily backup created: ${zipKey}`);
        localStorage.setItem("last-daily-backup-in-s3", currentDateSuffix);
        if (document.querySelector('[data-element-id="sync-modal-dbbackup"]')) {
          await loadBackupFiles();
        }
      } else {
        logToConsole("info", `Daily backup file already exists for today`);
      }
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(today.getDate() - 30);
      for (const file of data.Contents) {
        if (
          file.Key.endsWith(".zip") &&
          file.Key !== "typingmind-backup.json"
        ) {
          const fileDate = new Date(file.LastModified);
          if (fileDate < thirtyDaysAgo) {
            const deleteParams = {
              Bucket: bucketName,
              Key: file.Key,
            };
            await s3.deleteObject(deleteParams).promise();
            logToConsole("success", "Purged old backup:", file.Key);
          }
        }
      }
    }
  } catch (error) {
    logToConsole("error", `Daily backup process failed:`, error);
  } finally {
    backupFile = null;
    backupContent = null;
    zip = null;
    compressedContent = null;
  }
  if (document.querySelector('[data-element-id="sync-modal-dbbackup"]')) {
    await loadBackupFiles();
  }
}

async function deriveKey(password) {
  const enc = new TextEncoder();
  const keyMaterial = await window.crypto.subtle.importKey(
    "raw",
    enc.encode(password),
    "PBKDF2",
    false,
    ["deriveBits", "deriveKey"]
  );
  const salt = enc.encode("typingmind-backup-salt");
  return window.crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: salt,
      iterations: 100000,
      hash: "SHA-256",
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

async function encryptData(data) {
  const encryptionKey = localStorage.getItem("encryption-key");
  const bucketName = localStorage.getItem("aws-bucket");
  logToConsole("encrypt", "Encryption attempt:", { hasKey: !!encryptionKey });

  if (!bucketName) {
    logToConsole("info", "Backup not configured, skipping encryption");
    throw new Error("Backup not configured");
  }

  if (!encryptionKey) {
    logToConsole("warning", "No encryption key found");
    if (backupIntervalRunning) {
      clearInterval(backupInterval);
      backupIntervalRunning = false;
      localStorage.setItem("activeTabBackupRunning", "false");
    }
    wasImportSuccessful = false;
    await showCustomAlert(
      "Please configure an encryption key in the backup settings before proceeding.",
      "Configuration Required"
    );
    throw new Error("Encryption key not configured");
  }
  try {
    const key = await deriveKey(encryptionKey);
    const enc = new TextEncoder();
    const iv = window.crypto.getRandomValues(new Uint8Array(12));
    const encodedData = enc.encode(JSON.stringify(data));
    const encryptedContent = await window.crypto.subtle.encrypt(
      {
        name: "AES-GCM",
        iv: iv,
      },
      key,
      encodedData
    );
    const marker = new TextEncoder().encode("ENCRYPTED:");
    const combinedData = new Uint8Array(
      marker.length + iv.length + encryptedContent.byteLength
    );
    combinedData.set(marker);
    combinedData.set(iv, marker.length);
    combinedData.set(
      new Uint8Array(encryptedContent),
      marker.length + iv.length
    );
    logToConsole("success", "Encryption successful");
    return combinedData;
  } catch (error) {
    localStorage.removeItem("encryption-key");
    clearInterval(backupInterval);
    logToConsole("error", "Encryption failed:", error);
    throw error;
  }
}

async function decryptData(data) {
  const marker = "ENCRYPTED:";
  const dataString = new TextDecoder().decode(data.slice(0, marker.length));
  const bucketName = localStorage.getItem("aws-bucket");

  logToConsole("tag", "Checking encryption marker:", {
    expectedMarker: marker,
    foundMarker: dataString,
    isEncrypted: dataString === marker,
  });

  if (dataString !== marker) {
    logToConsole("info", "Data is not encrypted, returning as-is");
    return JSON.parse(new TextDecoder().decode(data));
  }

  if (!bucketName) {
    logToConsole("info", "Backup not configured, skipping decryption");
    throw new Error("Backup not configured");
  }

  const encryptionKey = localStorage.getItem("encryption-key");
  if (!encryptionKey) {
    logToConsole("error", "Encrypted data found but no key provided");
    if (backupIntervalRunning) {
      clearInterval(backupInterval);
      backupIntervalRunning = false;
      localStorage.setItem("activeTabBackupRunning", "false");
    }
    wasImportSuccessful = false;
    await showCustomAlert(
      "Please configure your encryption key in the backup settings before proceeding.",
      "Configuration Required"
    );
    throw new Error("Encryption key not configured");
  }
  try {
    const key = await deriveKey(encryptionKey);
    const iv = data.slice(marker.length, marker.length + 12);
    const content = data.slice(marker.length + 12);
    const decryptedContent = await window.crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: iv,
      },
      key,
      content
    );
    const dec = new TextDecoder();
    const decryptedString = dec.decode(decryptedContent);
    const parsedData = JSON.parse(decryptedString);
    return parsedData;
  } catch (error) {
    localStorage.removeItem("encryption-key");
    clearInterval(backupInterval);
    logToConsole("error", "Decryption failed:", error);
    alert("Failed to decrypt backup. Please re-enter encryption key.");
    throw error;
  }
}

async function cleanupIncompleteMultipartUploads(s3, bucketName) {
  logToConsole("cleanup", "Checking for incomplete multipart uploads...");
  try {
    const multipartUploads = await s3
      .listMultipartUploads({
        Bucket: bucketName,
      })
      .promise();
    if (multipartUploads.Uploads && multipartUploads.Uploads.length > 0) {
      logToConsole(
        "cleanup",
        `Found ${multipartUploads.Uploads.length} incomplete multipart uploads`
      );
      for (const upload of multipartUploads.Uploads) {
        const uploadAge = Date.now() - new Date(upload.Initiated).getTime();
        const fiveMinutes = 5 * 60 * 1000;
        if (uploadAge > fiveMinutes) {
          try {
            await s3
              .abortMultipartUpload({
                Bucket: bucketName,
                Key: upload.Key,
                UploadId: upload.UploadId,
              })
              .promise();
            logToConsole(
              "success",
              `Aborted incomplete upload for ${upload.Key} (${Math.round(
                uploadAge / 1000 / 60
              )}min old)`
            );
          } catch (error) {
            logToConsole("error", "Failed to abort upload:", error);
          }
        } else {
          logToConsole(
            "skip",
            `Skipping recent upload for ${upload.Key} (${Math.round(
              uploadAge / 1000
            )}s old)`
          );
        }
      }
    } else {
      logToConsole("info", "No incomplete multipart uploads found");
    }
  } catch (error) {
    logToConsole("error", "Error cleaning up multipart uploads:", error);
  }
}

function showCustomAlert(
  message,
  title = "Alert",
  buttons = [{ text: "OK", primary: true }]
) {
  return new Promise((resolve) => {
    const navContainer = document.querySelector(
      '[data-element-id="nav-container"]'
    );
    const originalZIndex = navContainer?.style.zIndex;
    if (navContainer) {
      navContainer.style.zIndex = "unset";
    }

    const modal = document.createElement("div");
    modal.className =
      "fixed inset-0 bg-black bg-opacity-50 z-[99999] flex items-center justify-center p-4";
    modal.style.touchAction = "auto";
    const dialog = document.createElement("div");
    dialog.className =
      "bg-white dark:bg-zinc-900 rounded-lg max-w-md w-full p-6 shadow-xl relative z-[99999]";

    const titleElement = document.createElement("h3");
    titleElement.className =
      "text-lg font-semibold mb-4 text-gray-900 dark:text-white";
    titleElement.textContent = title;
    const messageElement = document.createElement("div");
    messageElement.className =
      "text-gray-700 dark:text-gray-300 whitespace-pre-wrap mb-6";
    messageElement.textContent = message;
    const buttonContainer = document.createElement("div");
    buttonContainer.className = "flex justify-end space-x-3";
    buttons.forEach((button) => {
      const btn = document.createElement("button");
      btn.className = `${
        button.primary
          ? "px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
          : "px-4 py-2 bg-gray-200 text-gray-800 rounded hover:bg-gray-300"
      } 
                cursor-pointer touch-manipulation`;
      btn.style.WebkitTapHighlightColor = "transparent";
      btn.style.userSelect = "none";
      btn.textContent = button.text;
      const handleClick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        cleanup();
        modal.remove();
        resolve(button.text === "Proceed" || button.text === "OK");
      };
      btn.addEventListener("click", handleClick, { passive: false });
      btn.addEventListener("touchend", handleClick, { passive: false });
      buttonContainer.appendChild(btn);
    });
    dialog.appendChild(titleElement);
    dialog.appendChild(messageElement);
    dialog.appendChild(buttonContainer);
    modal.appendChild(dialog);
    document.body.style.overflow = "hidden";
    const cleanup = () => {
      document.body.style.overflow = "";
      if (navContainer) {
        navContainer.style.zIndex = originalZIndex || "60";
      }
    };
    modal.addEventListener("remove", cleanup);
    document.body.appendChild(modal);
    modal.addEventListener(
      "touchmove",
      (e) => {
        e.preventDefault();
      },
      { passive: false }
    );
    dialog.addEventListener(
      "touchmove",
      (e) => {
        e.stopPropagation();
      },
      { passive: true }
    );
  });
}

function logToConsole(type, message, data = null) {
  if (!isConsoleLoggingEnabled) return;

  const timestamp = new Date().toISOString();
  const icons = {
    info: "ℹ️",
    success: "✅",
    warning: "⚠️",
    error: "❌",
    start: "🔄",
    end: "🏁",
    upload: "⬆️",
    download: "⬇️",
    cleanup: "🧹",
    snapshot: "📸",
    encrypt: "🔐",
    decrypt: "🔓",
    progress: "📊",
    time: "⏰",
    wait: "⏳",
    pause: "⏸️",
    resume: "▶️",
    visibility: "👁️",
    active: "📱",
    calendar: "📅",
    tag: "🏷️",
    stop: "🛑",
    skip: "⏩",
  };

  const icon = icons[type] || "ℹ️";
  const logMessage = `${icon} [${timestamp}] ${message}`;

  if (/Mobi|Android/i.test(navigator.userAgent)) {
    const container =
      document.getElementById("mobile-log-container") ||
      createMobileLogContainer();
    const logsContent = container.querySelector("#logs-content");
    if (logsContent) {
      const logEntry = document.createElement("div");
      logEntry.className = "text-sm mb-1 break-words";
      logEntry.textContent = logMessage;

      if (data) {
        const dataEntry = document.createElement("div");
        dataEntry.className = "text-xs text-gray-500 ml-4 mb-2";
        dataEntry.textContent = JSON.stringify(data, null, 2);
        logEntry.appendChild(dataEntry);
      }

      const isAtBottom =
        logsContent.scrollHeight -
          logsContent.scrollTop -
          logsContent.clientHeight <
        50;

      logsContent.insertBefore(logEntry, logsContent.firstChild);

      if (isAtBottom) {
        logsContent.scrollTop = 0;
      }
    }
  }

  switch (type) {
    case "error":
      console.error(logMessage, data);
      break;
    case "warning":
      console.warn(logMessage, data);
      break;
    default:
      console.log(logMessage, data);
  }
}

function createMobileLogContainer() {
  const container = document.createElement("div");
  container.id = "mobile-log-container";
  container.className =
    "fixed bottom-0 left-0 right-0 bg-black bg-opacity-75 text-white z-[9999]";
  container.style.cssText = `
        height: 200px;
        max-height: 50vh;
        display: ${isConsoleLoggingEnabled ? "block" : "none"};
        resize: vertical;
        overflow-y: auto;
    `;

  const minimizedTag = document.createElement("div");
  minimizedTag.id = "minimized-log-tag";
  minimizedTag.className =
    "fixed bottom-0 right-0 bg-black bg-opacity-75 text-white px-3 py-1 m-2 rounded cursor-pointer z-[9999] hidden";
  minimizedTag.innerHTML = "📋 Show Logs";
  minimizedTag.onclick = () => {
    container.style.display = "block";
    minimizedTag.style.display = "none";
  };
  document.body.appendChild(minimizedTag);

  const header = document.createElement("div");
  header.className =
    "sticky top-0 left-0 right-0 bg-gray-800 p-2 flex justify-between items-center border-b border-gray-700";

  const title = document.createElement("span");
  title.textContent = "Debug Logs";
  title.className = "text-sm font-medium";

  const controls = document.createElement("div");
  controls.className = "flex items-center gap-2";

  const minimizeBtn = document.createElement("button");
  minimizeBtn.className = "text-white p-1 hover:bg-gray-700 rounded text-sm";
  minimizeBtn.textContent = "—";
  minimizeBtn.onclick = () => {
    container.style.display = "none";
    minimizedTag.style.display = "block";
  };

  const clearBtn = document.createElement("button");
  clearBtn.className = "text-white p-1 hover:bg-gray-700 rounded text-sm";
  clearBtn.textContent = "Clear";
  clearBtn.onclick = () => {
    const logsContainer = container.querySelector("#logs-content");
    if (logsContainer) logsContainer.innerHTML = "";
  };

  const exportBtn = document.createElement("button");
  exportBtn.className = "text-white p-1 hover:bg-gray-700 rounded text-sm";
  exportBtn.textContent = "Export";
  exportBtn.onclick = () => {
    const logsContainer = container.querySelector("#logs-content");
    if (logsContainer) {
      const logs = Array.from(logsContainer.children)
        .map((log) => {
          const mainText = log.childNodes[0]?.textContent || "";
          const dataNode = log.querySelector(".text-xs");
          return dataNode
            ? `${mainText}\n${dataNode.textContent}\n`
            : `${mainText}\n`;
        })
        .join("\n");

      const blob = new Blob([logs], { type: "text/plain" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `typingmind-logs-${new Date()
        .toISOString()
        .slice(0, 19)
        .replace(/:/g, "-")}.txt`;
      a.style.display = "none";
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }, 100);
    }
  };

  const toggleSize = document.createElement("button");
  toggleSize.className = "text-white p-1 hover:bg-gray-700 rounded";
  toggleSize.innerHTML = "□";
  toggleSize.onclick = () => {
    if (container.style.height === "200px") {
      container.style.position = "fixed";
      container.style.top = "0";
      container.style.left = "0";
      container.style.right = "0";
      container.style.bottom = "0";
      container.style.height = "100vh";
      container.style.maxHeight = "100vh";
      container.style.zIndex = "99999";
      logsContent.style.height = "calc(100vh - 36px)";
      toggleSize.innerHTML = "▢";
    } else {
      container.style.position = "fixed";
      container.style.top = "auto";
      container.style.left = "0";
      container.style.right = "0";
      container.style.bottom = "0";
      container.style.height = "200px";
      container.style.maxHeight = "50vh";
      logsContent.style.height = "calc(100% - 36px)";
      toggleSize.innerHTML = "□";
    }
  };

  const closeBtn = document.createElement("button");
  closeBtn.className = "text-white p-1 hover:bg-gray-700 rounded";
  closeBtn.innerHTML = "✕";
  closeBtn.onclick = () => {
    container.style.display = "none";
    minimizedTag.style.display = "none";
    const toggle = document.getElementById("console-logging-toggle");
    if (toggle) toggle.checked = false;
    isConsoleLoggingEnabled = false;
  };

  controls.appendChild(clearBtn);
  controls.appendChild(exportBtn);
  controls.appendChild(minimizeBtn);
  controls.appendChild(toggleSize);
  controls.appendChild(closeBtn);

  const dragHandle = document.createElement("div");
  dragHandle.className =
    "absolute -top-1 left-0 right-0 h-1 bg-gray-600 cursor-row-resize";
  dragHandle.style.cursor = "row-resize";

  const logsContent = document.createElement("div");
  logsContent.id = "logs-content";
  logsContent.className = "p-2 overflow-y-auto";
  logsContent.style.height = "calc(100% - 36px)";

  header.appendChild(title);
  header.appendChild(controls);

  container.appendChild(dragHandle);
  container.appendChild(header);
  container.appendChild(logsContent);

  let startY = 0;
  let startHeight = 0;

  function initDrag(e) {
    startY = e.type === "mousedown" ? e.clientY : e.touches[0].clientY;
    startHeight = parseInt(
      document.defaultView.getComputedStyle(container).height,
      10
    );

    document.documentElement.addEventListener("mousemove", doDrag);
    document.documentElement.addEventListener("mouseup", stopDrag);
    document.documentElement.addEventListener("touchmove", doDrag);
    document.documentElement.addEventListener("touchend", stopDrag);
  }

  function doDrag(e) {
    const currentY = e.type === "mousemove" ? e.clientY : e.touches[0].clientY;
    const newHeight = startHeight - (currentY - startY);

    const minHeight = 100;
    const maxHeight = window.innerHeight * 0.8;

    if (newHeight > minHeight && newHeight < maxHeight) {
      container.style.height = `${newHeight}px`;
    }
  }

  function stopDrag() {
    document.documentElement.removeEventListener("mousemove", doDrag);
    document.documentElement.removeEventListener("mouseup", stopDrag);
    document.documentElement.removeEventListener("touchmove", doDrag);
    document.documentElement.removeEventListener("touchend", stopDrag);
  }

  dragHandle.addEventListener("mousedown", initDrag);
  dragHandle.addEventListener("touchstart", initDrag);

  document.body.appendChild(container);

  return container;
}

function logToConsole(type, message, data = null) {
  if (!isConsoleLoggingEnabled) return;

  const timestamp = new Date().toISOString();
  const icons = {
    info: "ℹ️",
    success: "✅",
    warning: "⚠️",
    error: "❌",
    start: "🔄",
    end: "🏁",
    upload: "⬆️",
    download: "⬇️",
    cleanup: "🧹",
    snapshot: "📸",
    encrypt: "🔐",
    decrypt: "🔓",
    progress: "📊",
    time: "⏰",
    wait: "⏳",
    pause: "⏸️",
    resume: "▶️",
    visibility: "👁️",
    active: "📱",
    calendar: "📅",
    tag: "🏷️",
    stop: "🛑",
    skip: "⏩",
  };

  const icon = icons[type] || "ℹ️";
  const logMessage = `${icon} [${timestamp}] ${message}`;

  if (/Mobi|Android/i.test(navigator.userAgent)) {
    const container =
      document.getElementById("mobile-log-container") ||
      createMobileLogContainer();
    const logsContent = container.querySelector("#logs-content");
    if (logsContent) {
      const logEntry = document.createElement("div");
      logEntry.className = "text-sm mb-1 break-words";
      logEntry.textContent = logMessage;

      if (data) {
        const dataEntry = document.createElement("div");
        dataEntry.className = "text-xs text-gray-500 ml-4 mb-2";
        dataEntry.textContent = JSON.stringify(data, null, 2);
        logEntry.appendChild(dataEntry);
      }

      logsContent.appendChild(logEntry);
    }
  }

  switch (type) {
    case "error":
      console.error(logMessage, data);
      break;
    case "warning":
      console.warn(logMessage, data);
      break;
    default:
      console.log(logMessage, data);
  }
}

function showInfoModal(title, content) {
  const infoModal = document.createElement("div");
  infoModal.className =
    "fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[999] p-4";

  const safeContent = content
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
    .replace(/<br\/><br\/>/g, "<br/><br/>");

  infoModal.innerHTML = `
        <div class="bg-white dark:bg-zinc-900 rounded-lg w-full max-w-lg">
            <div class="p-4 border-b border-gray-200 dark:border-gray-700">
                <h3 class="text-lg font-semibold text-gray-900 dark:text-white">${title}</h3>
            </div>
            <div class="p-4 text-sm text-gray-600 dark:text-gray-300 leading-relaxed">
                ${safeContent}
            </div>
            <div class="p-4 border-t border-gray-200 dark:border-gray-700 flex justify-end">
                <button class="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700">Close</button>
            </div>
        </div>
    `;

  document.body.appendChild(infoModal);

  infoModal.addEventListener("click", (e) => {
    if (e.target === infoModal || e.target.closest("button")) {
      infoModal.remove();
    }
  });
}

const hintCustomStyles = document.createElement("style");
hintCustomStyles.textContent = `
    [class*="hint--"][aria-label]:after {
        white-space: pre-wrap;
        max-width: 300px;
        word-wrap: break-word;
        line-height: 1.4;
        padding: 8px 10px;
    }
    .hint--medium:after {
        width: 250px;
    }
    .hint--large:after {
        width: 350px;
    }
    .hint--left:after {
        margin-right: 10px;
    }
    .hint--bottom:after {
        margin-top: 6px;
    }
`;
document.head.appendChild(hintCustomStyles);

function getShouldAlertOnSmallerCloud() {
  return localStorage.getItem("alert-smaller-cloud") === "true";
}

function resetSizes() {
  cloudFileSize = 0;
  localFileSize = 0;
}

const originalSetItem = localStorage.setItem;
localStorage.setItem = function (key, value) {
  const preserveKeys = [
    "import-size-threshold",
    "export-size-threshold",
    "alert-smaller-cloud",
    "encryption-key",
    "aws-bucket",
    "aws-access-key",
    "aws-secret-key",
    "aws-region",
    "aws-endpoint",
    "backup-interval",
    "sync-mode",
    "sync-status-hidden",
    "sync-status-position",
    "activeTabBackupRunning",
    "last-time-based-backup",
    "last-daily-backup-in-s3",
    "last-cloud-sync",
  ];

  if (!preserveKeys.includes(key)) {
    isLocalDataModified = true;
    updateSyncStatus();
  }
  originalSetItem.apply(this, arguments);
};
