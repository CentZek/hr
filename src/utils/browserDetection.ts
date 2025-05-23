export const detectBrowser = (): Record<string, boolean> => {
  // Default to modern browser support when window is not available (SSR)
  if (typeof window === 'undefined' || !window.navigator) {
    return {
      chrome: true,
      firefox: false,
      safari: false,
      edge: false,
      ie: false,
      isModern: true,
      isLegacy: false,
    };
  }

  const userAgent = window.navigator.userAgent.toLowerCase();
  
  // Detect browsers
  const isChrome = /chrome/.test(userAgent) && !/edg/.test(userAgent);
  const isFirefox = /firefox/.test(userAgent);
  const isSafari = /safari/.test(userAgent) && !/chrome/.test(userAgent);
  const isEdge = /edg/.test(userAgent);
  const isIE = /msie|trident/.test(userAgent);
  
  // Detect legacy browsers
  const isLegacyEdge = /edge/.test(userAgent) && !/edg/.test(userAgent); // Old Edge
  const isLegacyChrome = isChrome && parseInt(userAgent.match(/chrome\/(\d+)/)?.[1] || '100', 10) < 85;
  const isLegacySafari = isSafari && parseInt(userAgent.match(/version\/(\d+)/)?.[1] || '15', 10) < 14;
  
  // Combined legacy detection
  const isLegacy = isIE || isLegacyEdge || isLegacyChrome || isLegacySafari;
  const isModern = !isLegacy;

  return {
    chrome: isChrome,
    firefox: isFirefox,
    safari: isSafari,
    edge: isEdge,
    ie: isIE,
    isModern,
    isLegacy,
  };
};

export const getBrowserVersion = (): Record<string, string | null> => {
  if (typeof window === 'undefined' || !window.navigator) {
    return {
      name: null,
      version: null,
      fullUserAgent: null,
    };
  }
  
  const userAgent = window.navigator.userAgent;
  let browser = "unknown";
  let version = null;

  // Chrome
  let match = userAgent.match(/(chrome|chromium|crios)\/(\d+)/i);
  if (match && !userAgent.match(/edg/i)) {
    browser = "Chrome";
    version = match[2];
  }
  // Firefox
  else if (match = userAgent.match(/(firefox|fxios)\/(\d+)/i)) {
    browser = "Firefox";
    version = match[2];
  }
  // Edge
  else if (match = userAgent.match(/edg\/(\d+)/i)) {
    browser = "Edge";
    version = match[1];
  }
  // Safari
  else if (match = userAgent.match(/safari\/(\d+)/i) && (match = userAgent.match(/version\/(\d+)/i))) {
    browser = "Safari";
    version = match[1];
  }
  // IE
  else if (match = userAgent.match(/(msie |trident.*? rv:)(\d+)/i)) {
    browser = "Internet Explorer";
    version = match[2];
  }

  return {
    name: browser,
    version,
    fullUserAgent: userAgent
  };
};

export const isWebWorkerSupported = (): boolean => {
  return typeof Worker !== 'undefined';
};

export const isLocalStorageSupported = (): boolean => {
  try {
    localStorage.setItem('test', 'test');
    localStorage.removeItem('test');
    return true;
  } catch (e) {
    return false;
  }
};

export const isPromiseSupported = (): boolean => {
  return typeof Promise !== 'undefined';
};

export const isSessionStorageSupported = (): boolean => {
  try {
    sessionStorage.setItem('test', 'test');
    sessionStorage.removeItem('test');
    return true;
  } catch (e) {
    return false;
  }
};

export const isFetchSupported = (): boolean => {
  return typeof fetch !== 'undefined';
};

// Check for overall browser compatibility
export const checkBrowserCompatibility = (): {
  isCompatible: boolean;
  issues: string[];
} => {
  const issues: string[] = [];
  
  if (!isPromiseSupported()) {
    issues.push("Promise API is not supported");
  }
  
  if (!isFetchSupported()) {
    issues.push("Fetch API is not supported");
  }
  
  if (!isLocalStorageSupported()) {
    issues.push("LocalStorage is not supported");
  }
  
  if (!isSessionStorageSupported()) {
    issues.push("SessionStorage is not supported");
  }
  
  const browserInfo = detectBrowser();
  if (browserInfo.ie) {
    issues.push("Internet Explorer is not supported");
  }
  
  return {
    isCompatible: issues.length === 0,
    issues
  };
};