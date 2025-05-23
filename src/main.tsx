import 'core-js/stable';
import 'regenerator-runtime/runtime';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.tsx';
import { AppProvider } from './context/AppContext';
import './index.css';
import { applyBrowserFixes } from './utils/browserFix';

// Apply browser-specific fixes
applyBrowserFixes();

// Add polyfills for older browsers
// This helps with compatibility issues
if (!Object.entries) {
  Object.entries = function(obj: any) {
    return Object.keys(obj).map(function(key) {
      return [key, obj[key]];
    });
  };
}

// Error handler for unhandled promise rejections
window.addEventListener('unhandledrejection', function(event) {
  console.error('Unhandled promise rejection:', event.reason);
});

// Global error handler for easier debugging of Firefox issues
window.addEventListener('error', function(event) {
  console.error('Global error caught:', event.error);
  console.log('Error occurred at:', event.filename, 'line:', event.lineno, 'column:', event.colno);
  
  // Don't prevent default behavior
  return false;
});

// Create the root element with error handling
const rootElement = document.getElementById('root');
if (!rootElement) {
  console.error('Root element not found');
} else {
  try {
    createRoot(rootElement).render(
      <StrictMode>
        <BrowserRouter>
          <AppProvider>
            <App />
          </AppProvider>
        </BrowserRouter>
      </StrictMode>
    );
  } catch (error) {
    console.error('Error rendering application:', error);
    rootElement.innerHTML = `
      <div style="padding: 20px; text-align: center;">
        <h2>Failed to load application</h2>
        <p>Please try using a different browser or clearing your cache.</p>
        <pre style="background: #f0f0f0; padding: 10px; text-align: left; overflow: auto;">${error?.toString() || 'Unknown error'}</pre>
        <div style="margin-top: 20px">
          <button onclick="localStorage.clear(); sessionStorage.clear(); window.location.reload();" style="padding: 8px 16px; background: #dc2626; color: white; border: none; border-radius: 4px; cursor: pointer; margin-right: 10px;">
            Clear Data & Reload
          </button>
          <a href="/" style="padding: 8px 16px; background: #4f46e5; color: white; text-decoration: none; border-radius: 4px;">
            Return to Home
          </a>
        </div>
      </div>
    `;
  }
}