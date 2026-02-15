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

  /* ================= TUTORIAL MANAGER ================= */

  const TutorialManager = {
    STORAGE_KEY: 'gesture_tutorial_seen',

    hasSeenTutorial() {
      try {
        return localStorage.getItem(this.STORAGE_KEY) === 'true';
      } catch (e) {
        log('localStorage unavailable for tutorial', e);
        return false;
      }
    },

    markTutorialSeen() {
      try {
        localStorage.setItem(this.STORAGE_KEY, 'true');
      } catch (e) {
        log('Failed to mark tutorial as seen', e);
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

    // Start camera and show tutorial if first time
    GestureAccessibility.start().then(() => {
      if (!TutorialManager.hasSeenTutorial()) {
        showTutorial();
        TutorialManager.markTutorialSeen();
      }
    }).catch(err => {
      log('Failed to start SDK', err);
    });
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

  /* ================= TUTORIAL OVERLAY ================= */

  let tutorialElement = null;
  let currentTutorialFrame = 0;
  let tutorialAutoAdvanceTimer = null;
  const TUTORIAL_FRAME_DURATION = 3000; // 3 seconds per frame
  const TUTORIAL_FRAMES = [
    {
      title: "Enter Cursor Mode",
      instruction: "Open palm and hold for 3 seconds",
      svg: `<svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
        <g>
          <!-- Palm -->
          <ellipse cx="100" cy="140" rx="35" ry="45" fill="#00ff00" opacity="0.8" stroke="#059669" stroke-width="2"/>
          <!-- Thumb -->
          <path d="M75 120 Q65 110 65 95 L65 75 Q65 68 70 68 Q75 68 75 75 L75 110 Z" fill="#00ff00" opacity="0.8" stroke="#059669" stroke-width="2"/>
          <!-- Index finger -->
          <path d="M85 95 L85 50 Q85 42 90 42 Q95 42 95 50 L95 95 Z" fill="#00ff00" opacity="0.8" stroke="#059669" stroke-width="2"/>
          <!-- Middle finger (longest) -->
          <path d="M100 95 L100 40 Q100 32 105 32 Q110 32 110 40 L110 95 Z" fill="#00ff00" opacity="0.8" stroke="#059669" stroke-width="2"/>
          <!-- Ring finger -->
          <path d="M115 95 L115 50 Q115 42 120 42 Q125 42 125 50 L125 95 Z" fill="#00ff00" opacity="0.8" stroke="#059669" stroke-width="2"/>
          <!-- Pinky -->
          <path d="M130 105 L130 65 Q130 57 135 57 Q140 57 140 65 L140 105 Z" fill="#00ff00" opacity="0.8" stroke="#059669" stroke-width="2"/>
          <!-- Glow animation -->
          <ellipse cx="100" cy="110" rx="50" ry="60" fill="none" stroke="#00ff00" stroke-width="2" opacity="0">
            <animate attributeName="opacity" values="0;0.6;0" dur="2s" repeatCount="indefinite"/>
            <animate attributeName="rx" values="50;60;50" dur="2s" repeatCount="indefinite"/>
            <animate attributeName="ry" values="60;70;60" dur="2s" repeatCount="indefinite"/>
          </ellipse>
        </g>
      </svg>`,
      animation: "pulse-animation"
    },
    {
      title: "Move Cursor",
      instruction: "Move your palm to control the cursor",
      svg: `<svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
        <g>
          <animateTransform attributeName="transform" type="translate" values="-15,0; 15,0; -15,0" dur="2.5s" repeatCount="indefinite"/>
          <!-- Palm -->
          <ellipse cx="100" cy="130" rx="32" ry="40" fill="#00ff00" opacity="0.8" stroke="#059669" stroke-width="2"/>
          <!-- Thumb -->
          <path d="M75 110 Q68 105 68 95 L68 80 Q68 73 73 73 Q78 73 78 80 L78 105 Z" fill="#00ff00" opacity="0.8" stroke="#059669" stroke-width="2"/>
          <!-- Fingers -->
          <path d="M88 100 L88 60 Q88 52 93 52 Q98 52 98 60 L98 100 Z" fill="#00ff00" opacity="0.8" stroke="#059669" stroke-width="2"/>
          <path d="M102 100 L102 55 Q102 47 107 47 Q112 47 112 55 L112 100 Z" fill="#00ff00" opacity="0.8" stroke="#059669" stroke-width="2"/>
          <path d="M116 100 L116 60 Q116 52 121 52 Q126 52 126 60 L126 100 Z" fill="#00ff00" opacity="0.8" stroke="#059669" stroke-width="2"/>
          <path d="M130 105 L130 70 Q130 62 135 62 Q140 62 140 70 L140 105 Z" fill="#00ff00" opacity="0.8" stroke="#059669" stroke-width="2"/>
        </g>
        <!-- Moving cursor dot -->
        <circle cx="100" cy="70" r="6" fill="#fbbf24" opacity="0.9">
          <animateTransform attributeName="transform" type="translate" values="-15,0; 15,0; -15,0" dur="2.5s" repeatCount="indefinite"/>
        </circle>
      </svg>`,
      animation: "slide-animation"
    },
    {
      title: "Click",
      instruction: " Pinch 👌 to click",
      svg: `<svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
        <g>
          <!-- Palm base -->
          <ellipse cx="100" cy="145" rx="30" ry="35" fill="#00ff00" opacity="0.8" stroke="#059669" stroke-width="2"/>
          <!-- Thumb (animated) -->
          <path d="M75 130 Q70 120 70 105 L70 85 Q70 78 75 78 Q80 78 80 85 L80 115 Z" fill="#00ff00" opacity="0.8" stroke="#059669" stroke-width="2">
            <animate attributeName="d" values="M75 130 Q70 120 70 105 L70 85 Q70 78 75 78 Q80 78 80 85 L80 115 Z; M85 120 Q88 110 92 100 L95 90 Q95 85 98 85 Q101 85 100 90 L98 110 Z; M75 130 Q70 120 70 105 L70 85 Q70 78 75 78 Q80 78 80 85 L80 115 Z" dur="1.5s" repeatCount="indefinite"/>
          </path>
          <!-- Index finger (animated) -->
          <path d="M125 130 Q130 120 130 105 L130 85 Q130 78 125 78 Q120 78 120 85 L120 115 Z" fill="#00ff00" opacity="0.8" stroke="#059669" stroke-width="2">
            <animate attributeName="d" values="M125 130 Q130 120 130 105 L130 85 Q130 78 125 78 Q120 78 120 85 L120 115 Z; M115 120 Q112 110 108 100 L105 90 Q105 85 102 85 Q99 85 100 90 L102 110 Z; M125 130 Q130 120 130 105 L130 85 Q130 78 125 78 Q120 78 120 85 L120 115 Z" dur="1.5s" repeatCount="indefinite"/>
          </path>
          <!-- Contact spark -->
          <circle cx="100" cy="100" r="6" fill="#fbbf24" opacity="0">
            <animate attributeName="opacity" values="0;1;0.5;1;0" dur="1.5s" repeatCount="indefinite"/>
            <animate attributeName="r" values="3;8;3" dur="1.5s" repeatCount="indefinite"/>
          </circle>
        </g>
      </svg>`,
      animation: "pinch-animation"
    },
    {
      title: "Scroll Down",
      instruction: "Show 🤘 to scroll down",
      svg: `<svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
        <g>
          <!-- Palm -->
          <ellipse cx="100" cy="135" rx="30" ry="38" fill="#00ff00" opacity="0.8" stroke="#059669" stroke-width="2"/>
          <!-- Thumb (tucked) -->
          <path d="M78 115 Q72 110 72 105 L72 95 Q72 90 76 90 Q80 90 80 95 L80 110 Z" fill="#00ff00" opacity="0.8" stroke="#059669" stroke-width="2"/>
          <!-- Index (up) -->
          <path d="M85 100 L85 55 Q85 47 90 47 Q95 47 95 55 L95 100 Z" fill="#00ff00" opacity="0.8" stroke="#059669" stroke-width="2"/>
          <!-- Middle (folded) -->
          <path d="M100 105 L100 95 Q100 90 105 90 Q110 90 110 95 L110 105 Z" fill="#00ff00" opacity="0.8" stroke="#059669" stroke-width="2"/>
          <!-- Ring (folded) -->
          <path d="M115 105 L115 95 Q115 90 120 90 Q125 90 125 95 L125 105 Z" fill="#00ff00" opacity="0.8" stroke="#059669" stroke-width="2"/>
          <!-- Pinky (up) -->
          <path d="M130 100 L130 60 Q130 52 135 52 Q140 52 140 60 L140 100 Z" fill="#00ff00" opacity="0.8" stroke="#059669" stroke-width="2"/>
          <!-- Down arrow -->
          <g transform="translate(100, 165)">
            <animateTransform attributeName="transform" type="translate" values="100,160; 100,170; 100,160" dur="1s" repeatCount="indefinite"/>
            <polygon points="0,0 -8,-12 8,-12" fill="#ff4444"/>
            <line x1="0" y1="-15" x2="0" y2="-25" stroke="#ff4444" stroke-width="4" stroke-linecap="round"/>
          </g>
        </g>
      </svg>`,
      animation: "bounce-animation"
    },
    {
      title: "Scroll Up",
      instruction: "Show ✌️ to scroll up",
      svg: `<svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
        <g>
          <!-- Palm -->
          <ellipse cx="100" cy="135" rx="30" ry="38" fill="#00ff00" opacity="0.8" stroke="#059669" stroke-width="2"/>
          <!-- Thumb (tucked) -->
          <path d="M78 115 Q72 110 72 105 L72 95 Q72 90 76 90 Q80 90 80 95 L80 110 Z" fill="#00ff00" opacity="0.8" stroke="#059669" stroke-width="2"/>
          <!-- Index (up) -->
          <path d="M88 100 L88 50 Q88 42 93 42 Q98 42 98 50 L98 100 Z" fill="#00ff00" opacity="0.8" stroke="#059669" stroke-width="2"/>
          <!-- Middle (up) -->
          <path d="M107 100 L107 55 Q107 47 112 47 Q117 47 117 55 L117 100 Z" fill="#00ff00" opacity="0.8" stroke="#059669" stroke-width="2"/>
          <!-- Ring (folded) -->
          <path d="M118 105 L118 95 Q118 90 123 90 Q128 90 128 95 L128 105 Z" fill="#00ff00" opacity="0.8" stroke="#059669" stroke-width="2"/>
          <!-- Pinky (folded) -->
          <path d="M130 105 L130 95 Q130 90 135 90 Q140 90 140 95 L140 105 Z" fill="#00ff00" opacity="0.8" stroke="#059669" stroke-width="2"/>
          <!-- Up arrow -->
          <g transform="translate(102, 35)">
            <animateTransform attributeName="transform" type="translate" values="102,40; 102,30; 102,40" dur="1s" repeatCount="indefinite"/>
            <polygon points="0,3 -8,15 8,15" fill="#00ff00"/>
            <line x1="0" y1="0" x2="0" y2="-12" stroke="#00ff00" stroke-width="4" stroke-linecap="round"/>
          </g>
        </g>
      </svg>`,
      animation: "bounce-animation"
    },
    {
      title: "Exit Cursor Mode",
      instruction: "Make a fist ✊ to exit",
      svg: `<svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
        <g>
          <!-- Main fist shape -->
          <ellipse cx="100" cy="110" rx="38" ry="45" fill="#00ff00" opacity="0.8" stroke="#059669" stroke-width="3"/>
          <!-- Knuckle lines -->
          <line x1="75" y1="95" x2="125" y2="95" stroke="#065f46" stroke-width="2" opacity="0.5"/>
          <line x1="75" y1="105" x2="125" y2="105" stroke="#065f46" stroke-width="2" opacity="0.5"/>
          <line x1="75" y1="115" x2="125" y2="115" stroke="#065f46" stroke-width="2" opacity="0.5"/>
          <!-- Thumb across front -->
          <ellipse cx="75" cy="125" rx="10" ry="18" fill="#00ff00" opacity="0.8" stroke="#059669" stroke-width="2" transform="rotate(-30 75 125)"/>
          <!-- Pulse glow animation -->
          <ellipse cx="100" cy="110" rx="38" ry="45" fill="none" stroke="#00ff00" stroke-width="2" opacity="0">
            <animate attributeName="opacity" values="0;0.5;0" dur="2s" repeatCount="indefinite"/>
            <animate attributeName="rx" values="38;45;38" dur="2s" repeatCount="indefinite"/>
            <animate attributeName="ry" values="45;52;45" dur="2s" repeatCount="indefinite"/>
          </ellipse>
        </g>
      </svg>`,
      animation: "pulse-animation"
    }
  ];

  function createTutorialOverlay() {
    if (tutorialElement) return;

    tutorialElement = document.createElement('div');
    tutorialElement.id = 'gesture-tutorial-overlay';
    tutorialElement.setAttribute('role', 'dialog');
    tutorialElement.setAttribute('aria-labelledby', 'tutorial-title');

    tutorialElement.innerHTML = `
      <div class="tutorial-backdrop"></div>
      <div class="tutorial-modal">
        <button class="tutorial-skip-btn" id="tutorial-skip">Skip</button>
        <div class="tutorial-content">
          <h2 id="tutorial-title" class="tutorial-title"></h2>
          <div class="tutorial-animation"></div>
          <p class="tutorial-instruction"></p>
          <div class="tutorial-progress"></div>
          <div class="tutorial-actions">
            <button class="tutorial-next-btn" id="tutorial-next">Next</button>
            <button class="tutorial-done-btn" id="tutorial-done" style="display:none;">Got it!</button>
          </div>
        </div>
      </div>
    `;

    // Inject styles
    const style = document.createElement('style');
    style.textContent = `
      #gesture-tutorial-overlay {
        position: fixed !important;
        top: 0 !important;
        left: 0 !important;
        width: 100% !important;
        height: 100% !important;
        z-index: 999999 !important;
        font-family: 'Courier New', Courier, monospace !important;
      }
      .tutorial-backdrop {
        position: absolute !important;
        top: 0 !important;
        left: 0 !important;
        width: 100% !important;
        height: 100% !important;
        background: rgba(0, 0, 0, 0.85) !important;
        backdrop-filter: blur(8px) !important;
      }
      .tutorial-modal {
        position: fixed !important;
        top: 50% !important;
        left: 50% !important;
        transform: translate(-50%, -50%) !important;
        background: rgba(20, 20, 20, 0.98) !important;
        border: 3px solid #00ff00 !important;
        border-radius: 16px !important;
        padding: 24px !important;
        width: 480px !important;
        height: 480px !important;
        max-width: 90vw !important;
        max-height: 90vh !important;
        aspect-ratio: 1 / 1 !important;
        box-shadow: 0 0 40px rgba(0, 255, 0, 0.4), inset 0 0 20px rgba(0, 255, 0, 0.1) !important;
        box-sizing: border-box !important;
        display: flex !important;
        flex-direction: column !important;
        align-items: center !important;
        justify-content: space-between !important;
        z-index: 2147483646 !important;
        margin: 0 !important;
        line-height: 1.5 !important;
        font-family: 'Courier New', Courier, monospace !important;
      }
      .tutorial-skip-btn {
        position: absolute !important;
        top: 16px !important;
        right: 16px !important;
        background: transparent !important;
        border: 2px solid rgba(255, 255, 255, 0.3) !important;
        color: #fff !important;
        padding: 8px 18px !important;
        font-family: 'Courier New', Courier, monospace !important;
        font-size: 13px !important;
        cursor: pointer !important;
        border-radius: 6px !important;
        transition: all 0.2s ease !important;
        text-transform: uppercase !important;
        letter-spacing: 1px !important;
        margin: 0 !important;
        line-height: 1 !important;
        z-index: 10 !important;
      }
      .tutorial-skip-btn:hover {
        border-color: #ff0000 !important;
        color: #ff0000 !important;
        background: rgba(255, 0, 0, 0.1) !important;
      }
      .tutorial-title {
        color: #00ff00 !important;
        font-size: 22px !important;
        font-weight: bold !important;
        text-align: center !important;
        margin: 12px 0 0 0 !important;
        text-transform: uppercase !important;
        letter-spacing: 2px !important;
        font-family: 'Courier New', Courier, monospace !important;
        line-height: 1.2 !important;
        padding: 0 !important;
      }
      .tutorial-content {
        width: 100% !important;
        height: 100% !important;
        display: flex !important;
        flex-direction: column !important;
        align-items: center !important;
        justify-content: space-around !important;
        padding: 0 !important;
        margin: 0 !important;
        box-sizing: border-box !important;
      }
      .tutorial-animation {
        width: 200px !important;
        height: 200px !important;
        margin: 0 auto !important;
        display: flex !important;
        align-items: center !important;
        justify-content: center !important;
        background: rgba(0, 255, 0, 0.05) !important;
        border: 2px solid rgba(0, 255, 0, 0.2) !important;
        border-radius: 12px !important;
        overflow: visible !important;
        box-sizing: border-box !important;
        padding: 16px !important;
        flex-shrink: 0 !important;
      }
      .tutorial-animation svg {
        width: 100% !important;
        height: 100% !important;
        overflow: visible !important;
        display: block !important;
      }
      .tutorial-instruction {
        color: rgba(255, 255, 255, 0.9) !important;
        font-size: 16px !important;
        text-align: center !important;
        margin: 12px 0 !important;
        font-family: 'Courier New', Courier, monospace !important;
        line-height: 1.4 !important;
        padding: 0 !important;
      }
      .tutorial-progress {
        display: flex !important;
        gap: 8px !important;
        justify-content: center !important;
        margin: 12px 0 !important;
        padding: 0 !important;
      }
      .tutorial-progress-dot {
        width: 10px !important;
        height: 10px !important;
        border-radius: 50% !important;
        background: rgba(255, 255, 255, 0.3) !important;
        transition: all 0.3s !important;
        margin: 0 !important;
        padding: 0 !important;
      }
      .tutorial-progress-dot.active {
        background: #00ff00 !important;
        box-shadow: 0 0 10px #00ff00 !important;
      }
      .tutorial-actions {
        display: flex !important;
        gap: 12px !important;
        justify-content: center !important;
        margin: 8px 0 0 0 !important;
        padding: 0 !important;
      }
      .tutorial-next-btn,
      .tutorial-done-btn {
        background: rgba(0, 255, 0, 0.1) !important;
        border: 2px solid #00ff00 !important;
        color: #00ff00 !important;
        padding: 10px 28px !important;
        font-family: 'Courier New', Courier, monospace !important;
        font-size: 14px !important;
        cursor: pointer !important;
        border-radius: 6px !important;
        transition: all 0.2s ease !important;
        text-transform: uppercase !important;
        letter-spacing: 1px !important;
        margin: 0 !important;
        line-height: 1 !important;
      }
      .tutorial-next-btn:hover,
      .tutorial-done-btn:hover {
        background: rgba(0, 255, 0, 0.15) !important;
        box-shadow: 0 0 20px rgba(0, 255, 0, 0.3) !important;
      }
      
      /* Animations */
      @keyframes tutorial-pulse {
        0%, 100% { transform: scale(1); opacity: 0.8; }
        50% { transform: scale(1.1); opacity: 1; }
      }
      @keyframes tutorial-slide {
        0%, 100% { transform: translateX(-10px); }
        50% { transform: translateX(10px); }
      }
      @keyframes tutorial-pinch {
        0%, 100% { transform: scale(1); }
        50% { transform: scale(0.8); }
      }
      @keyframes tutorial-bounce-down {
        0%, 100% { transform: translateY(0); }
        50% { transform: translateY(10px); }
      }
      @keyframes tutorial-bounce-up {
        0%, 100% { transform: translateY(0); }
        50% { transform: translateY(-10px); }
      }
      
      .pulse-animation { animation: tutorial-pulse 2s infinite; }
      .slide-animation { animation: tutorial-slide 2s infinite; }
      .pinch-animation { animation: tutorial-pinch 1.5s infinite; }
      .bounce-down { animation: tutorial-bounce-down 1s infinite; }
      .bounce-up { animation: tutorial-bounce-up 1s infinite; }
      .cursor-dot { animation: tutorial-slide 2s infinite; }
      .move-animation { animation: tutorial-slide 2s infinite; }
      
      @media (max-width: 480px) {
        .tutorial-modal {
          padding: 30px 20px !important;
        }
        .tutorial-title {
          font-size: 18px !important;
        }
        .tutorial-animation {
          width: 150px !important;
          height: 150px !important;
        }
        .tutorial-instruction {
          font-size: 14px !important;
        }
      }
    `;

    const injectStyle = () => {
      const targetElement = document.head || document.getElementsByTagName('head')[0] || document.documentElement;
      if (targetElement) {
        targetElement.appendChild(style);
      } else {
        setTimeout(injectStyle, 10);
      }
    };
    injectStyle();

    document.body.appendChild(tutorialElement);

    // Setup event listeners
    document.getElementById('tutorial-skip').addEventListener('click', destroyTutorial);
    document.getElementById('tutorial-next').addEventListener('click', nextTutorialFrame);
    document.getElementById('tutorial-done').addEventListener('click', destroyTutorial);

    // ESC key handler
    const escHandler = (e) => {
      if (e.key === 'Escape') {
        destroyTutorial();
        document.removeEventListener('keydown', escHandler);
      }
    };
    document.addEventListener('keydown', escHandler);

    // Backdrop click handler
    tutorialElement.querySelector('.tutorial-backdrop').addEventListener('click', destroyTutorial);
  }

  function renderTutorialFrame(index) {
    if (!tutorialElement || index >= TUTORIAL_FRAMES.length) return;

    const frame = TUTORIAL_FRAMES[index];
    const titleEl = tutorialElement.querySelector('.tutorial-title');
    const animationEl = tutorialElement.querySelector('.tutorial-animation');
    const instructionEl = tutorialElement.querySelector('.tutorial-instruction');
    const progressEl = tutorialElement.querySelector('.tutorial-progress');
    const nextBtn = document.getElementById('tutorial-next');
    const doneBtn = document.getElementById('tutorial-done');

    // Update content
    titleEl.textContent = frame.title;
    animationEl.innerHTML = frame.svg;
    instructionEl.textContent = frame.instruction;

    // Update progress dots
    progressEl.innerHTML = '';
    for (let i = 0; i < TUTORIAL_FRAMES.length; i++) {
      const dot = document.createElement('div');
      dot.className = 'tutorial-progress-dot' + (i === index ? ' active' : '');
      progressEl.appendChild(dot);
    }

    // Show/hide buttons
    if (index === TUTORIAL_FRAMES.length - 1) {
      nextBtn.style.display = 'none';
      doneBtn.style.display = 'block';
    } else {
      nextBtn.style.display = 'block';
      doneBtn.style.display = 'none';
    }

    // Auto-advance
    clearTimeout(tutorialAutoAdvanceTimer);
    if (index < TUTORIAL_FRAMES.length - 1) {
      tutorialAutoAdvanceTimer = setTimeout(() => {
        nextTutorialFrame();
      }, TUTORIAL_FRAME_DURATION);
    }
  }

  function nextTutorialFrame() {
    currentTutorialFrame++;
    if (currentTutorialFrame >= TUTORIAL_FRAMES.length) {
      destroyTutorial();
    } else {
      renderTutorialFrame(currentTutorialFrame);
    }
  }

  function showTutorial() {
    try {
      currentTutorialFrame = 0;
      createTutorialOverlay();
      renderTutorialFrame(0);
      log('Tutorial started');
    } catch (e) {
      log('Failed to show tutorial', e);
      destroyTutorial();
    }
  }

  function destroyTutorial() {
    clearTimeout(tutorialAutoAdvanceTimer);
    if (tutorialElement) {
      tutorialElement.remove();
      tutorialElement = null;
    }
    currentTutorialFrame = 0;
    log('Tutorial closed');
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

  /**
   * Manually show the tutorial overlay
   * Does NOT mark tutorial as seen in localStorage
   * Can be called anytime to show tutorial again
   */
  GestureAccessibility.showTutorial = function () {
    showTutorial();
  };

  window.GestureAccessibility = GestureAccessibility;
})(window);
