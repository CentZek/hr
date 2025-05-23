import 'core-js/stable';
import 'regenerator-runtime/runtime';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.tsx';
import { AppProvider } from './context/AppContext';
import './index.css';
import { runDataRecovery, initializeCache } from './utils/storageUtils';

// Add polyfills for older browsers
// This helps with compatibility issues
if (!Object.entries) {
  Object.entries = function(obj: any) {
    return Object.keys(obj).map(function(key) {
      return [key, obj[key]];
    });
  };
}

// Initialize cache system
initializeCache();

// Run data recovery system on startup
runDataRecovery();

// Error handler for unhandled promise rejections
window.addEventListener('unhandledrejection', function(event) {
  console.error('Unhandled promise rejection:', event.reason);
});

// Global error handler for runtime errors
window.addEventListener('error', function(event) {
  console.error('Runtime error:', event.error);
  // If this is a "is not a function" error related to date handling, run recovery
  if (event.error && 
      event.error.message && 
      (event.error.message.includes('is not a function') || 
       event.error.message.includes('Cannot read properties of undefined'))) {
    console.warn('Detected possible data corruption, running recovery...');
    if (runDataRecovery()) {
      setTimeout(() => {
        window.location.reload();
      }, 1000);
    }
  }
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
    // Run data recovery if the app fails to render
    runDataRecovery();
    
    rootElement.innerHTML = `
      <div style="padding: 20px; text-align: center;">
        <h2>Failed to load application</h2>
        <p>Please try using a different browser or clearing your cache.</p>
        <button id="reload-app" style="padding: 8px 16px; background: #4263eb; color: white; border: none; border-radius: 4px; cursor: pointer; margin-top: 16px;">
          Reload Application
        </button>
        <pre style="background: #f0f0f0; padding: 10px; text-align: left; overflow: auto;">${error?.toString() || 'Unknown error'}</pre>
      </div>
    `;
    
    // Add reload button handler
    setTimeout(() => {
      const reloadButton = document.getElementById('reload-app');
      if (reloadButton) {
        reloadButton.addEventListener('click', () => window.location.reload());
      }
    }, 0);
  }
}