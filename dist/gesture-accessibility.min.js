(function (window) {
  const GestureAccessibility = {};
  let config = {};
  let lastGesture = null;
  let lastSentTime = 0;

  // SDK State Flags
  let sdkInitialized = false;
  let cameraActive = false;
  let consentModalActive = false;

  // Site Configuration (Defaults)
  let siteConfig = {
    cursor_mode_enabled: false,
    profile: "default",
    cursor_speed: 12,
    scroll_speed: 15,
    enter_hold_ms: 3000,
    exit_hold_ms: 3000,
    click_cooldown_ms: 800
  };

  // Cursor Mode State
  let gestureStartTime = 0;
  let lastGestureState = null;
  let clickCooldown = 0;
  let lastCursorActivity = 0; // Track last interaction for inactivity timeout
  let lastScrollTime = 0; // Scroll throttling
  const INACTIVITY_TIMEOUT = 30000; // 30 seconds
  const SCROLL_THROTTLE_MS = 50; // Minimum time between scroll calls (20 scrolls/sec max)

  // Scroll fallback state
  let lastHandY = null;
  const SCROLL_THRESHOLD = 0.03;
  const SCROLL_FACTOR = 500;

  /* ================= PERMISSION MANAGER ================= */

  const PermissionManager = {
    STORAGE_KEY: 'gesture_accessibility_enabled',
    BLOCKED_KEY: 'gesture_accessibility_blocked',
    DISMISSED_KEY: 'gesture_accessibility_dismissed',

    checkStoredPreference() {
      try {
        return localStorage.getItem(this.STORAGE_KEY) === 'true';
      } catch (e) {
        log('localStorage unavailable', e);
        return false;
      }
    },

    savePreference(enabled) {
      try {
        localStorage.setItem(this.STORAGE_KEY, String(enabled));
      } catch (e) {
        log('Failed to save preference', e);
      }
    },

    isPermissionBlocked() {
      try {
        return localStorage.getItem(this.BLOCKED_KEY) === 'true';
      } catch (e) {
        return false;
      }
    },

    markPermissionBlocked() {
      try {
        localStorage.setItem(this.BLOCKED_KEY, 'true');
      } catch (e) {
        log('Failed to mark permission blocked', e);
      }
    },

    isSessionDismissed() {
      try {
        return sessionStorage.getItem(this.DISMISSED_KEY) === 'true';
      } catch (e) {
        return false;
      }
    },

    markSessionDismissed() {
      try {
        sessionStorage.setItem(this.DISMISSED_KEY, 'true');
      } catch (e) {
        log('Failed to mark session dismissed', e);
      }
    }
  };

  /* ================= CONSENT MODAL ================= */

  let consentModalElement = null;
  let autoCloseTimer = null;

  function createConsentModal() {
    const toast = document.createElement('div');
    toast.id = 'gesture-accessibility-consent-toast';
    toast.setAttribute('role', 'dialog');
    toast.setAttribute('aria-labelledby', 'ga-toast-title');
    toast.setAttribute('aria-modal', 'true');

    toast.innerHTML = `
      <div class="ga-toast-content">
        <div id="ga-toast-title" class="ga-toast-title">ENABLE GESTURE CONTROL?</div>
        <div class="ga-toast-actions">
          <button id="ga-enable-btn" class="ga-toast-btn ga-toast-btn-yes">YES</button>
          <button id="ga-cancel-btn" class="ga-toast-btn ga-toast-btn-no">NO</button>
        </div>
      </div>
    `;

    // Inject styles
    const style = document.createElement('style');
    style.textContent = `
      #gesture-accessibility-consent-toast {
        position: fixed;
        bottom: 30px;
        right: 30px;
        z-index: 999998;
        font-family: 'Courier New', Courier, monospace;
        animation: ga-toast-slide-in 0.3s ease-out;
      }
      @keyframes ga-toast-slide-in {
        from {
          opacity: 0;
          transform: translateX(100px);
        }
        to {
          opacity: 1;
          transform: translateX(0);
        }
      }
      .ga-toast-content {
        background: rgba(0, 0, 0, 0.9) !important;
        border: 2px solid rgba(255, 255, 255, 0.3) !important;
        border-radius: 4px !important;
        padding: 20px 24px !important;
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5) !important;
        min-width: 280px !important;
        max-width: 320px !important;
        margin: 0 !important;
        display: block !important;
      }
      .ga-toast-title {
        color: #ffffff !important;
        font-size: 14px !important;
        font-weight: bold !important;
        letter-spacing: 1px !important;
        margin: 0 0 16px 0 !important;
        padding: 0 !important;
        text-align: center !important;
        text-transform: uppercase !important;
        line-height: 1.4 !important;
        display: block !important;
      }
      .ga-toast-actions {
        display: flex !important;
        gap: 12px !important;
        justify-content: center !important;
        margin: 0 !important;
        padding: 0 !important;
      }
      .ga-toast-btn {
        background: transparent !important;
        border: 2px solid rgba(255, 255, 255, 0.4) !important;
        color: #ffffff !important;
        padding: 8px 24px !important;
        margin: 0 !important;
        font-family: 'Courier New', Courier, monospace !important;
        font-size: 13px !important;
        font-weight: bold !important;
        letter-spacing: 1px !important;
        cursor: pointer !important;
        transition: all 0.15s ease !important;
        border-radius: 2px !important;
        text-transform: uppercase !important;
        line-height: normal !important;
        display: inline-block !important;
        width: auto !important;
        height: auto !important;
        min-width: 80px !important;
        box-sizing: border-box !important;
      }
      .ga-toast-btn:hover {
        background: rgba(255, 255, 255, 0.1) !important;
        border-color: rgba(255, 255, 255, 0.8) !important;
      }
      .ga-toast-btn-yes:hover {
        background: rgba(0, 255, 0, 0.15) !important;
        border-color: #00ff00 !important;
        color: #00ff00 !important;
      }
      .ga-toast-btn-no:hover {
        background: rgba(255, 0, 0, 0.15) !important;
        border-color: #ff0000 !important;
        color: #ff0000 !important;
      }
      @media (max-width: 480px) {
        #gesture-accessibility-consent-toast {
          bottom: 20px;
          right: 20px;
          left: 20px;
        }
        .ga-toast-content {
          min-width: auto;
          padding: 16px 20px;
        }
        .ga-toast-title {
          font-size: 12px;
        }
        .ga-toast-btn {
          font-size: 12px;
          padding: 8px 20px;
        }
      }
    `; // Inject styles - handle edge case where head doesn't exist yet
    const injectStyle = () => {
      const targetElement = document.head || document.getElementsByTagName('head')[0] || document.documentElement;
      if (targetElement) {
        targetElement.appendChild(style);
      } else {
        // Fallback: wait for DOM
        setTimeout(injectStyle, 10);
      }
    };
    injectStyle();

    return toast;
  }

  function showConsentModal() {
    if (consentModalActive) return;
    consentModalActive = true;

    consentModalElement = createConsentModal();
    document.body.appendChild(consentModalElement);

    // Event handlers
    const enableBtn = document.getElementById('ga-enable-btn');
    const cancelBtn = document.getElementById('ga-cancel-btn');

    enableBtn.addEventListener('click', handleEnableClick);
    cancelBtn.addEventListener('click', handleCancelClick);

    // Auto-close after 15 seconds
    autoCloseTimer = setTimeout(() => {
      log('Consent modal auto-closed after 15 seconds');
      removeConsentModal();
    }, 15000);
  }

  function handleEnableClick() {
    clearTimeout(autoCloseTimer);
    PermissionManager.savePreference(true);
    removeConsentModal();
    GestureAccessibility.start();
  }

  function handleCancelClick() {
    clearTimeout(autoCloseTimer);
    PermissionManager.markSessionDismissed();
    removeConsentModal();
  }

  function removeConsentModal() {
    if (consentModalElement) {
      consentModalElement.remove();
      consentModalElement = null;
    }
    consentModalActive = false;
    clearTimeout(autoCloseTimer);
  }

  /* ================= INITIALIZATION FLOW ================= */

  function initializeConsentFlow() {
    // Check if user already enabled
    if (PermissionManager.checkStoredPreference()) {
      log('Auto-starting: User previously enabled');
      GestureAccessibility.start();
      return;
    }

    // Check if permission was previously blocked
    if (PermissionManager.isPermissionBlocked()) {
      log('Camera permission blocked. Feature disabled.');
      return;
    }

    // Check if dismissed this session
    if (PermissionManager.isSessionDismissed()) {
      log('Consent dismissed this session');
      return;
    }

    // Show consent modal
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', showConsentModal);
    } else {
      showConsentModal();
    }
  }

  /* ================= DEVICE DETECTION ================= */

  function isMobileOrTablet() {
    // Check user agent for mobile/tablet indicators
    const userAgent = navigator.userAgent || navigator.vendor || window.opera;

    // Mobile regex pattern (covers iOS, Android, Windows Phone, etc.)
    const mobileRegex = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile|mobile|CriOS/i;

    // Touch-only devices (tablets without mouse)
    const isTouchOnly = ('ontouchstart' in window || navigator.maxTouchPoints > 0) &&
      !window.matchMedia('(pointer: fine)').matches;

    // Small screen check (most tablets are > 768px, but still good to check)
    const isSmallScreen = window.innerWidth < 1024;

    return mobileRegex.test(userAgent) || (isTouchOnly && isSmallScreen);
  }

  /* ================= INIT ================= */

  GestureAccessibility.init = function (options) {
    if (sdkInitialized) {
      log('SDK already initialized');
      return;
    }

    config = {
      apiUrl: options.apiUrl,
      siteId: options.siteId,
      apiKey: options.apiKey, // NEW: Store API key from options
      debug: options.debug || false,
      cooldown: 800
    };

    // Early exit for mobile/tablet devices
    if (isMobileOrTablet()) {
      if (config.debug) {
        console.log('[GestureAccessibility] Mobile/tablet detected. Gesture control not supported on this device.');
      }
      return;
    }

    sdkInitialized = true;

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      log("Camera not supported");
      return;
    }

    // Fetch config asynchronously (non-blocking)
    fetchSiteConfig(config.apiUrl, config.siteId, config.apiKey);

    // Initialize consent flow
    initializeConsentFlow();
  };

  /* ================= START (NEW PUBLIC METHOD) ================= */

  GestureAccessibility.start = async function () {
    if (cameraActive) {
      log('Camera already active');
      return;
    }

    if (!sdkInitialized) {
      log('SDK not initialized. Call init() first.');
      return;
    }

    try {
      await loadMediaPipe();
      cameraActive = true;
      log('Gesture Accessibility started');
    } catch (e) {
      console.error('Failed to start Gesture Accessibility', e);
      PermissionManager.markPermissionBlocked();
    }
  };

  async function fetchSiteConfig(apiUrl, siteId, apiKey) {
    if (!apiUrl || !siteId) return;
    try {
      // NEW: Use MVP contract endpoint with query parameter
      // Build headers with API key if provided
      const headers = {};
      if (apiKey) {
        headers['x-api-key'] = apiKey;
      }

      const res = await fetch(`${apiUrl}/api/accessibility/config?siteId=${siteId}`, {
        headers: headers
      });
      if (res.ok) {
        // NEW: Response is now direct config object (no wrapper)
        const data = await res.json();

        // Map backend field names to SDK expectations
        // Backend uses: accessibility_profile, cursor_speed, scroll_speed, etc.
        // SDK uses: profile, cursor_speed, scroll_speed, etc.

        // Map backend fields to SDK config
        // Backend should return full config with profile defaults already applied
        if (data.accessibility_profile) siteConfig.profile = data.accessibility_profile;
        if (typeof data.cursor_mode_enabled === "boolean") siteConfig.cursor_mode_enabled = data.cursor_mode_enabled;

        // Direct field mapping (convert to numbers if provided)
        if (data.cursor_speed !== undefined && data.cursor_speed !== null) {
          siteConfig.cursor_speed = Number(data.cursor_speed);
        }
        if (data.scroll_speed !== undefined && data.scroll_speed !== null) {
          siteConfig.scroll_speed = Number(data.scroll_speed);
        }
        if (data.enter_hold_ms !== undefined && data.enter_hold_ms !== null) {
          siteConfig.enter_hold_ms = Number(data.enter_hold_ms);
        }
        if (data.exit_hold_ms !== undefined && data.exit_hold_ms !== null) {
          siteConfig.exit_hold_ms = Number(data.exit_hold_ms);
        }
        if (data.click_cooldown_ms !== undefined && data.click_cooldown_ms !== null) {
          siteConfig.click_cooldown_ms = Number(data.click_cooldown_ms);
        }

        // Safety validation & clamping (using nullish coalescing)
        siteConfig.cursor_speed = Math.max(1, Math.min(50, siteConfig.cursor_speed ?? 12));
        siteConfig.scroll_speed = Math.max(1, Math.min(100, siteConfig.scroll_speed ?? 15));
        siteConfig.enter_hold_ms = Math.max(500, siteConfig.enter_hold_ms ?? 3000);
        siteConfig.exit_hold_ms = Math.max(500, siteConfig.exit_hold_ms ?? 3000);
        siteConfig.click_cooldown_ms = Math.max(200, siteConfig.click_cooldown_ms ?? 800);

        if (typeof siteConfig.cursor_mode_enabled !== "boolean") {
          siteConfig.cursor_mode_enabled = false; // Safe default
        }

        log("Site config loaded", siteConfig);

        // Freeze config to prevent mutations after init
        Object.freeze(siteConfig);
      } else {
        log("Failed to load site config (Status " + res.status + "), using defaults");
        // Freeze defaults too
        Object.freeze(siteConfig);
      }
    } catch (e) {
      log("Error fetching site config", e);
      // Freeze defaults on error too
      Object.freeze(siteConfig);
    }
  }

  /* ================= LOG ================= */

  function log(...args) {
    if (config.debug) console.log("[GestureAccessibility]", ...args);
  }

  /* ================= SCRIPT LOADER ================= */

  function loadScriptAsync(src) {
    return new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = src;
      script.async = true;
      script.onload = resolve;
      script.onerror = reject;
      (document.body || document.head).appendChild(script);
    });
  }

  /* ================= MEDIAPIPE LOADER ================= */

  async function loadMediaPipe() {
    try {
      await loadScriptAsync("https://cdn.jsdelivr.net/npm/@mediapipe/hands/hands.js");
      await loadScriptAsync("https://cdn.jsdelivr.net/npm/@mediapipe/camera_utils/camera_utils.js");
      startCamera();
    } catch (e) {
      console.error("Failed to load MediaPipe", e);
      throw e;
    }
  }

  /* ================= CAMERA ================= */

  function startCamera() {
    const video = document.createElement("video");
    video.style.display = "none";
    document.body.appendChild(video);

    navigator.mediaDevices.getUserMedia({ video: true })
      .then(stream => {
        video.srcObject = stream;
        video.play();
      })
      .catch(error => {
        log("Camera access denied:", error);
        PermissionManager.markPermissionBlocked();

        if (config.debug) {
          console.warn('[GestureAccessibility] Camera permission denied. Feature disabled.');
        }

        cameraActive = false;
        return;
      });

    const hands = new Hands({
      locateFile: f => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${f}`
    });

    hands.setOptions({
      maxNumHands: 1,
      modelComplexity: 0,
      minDetectionConfidence: 0.7,
      minTrackingConfidence: 0.7
    });

    hands.onResults(onResults);

    const camera = new Camera(video, {
      onFrame: async () => await hands.send({ image: video }),
      width: 640,
      height: 480
    });

    setTimeout(() => camera.start(), 300);
  }

  /* ================= GESTURE LOGIC ================= */

  function onResults(results) {
    if (!results.multiHandLandmarks?.length) return;

    const lm = results.multiHandLandmarks[0];
    const thumb = lm[4];
    const index = lm[8];
    const middle = lm[12];
    const ring = lm[16];
    const pinky = lm[20];

    const isIndexOpen = index.y < lm[6].y;
    const isMiddleOpen = middle.y < lm[10].y;
    const isRingOpen = ring.y < lm[14].y;
    const isPinkyOpen = pinky.y < lm[18].y;

    const isFingersOpen = isIndexOpen && isMiddleOpen && isRingOpen && isPinkyOpen;
    const isTwoFingers = isIndexOpen && isMiddleOpen && !isRingOpen && !isPinkyOpen;
    const isThreeFingers = isIndexOpen && isMiddleOpen && isRingOpen && !isPinkyOpen;
    const isRockGesture = isIndexOpen && !isMiddleOpen && !isRingOpen && isPinkyOpen;

    const isPinch =
      Math.abs(thumb.x - index.x) < 0.05 &&
      Math.abs(thumb.y - index.y) < 0.05;

    const isFist =
      !isFingersOpen &&
      !isPinch &&
      middle.y > lm[10].y &&
      ring.y > lm[14].y &&
      pinky.y > lm[18].y;

    let currentGesture = null;
    if (isPinch) currentGesture = "pinch";
    else if (isFingersOpen) currentGesture = "open_palm";
    else if (isFist) currentGesture = "fist";

    const now = Date.now();

    // Global State Tracking
    if (currentGesture !== lastGestureState) {
      gestureStartTime = now;
      lastGestureState = currentGesture;
    }
    const holdDuration = now - gestureStartTime;

    /* ================= CURSOR MODE ================= */
    if (cursorModeActive) {
      // Inactivity Timeout Check
      if (now - lastCursorActivity > INACTIVITY_TIMEOUT) {
        exitCursorMode("inactivity");
        lastHandY = null;
        return;
      }
      // 1. Exit Check (Highest Priority)
      // Freeze cursor while holding Fist.
      if (currentGesture === "fist") {
        if (holdDuration > siteConfig.exit_hold_ms) {
          exitCursorMode("gesture");
          lastHandY = null;
        }
        return;
      }

      // 2. Click Check (Prevents Drift)
      if (currentGesture === "pinch") {
        if (now - clickCooldown > siteConfig.click_cooldown_ms) {
          clickCooldown = now;
          lastCursorActivity = now; // Update activity timestamp
          document.elementFromPoint(cursorX, cursorY)?.click();
        }
        return;
      }

      // 3. Scroll Check (Prevents Drift) - WITH THROTTLING
      const SCROLL_SPEED = siteConfig.scroll_speed;

      // Throttle scroll calls to prevent lag (max 20 scrolls/sec)
      const canScroll = (now - lastScrollTime) > SCROLL_THROTTLE_MS;

      if (isTwoFingers && canScroll) {
        lastCursorActivity = now; // Update activity timestamp
        lastScrollTime = now; // Update scroll throttle
        window.scrollBy({ top: -SCROLL_SPEED, behavior: "smooth" }); // Scroll Up (smooth!)
        return;
      }
      if (isRockGesture && canScroll) {
        lastCursorActivity = now; // Update activity timestamp
        lastScrollTime = now; // Update scroll throttle
        window.scrollBy({ top: SCROLL_SPEED, behavior: "smooth" }); // Scroll Down (smooth!)
        return;
      }

      // If gesture detected but throttled, still return to prevent cursor drift
      if (isTwoFingers || isRockGesture) {
        lastCursorActivity = now; // Keep activity alive
        return;
      }

      // Relative Drift Logic (Joystick)
      const normX = 1 - index.x; // Mirror X
      const normY = index.y;

      const dx = normX - 0.5;
      const dy = normY - 0.5;
      const DEADZONE = 0.05; // Center 10%
      const SPEED = siteConfig.cursor_speed;

      if (Math.abs(dx) > DEADZONE) {
        cursorX += Math.sign(dx) * SPEED;
      }
      if (Math.abs(dy) > DEADZONE) {
        cursorY += Math.sign(dy) * SPEED;
      }

      // Clamp to screen
      cursorX = Math.max(0, Math.min(window.innerWidth, cursorX));
      cursorY = Math.max(0, Math.min(window.innerHeight, cursorY));

      const x = cursorX;
      const y = cursorY;

      moveCursor(x, y);

      // Update activity timestamp - hand is present
      lastCursorActivity = now;

      return;
    }

    /* ================= MODE ENTRY ================= */
    lastHandY = null;

    // Enter (Hold Open Palm 3s)
    if (currentGesture === "open_palm" && siteConfig.cursor_mode_enabled && holdDuration > siteConfig.enter_hold_ms) {
      enterCursorMode();
      return;
    }

    /* ================= NORMAL NAVIGATION ================= */
    // Backend gestures disabled to avoid conflicts with cursor mode
    // When cursor mode is active, it handles all interactions internally
    // When cursor mode is inactive, only the entry gesture is monitored
  }

  /* ================= API ================= */

  async function sendGesture(gesture) {
    const now = Date.now();
    if (gesture === lastGesture && now - lastSentTime < config.cooldown) return;
    lastGesture = gesture;
    lastSentTime = now;

    const res = await fetch(`${config.apiUrl}/api/v1/gesture/evaluate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        site_id: config.siteId,
        gesture,
        confidence: 0.9
      })
    });

    const data = await res.json();
    if (data.execute) runAction(data.action);
  }

  function runAction(action) {
    if (action === "scroll_down") window.scrollBy({ top: 250, behavior: "smooth" });
    if (action === "scroll_up") window.scrollBy({ top: -250, behavior: "smooth" });
  }

  /* ================= VIRTUAL CURSOR ================= */

  let cursorElement = null;
  let cursorModeActive = false;
  let cursorX = 0;
  let cursorY = 0;

  function createCursor() {
    if (cursorElement) return;
    cursorElement = document.createElement("div");
    cursorElement.id = "gesture-cursor";

    // Create inner crosshair element
    const crosshair = document.createElement("div");
    crosshair.className = "gesture-cursor-crosshair";
    cursorElement.appendChild(crosshair);

    // Gaming-style cursor with neon green glow
    Object.assign(cursorElement.style, {
      position: "fixed",
      width: "40px",
      height: "40px",
      borderRadius: "50%",
      background: "rgba(0, 0, 0, 0.8)",
      border: "3px solid #00ff00",
      boxShadow: "0 0 20px rgba(0, 255, 0, 0.6), 0 0 40px rgba(0, 255, 0, 0.3), inset 0 0 10px rgba(0, 255, 0, 0.2)",
      pointerEvents: "none",
      zIndex: "999999",
      display: "none",
      transform: "translate(-50%, -50%)",
      transition: "all 0.05s ease-out"
    });

    // Crosshair styling (targeting reticle)
    Object.assign(crosshair.style, {
      position: "absolute",
      top: "50%",
      left: "50%",
      width: "20px",
      height: "20px",
      transform: "translate(-50%, -50%)",
      pointerEvents: "none"
    });

    // Create crosshair lines using pseudo-elements via innerHTML
    crosshair.innerHTML = `
      <svg width="20" height="20" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg">
        <line x1="10" y1="0" x2="10" y2="6" stroke="#00ff00" stroke-width="2"/>
        <line x1="10" y1="14" x2="10" y2="20" stroke="#00ff00" stroke-width="2"/>
        <line x1="0" y1="10" x2="6" y2="10" stroke="#00ff00" stroke-width="2"/>
        <line x1="14" y1="10" x2="20" y2="10" stroke="#00ff00" stroke-width="2"/>
        <circle cx="10" cy="10" r="2" fill="none" stroke="#00ff00" stroke-width="1"/>
      </svg>
    `;

    document.body.appendChild(cursorElement);
  }

  function showCursor() {
    createCursor();
    cursorElement.style.display = "block";
  }

  function hideCursor() {
    if (cursorElement) cursorElement.style.display = "none";
  }

  function moveCursor(x, y) {
    createCursor();
    cursorElement.style.left = x + "px";
    cursorElement.style.top = y + "px";
  }

  function enterCursorMode() {
    cursorModeActive = true;
    cursorX = window.innerWidth / 2;
    cursorY = window.innerHeight / 2;
    lastCursorActivity = Date.now(); // Initialize activity timer
    showCursor();
    moveCursor(cursorX, cursorY);
    log("Cursor mode ON");
  }

  function exitCursorMode(reason = "manual") {
    cursorModeActive = false;
    hideCursor();

    // Reset all cursor mode state
    lastCursorActivity = 0;
    gestureStartTime = 0;
    lastGestureState = null;
    clickCooldown = 0;
    cursorX = 0;
    cursorY = 0;

    log(`Cursor mode OFF (${reason})`);
  }

  /* ================= PUBLIC API ================= */

  /**
   * Enable cursor mode programmatically
   */
  GestureAccessibility.enableCursorMode = function () {
    if (!cursorModeActive) {
      enterCursorMode();
    }
  };

  /**
   * Disable cursor mode programmatically
   */
  GestureAccessibility.disableCursorMode = function () {
    if (cursorModeActive) {
      exitCursorMode("manual");
    }
  };

  /**
   * Toggle cursor mode on/off
   */
  GestureAccessibility.toggleCursorMode = function () {
    if (cursorModeActive) {
      exitCursorMode("manual");
    } else {
      enterCursorMode();
    }
  };

  /**
   * Check if cursor mode is currently active
   * @returns {boolean}
   */
  GestureAccessibility.isCursorModeActive = function () {
    return cursorModeActive;
  };

  window.GestureAccessibility = GestureAccessibility;
})(window);
