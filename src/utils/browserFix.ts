/**
 * Browser-specific fixes and workarounds
 * This module contains functions to handle browser-specific issues
 */

// Clear all local storage for the current site
export const clearBrowserStorage = (): void => {
  console.log('Clearing all browser storage...');
  
  try {
    // Clear localStorage
    if (typeof localStorage !== 'undefined') {
      localStorage.clear();
      console.log('localStorage cleared');
    }
    
    // Clear sessionStorage
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.clear();
      console.log('sessionStorage cleared');
    }
    
    // Clear indexedDB
    if (typeof indexedDB !== 'undefined') {
      const databases = indexedDB.databases?.();
      if (databases) {
        // This is async but we'll let it run in the background
        databases.then((dbs) => {
          dbs.forEach((db) => {
            if (db.name) {
              indexedDB.deleteDatabase(db.name);
              console.log(`IndexedDB database ${db.name} deleted`);
            }
          });
        }).catch(err => {
          console.error('Error clearing IndexedDB:', err);
        });
      } else {
        // Fallback: Try to delete known database
        try {
          indexedDB.deleteDatabase('employee_time_tracking');
          console.log('IndexedDB database deleted');
        } catch (err) {
          console.error('Error deleting IndexedDB database:', err);
        }
      }
    }
    
    // Clear any service workers
    if (navigator.serviceWorker && navigator.serviceWorker.controller) {
      navigator.serviceWorker.getRegistrations().then(registrations => {
        for (let registration of registrations) {
          registration.unregister();
          console.log('Service worker unregistered');
        }
      }).catch(err => {
        console.error('Error unregistering service worker:', err);
      });
    }
    
    console.log('All browser storage cleared');
  } catch (error) {
    console.error('Error clearing browser storage:', error);
  }
};

// Fix Firefox-specific date issues
export const fixFirefoxDateIssues = (): void => {
  if (typeof navigator === 'undefined') return;
  
  const isFirefox = navigator.userAgent.toLowerCase().indexOf('firefox') > -1;
  if (!isFirefox) return;
  
  console.log('Applying Firefox-specific date fixes');
  
  try {
    // Add Firefox-specific Date prototype patch
    // This helps prevent issues with date handling
    const originalGetHours = Date.prototype.getHours;
    if (originalGetHours) {
      Date.prototype.getHours = function() {
        try {
          // Make sure we're working with a valid date before calling original
          if (isNaN(this.getTime())) {
            console.warn('Invalid Date in getHours call, returning 0');
            return 0;
          }
          return originalGetHours.apply(this);
        } catch (e) {
          console.error('Error in patched getHours:', e);
          return 0;
        }
      };
    }
    
    const originalGetMinutes = Date.prototype.getMinutes;
    if (originalGetMinutes) {
      Date.prototype.getMinutes = function() {
        try {
          // Make sure we're working with a valid date before calling original
          if (isNaN(this.getTime())) {
            console.warn('Invalid Date in getMinutes call, returning 0');
            return 0;
          }
          return originalGetMinutes.apply(this);
        } catch (e) {
          console.error('Error in patched getMinutes:', e);
          return 0;
        }
      };
    }
    
    // Similar patches for other Date methods if needed
    console.log('Firefox date fixes applied');
  } catch (error) {
    console.error('Error applying Firefox date fixes:', error);
  }
};

// Apply browser-specific fixes
export const applyBrowserFixes = (): void => {
  fixFirefoxDateIssues();
  
  // Add other browser fixes as needed
};

// Check if we need to clear the browser storage due to version mismatch or corruption
export const checkIfStorageClearNeeded = (): boolean => {
  try {
    // Check for storage version mismatch
    const storedVersion = localStorage.getItem('storageVersion');
    const currentVersion = '1.1'; // Should match STORAGE_VERSION in storage.ts
    
    if (storedVersion !== currentVersion) {
      console.log(`Storage version mismatch: stored=${storedVersion}, current=${currentVersion}`);
      return true;
    }
    
    // Check for potential corruption
    try {
      const records = localStorage.getItem('employeeRecords');
      if (records) {
        JSON.parse(records); // This will throw if malformed JSON
      }
    } catch (e) {
      console.error('Corrupted storage data detected:', e);
      return true;
    }
    
    return false;
  } catch (error) {
    console.error('Error checking if storage clear needed:', error);
    return true; // On error, better to clear storage to be safe
  }
};

// Run the Firefox fix immediately when this module is imported
fixFirefoxDateIssues();