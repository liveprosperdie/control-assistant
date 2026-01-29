// ================== ELEMENTS ==================
const startBtn = document.getElementById("startBtn");
const statusEl = document.getElementById("status");
const logEl = document.getElementById("log");
const video = document.getElementById("camera");
const canvas = document.getElementById("motionCanvas");
const ctx = canvas.getContext("2d");
const commandList = document.getElementById("commandList");
const waveIndicator = document.getElementById("waveIndicator");

// ================== STATE MACHINE ==================
const STATE = {
  UNINITIALIZED: "UNINITIALIZED",
  IDLE: "IDLE",
  ACTIVATED: "ACTIVATED",
  LISTENING_FOR_COMMAND: "LISTENING_FOR_COMMAND"
};

let currentState = STATE.UNINITIALIZED;
let lastActivationTime = 0;
const ACTIVATION_COOLDOWN = 5000; // 5 seconds between activations
let userName = "";

// ================== SPEECH ==================
const SpeechRecognition =
  window.SpeechRecognition || window.webkitSpeechRecognition;

let recognition;
let isRecognitionActive = false;
let recognitionPaused = false;

function speak(text) {
  // Pause recognition while speaking
  recognitionPaused = true;
  
  const utter = new SpeechSynthesisUtterance(text);
  utter.rate = 1;
  utter.pitch = 1;
  
  utter.onend = () => {
    // Wait 3 seconds after speaking before listening again
    setTimeout(() => {
      recognitionPaused = false;
    }, 3000);
  };
  
  utter.onerror = () => {
    // Resume listening even if speech fails
    setTimeout(() => {
      recognitionPaused = false;
    }, 3000);
  };
  
  speechSynthesis.speak(utter);
}

function log(text) {
  logEl.textContent = text;
  console.log(`[CONTROL] ${text}`);
}

// ================== VOICE LOGIC ==================
function startSpeech() {
  if (!SpeechRecognition) {
    log("Speech recognition not supported");
    return;
  }

  recognition = new SpeechRecognition();
  recognition.lang = "en-US";
  recognition.continuous = true;
  recognition.interimResults = false;

  recognition.onstart = () => {
    isRecognitionActive = true;
    log("Voice recognition active");
  };

  recognition.onresult = (event) => {
    // Ignore results if recognition is paused (assistant just spoke)
    if (recognitionPaused) {
      console.log("Ignoring input - recognition paused");
      return;
    }
    
    const text =
      event.results[event.results.length - 1][0].transcript.toLowerCase().trim();

    log(`Heard: "${text}"`);

    // Wake word detection (only in IDLE state)
    if (currentState === STATE.IDLE && text.includes("control")) {
      activate("voice");
      return;
    }

    // Command processing (only in LISTENING_FOR_COMMAND state)
    if (currentState === STATE.LISTENING_FOR_COMMAND) {
      transitionTo(STATE.IDLE);
      handleCommand(text);
    }
  };

  recognition.onerror = (event) => {
    console.error("Speech recognition error:", event.error);
    
    // Don't restart on not-allowed error (permission denied)
    if (event.error === "not-allowed") {
      log("Microphone permission denied");
      isRecognitionActive = false;
      return;
    }
    
    // For other errors, restart
    if (event.error === "no-speech" || event.error === "aborted") {
      restartRecognition();
    } else {
      log(`Voice error: ${event.error}`);
      restartRecognition();
    }
  };

  recognition.onend = () => {
    isRecognitionActive = false;
    // Auto-restart if we're still initialized
    if (currentState !== STATE.UNINITIALIZED) {
      restartRecognition();
    }
  };

  try {
    recognition.start();
  } catch (e) {
    console.error("Failed to start recognition:", e);
    log("Voice recognition failed to start");
  }
}

function restartRecognition() {
  if (isRecognitionActive) return;
  setTimeout(() => {
    if (currentState !== STATE.UNINITIALIZED && !isRecognitionActive) {
      try {
        recognition.start();
      } catch (e) {
        console.error("Failed to restart recognition:", e);
      }
    }
  }, 100);
}

