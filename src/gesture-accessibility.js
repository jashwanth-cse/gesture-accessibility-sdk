(function (window) {
  const GestureAccessibility = {};
  let config = {};
  let lastGesture = null;
  let lastSentTime = 0;

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
  const INACTIVITY_TIMEOUT = 30000; // 30 seconds

  // Scroll fallback state
  let lastHandY = null;
  const SCROLL_THRESHOLD = 0.03;
  const SCROLL_FACTOR = 500;

  /* ================= INIT ================= */

  GestureAccessibility.init = function (options) {
    config = {
      apiUrl: options.apiUrl,
      siteId: options.siteId,
      apiKey: options.apiKey, // NEW: Store API key from options
      debug: options.debug || false,
      cooldown: 800
    };

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      log("Camera not supported");
      return;
    }

    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", loadMediaPipe);
    } else {
      loadMediaPipe();
    }

    // Fetch config asynchronously (non-blocking)
    fetchSiteConfig(config.apiUrl, config.siteId, config.apiKey);
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
    }
  }

  /* ================= CAMERA ================= */

  function startCamera() {
    const video = document.createElement("video");
    video.style.display = "none";
    document.body.appendChild(video);

    navigator.mediaDevices.getUserMedia({ video: true }).then(stream => {
      video.srcObject = stream;
      video.play();
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

      // 3. Scroll Check (Prevents Drift)
      const SCROLL_SPEED = siteConfig.scroll_speed;
      if (isTwoFingers) {
        lastCursorActivity = now; // Update activity timestamp
        window.scrollBy({ top: -SCROLL_SPEED, behavior: "auto" }); // Scroll Up
        return;
      }
      if (isRockGesture) {
        lastCursorActivity = now; // Update activity timestamp
        window.scrollBy({ top: SCROLL_SPEED, behavior: "auto" }); // Scroll Down
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
    Object.assign(cursorElement.style, {
      position: "fixed",
      width: "24px",
      height: "24px",
      borderRadius: "50%",
      background: "linear-gradient(135deg, rgba(102, 126, 234, 0.8) 0%, rgba(118, 75, 162, 0.8) 100%)",
      backdropFilter: "blur(8px)",
      border: "2px solid rgba(255, 255, 255, 0.6)",
      boxShadow: "0 4px 12px rgba(102, 126, 234, 0.4), 0 0 0 1px rgba(255, 255, 255, 0.2)",
      pointerEvents: "none",
      zIndex: "999999",
      display: "none",
      transform: "translate(-50%, -50%)",
      transition: "all 0.1s ease-out"
    });
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