// ================== CAMERA MOTION ==================
async function startCamera() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ 
      video: { width: 640, height: 480 } 
    });
    video.srcObject = stream;

    video.onloadedmetadata = () => {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      log("Camera active");
      requestAnimationFrame(detectMotion);
    };
  } catch (err) {
    log("Camera access denied");
    console.error("Camera error:", err);
  }
}

let lastFrame = null;
let stableFrameCount = 0;
let palmDetectionActive = false;
const MOTION_THRESHOLD = 3000; // Need significant motion
const STABLE_THRESHOLD = 400; // Palm can be mostly still

function detectMotion() {
  if (currentState === STATE.UNINITIALIZED) return;

  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  const current = ctx.getImageData(0, 0, canvas.width, canvas.height);

  if (lastFrame && currentState === STATE.IDLE) {
    let diff = 0;
    
    // Calculate difference
    for (let i = 0; i < current.data.length; i += 8) {
      diff += Math.abs(current.data[i] - lastFrame.data[i]);
    }

    const motionLevel = Math.round(diff / 1000);
    
    // Only log significant motion to reduce noise
    if (motionLevel > 1000) {
      log(`Motion: ${motionLevel}k (need ${MOTION_THRESHOLD}k)`);
    }
    
    // Palm detection logic:
    // 1. Detect BIG motion (palm entering frame)
    // 2. Then detect stability (palm held still)
    
    if (motionLevel > MOTION_THRESHOLD) {
      // Significant motion detected - palm is moving into view
      if (!palmDetectionActive) {
        palmDetectionActive = true;
        stableFrameCount = 0;
        log(`Palm detected - hold still...`);
        waveIndicator.classList.add("active");
      }
    } else if (palmDetectionActive && motionLevel < STABLE_THRESHOLD) {
      // Palm is now stable (held still)
      stableFrameCount++;
      
      if (stableFrameCount % 5 === 0) {
        log(`Holding... ${stableFrameCount}/20`);
      }
      
      if (stableFrameCount >= 20) {
        // Palm held for ~0.7 seconds
        log(`✓ Palm activated!`);
        waveIndicator.classList.remove("active");
        activate("palm");
        palmDetectionActive = false;
        stableFrameCount = 0;
      }
    } else if (palmDetectionActive && motionLevel >= STABLE_THRESHOLD && motionLevel < MOTION_THRESHOLD) {
      // Too much movement but not enough to re-trigger - reset counter
      if (stableFrameCount > 0) {
        log(`Too much movement - hold still`);
        stableFrameCount = 0;
      }
    } else if (palmDetectionActive && motionLevel >= MOTION_THRESHOLD) {
      // Big motion again - restart detection
      stableFrameCount = 0;
      log(`Palm detected - hold still...`);
    }
    
    // Reset palm detection after 3 seconds of inactivity
    if (palmDetectionActive && motionLevel < 100) {
      setTimeout(() => {
        if (palmDetectionActive && motionLevel < 100) {
          palmDetectionActive = false;
          stableFrameCount = 0;
          waveIndicator.classList.remove("active");
        }
      }, 3000);
    }
  }

  lastFrame = current;
  requestAnimationFrame(detectMotion);
}

// ================== STATE TRANSITIONS ==================
function transitionTo(newState) {
  console.log(`State: ${currentState} → ${newState}`);
  currentState = newState;

  switch (newState) {
    case STATE.IDLE:
      statusEl.textContent = "IDLE";
      statusEl.className = "idle";
      commandList.classList.remove("hidden");
      break;
    case STATE.ACTIVATED:
      statusEl.textContent = "ACTIVATED";
      statusEl.className = "listening";
      commandList.classList.add("hidden");
      break;
    case STATE.LISTENING_FOR_COMMAND:
      statusEl.textContent = "LISTENING";
      statusEl.className = "listening";
      commandList.classList.add("hidden");
      break;
  }
}

function activate(source) {
  const now = Date.now();
  
  // Debounce: prevent rapid re-activation
  if (now - lastActivationTime < ACTIVATION_COOLDOWN) {
    log(`Activation blocked (cooldown)`);
    return;
  }

  // Only activate from IDLE state
  if (currentState !== STATE.IDLE) {
    return;
  }

  lastActivationTime = now;
  log(`Activated by ${source}`);
  
  transitionTo(STATE.ACTIVATED);
  const greeting = userName ? `Yes ${userName}, how may I help you?` : "Yes, how may I help you?";
  speak(greeting);
  
  // Transition to listening after greeting
  setTimeout(() => {
    if (currentState === STATE.ACTIVATED) {
      transitionTo(STATE.LISTENING_FOR_COMMAND);
    }
  }, 2500);
}

// ================== COMMANDS ==================
function handleCommand(text) {
  log(`Processing: "${text}"`);

  // Dashboard/LinkedIn
  if (text.includes("dashboard") || text.includes("linkedin")) {
    window.open("https://www.linkedin.com", "_blank");
    speak("Opening dashboard");
    return;
  }

  // Music
  if (text.includes("music")) {
    // Check if they want to search for specific music
    const musicQuery = text
      .replace(/^(play|open|search)\s+/gi, '')
      .replace(/\s+music$/gi, '')
      .trim();
    
    if (musicQuery && musicQuery !== "music" && musicQuery.length > 2) {
      window.open(`https://www.youtube.com/results?search_query=${encodeURIComponent(musicQuery + " music")}&sp=EgIQAQ%253D%253D`, "_blank");
      speak(`Playing ${musicQuery} music`);
      return;
    }
    
    // Default music - direct video link
    window.open(
      "https://www.youtube.com/watch?v=jfKfPfyJRdk",
      "_blank"
    );
    speak("Playing music");
    return;
  }

  // Files/Drive
  if (text.includes("files") || text.includes("drive")) {
    window.open("https://drive.google.com", "_blank");
    speak("Opening files");
    return;
  }

  // ChatGPT
  if (text.includes("chat") || text.includes("gpt")) {
    window.open("https://chatgpt.com", "_blank");
    speak("Opening ChatGPT");
    return;
  }

  // Email/Gmail
  if (text.includes("email") || text.includes("mail") || text.includes("gmail")) {
    window.open("https://mail.google.com", "_blank");
    speak("Opening email");
    return;
  }

  // Calendar
  if (text.includes("calendar") || text.includes("schedule")) {
    window.open("https://calendar.google.com", "_blank");
    speak("Opening calendar");
    return;
  }

  // YouTube - can search for specific videos and play first result
  if (text.includes("youtube") || text.includes("video") || text.includes("play")) {
    // Try to extract video name after keywords
    let videoQuery = "";
    
    // Remove common command words to get the actual video name
    videoQuery = text
      .replace(/^(youtube|video|play|open|search)\s+/gi, '')
      .replace(/\s+(on youtube|video|youtube)$/gi, '')
      .trim();
    
    // If we have a meaningful query (more than just "music")
    if (videoQuery && videoQuery.length > 2 && !text.match(/^(youtube|video|play)$/i)) {
      // Use YouTube's direct watch URL with search query - often plays first result
      window.open(`https://www.youtube.com/results?search_query=${encodeURIComponent(videoQuery)}&sp=EgIQAQ%253D%253D`, "_blank");
      speak(`Playing ${videoQuery}`);
      
      // Alternative: Try to open with a more direct approach
      // This opens search results sorted by relevance
      setTimeout(() => {
        // User will need to click the first video, but it's prominently displayed
      }, 100);
      return;
    }
    
    // Just open YouTube homepage if no specific video mentioned
    window.open("https://www.youtube.com", "_blank");
    speak("Opening YouTube");
    return;
  }

  // GitHub
  if (text.includes("github") || text.includes("code")) {
    window.open("https://github.com", "_blank");
    speak("Opening GitHub");
    return;
  }

  // Weather
  if (text.includes("weather") || text.includes("forecast")) {
    // Check for specific city mentions
    let city = "";
    const cities = {
      "agra": "Agra, India",
      "delhi": "Delhi, India",
      "mumbai": "Mumbai, India",
      "bangalore": "Bangalore, India",
      "kolkata": "Kolkata, India",
      "chennai": "Chennai, India",
      "hyderabad": "Hyderabad, India",
      "pune": "Pune, India",
      "jaipur": "Jaipur, India",
      "lucknow": "Lucknow, India",
      "new york": "New York",
      "london": "London",
      "paris": "Paris",
      "tokyo": "Tokyo",
      "dubai": "Dubai"
    };
    
    for (const [key, value] of Object.entries(cities)) {
      if (text.includes(key)) {
        city = value;
        break;
      }
    }
    
    if (city) {
      window.open(`https://www.google.com/search?q=weather+${encodeURIComponent(city)}`, "_blank");
      speak(`Opening weather for ${city}`);
    } else {
      window.open("https://weather.com", "_blank");
      speak("Opening weather");
    }
    return;
  }

  // News
  if (text.includes("news")) {
    window.open("https://news.google.com", "_blank");
    speak("Opening news");
    return;
  }

  // Maps
  if (text.includes("maps") || text.includes("navigation")) {
    window.open("https://maps.google.com", "_blank");
    speak("Opening maps");
    return;
  }

  // Time - speak current time
  if (text.includes("time") || text.includes("clock")) {
    const now = new Date();
    const timeStr = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
    speak(`The time is ${timeStr}`);
    return;
  }

  // Date - speak current date
  if (text.includes("date") || text.includes("today")) {
    const now = new Date();
    const dateStr = now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
    speak(`Today is ${dateStr}`);
    return;
  }

  // Help
  if (text.includes("help")) {
    speak(
      "You can say: open files, dashboard, email, calendar, chat GPT, youtube, github, weather of any city, news, maps, play music, what time is it, what's the date, open any website, search anything, or help"
    );
    return;
  }

  // Open any website - "open [website name]"
  if (text.includes("open") && !text.match(/files|dashboard|email|calendar|github|news|maps/)) {
    const websiteMatch = text.match(/open\s+(.+)/i);
    if (websiteMatch && websiteMatch[1]) {
      let website = websiteMatch[1].trim();
      
      // Remove all spaces first (speech recognition adds spaces in website names)
      website = website.replace(/\s+/g, '');
      
      // Clean up common words
      website = website.replace(/website|site|dotcom/gi, '');
      
      // Remove .com or com if already said, we'll add it back
      website = website.replace(/\.com$|com$/gi, '');
      
      if (website.length > 2) {
        // Always add com
        website = website + 'com';
        
        // Add https://
        website = 'https://' + website;
        
        window.open(website, "_blank");
        speak(`Opening ${websiteMatch[1]}`);
        return;
      }
    }
  }

  // Search anything - "search [query]"
  if (text.includes("search") || text.includes("google")) {
    const searchMatch = text.match(/(?:search|google)\s+(.+)/i);
    if (searchMatch && searchMatch[1]) {
      const query = searchMatch[1].trim();
      
      if (query.length > 2) {
        window.open(`https://www.google.com/search?q=${encodeURIComponent(query)}`, "_blank");
        speak(`Searching for ${query}`);
        return;
      }
    }
  }

  // Unrecognized command
  speak("Sorry, I cannot do that yet");
  log("Command not recognized");
}

// ================== INITIALIZATION ==================
startBtn.onclick = async () => {
  if (currentState !== STATE.UNINITIALIZED) return;

  // Ask for user's name
  const nameInput = prompt("Welcome to CONTROL! What's your name?");
  
  if (nameInput && nameInput.trim()) {
    userName = nameInput.trim();
  } else {
    userName = ""; // No name provided
  }

  startBtn.disabled = true;
  startBtn.textContent = "INITIALIZING...";
  log("Starting system...");

  try {
    await startCamera();
    startSpeech();
    
    transitionTo(STATE.IDLE);
    startBtn.textContent = "ONLINE";
    
    if (userName) {
      log(`System online - Welcome ${userName}!`);
      speak(`Welcome ${userName}. Say control or show your palm to activate me.`);
    } else {
      log("System online - Say 'control' or show palm");
    }
  } catch (err) {
    log("Initialization failed");
    console.error(err);
    startBtn.disabled = false;
    startBtn.textContent = "RETRY";
    currentState = STATE.UNINITIALIZED;
  }
};
