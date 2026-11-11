/**
 * WONDERHACK — Legacy Local Database (unused)
 * Accounts now live in the server-side SQLite registry (server.py + db/).
 * This IndexedDB helper is kept for reference only and seeds no accounts.
 */

const WonderDatabase = (() => {
  const DB_NAME = 'WonderHack_DB';
  const DB_VERSION = 1;
  const STORE_NAME = 'users';
  const SESSION_KEY = 'wonderhack_active_session_v1';

  // No accounts are seeded locally; the SQLite registry is authoritative.
  const SEED_USERS = [];

  let dbInstance = null;
  let isInitialized = false;
  let connectionType = 'Connecting...';

  /**
   * Initializes the database connection
   */
  async function init() {
    if (isInitialized && dbInstance) {
      return { success: true, type: connectionType, usersCount: SEED_USERS.length };
    }

    return new Promise((resolve) => {
      if (!window.indexedDB) {
        console.warn('WonderHack DB: IndexedDB not available, falling back to LocalStorage DB.');
        initLocalStorageFallback();
        resolve({ success: true, type: 'LocalStorage (Fallback)', usersCount: SEED_USERS.length });
        return;
      }

      try {
        const request = window.indexedDB.open(DB_NAME, DB_VERSION);

        request.onupgradeneeded = (event) => {
          const db = event.target.result;
          if (!db.objectStoreNames.contains(STORE_NAME)) {
            const store = db.createObjectStore(STORE_NAME, { keyPath: 'username' });
            store.createIndex('character', 'character', { unique: false });
            // Seed initial records
            SEED_USERS.forEach(user => store.add(user));
          }
        };

        request.onsuccess = (event) => {
          dbInstance = event.target.result;
          isInitialized = true;
          connectionType = 'IndexedDB (' + DB_NAME + ')';
          console.info('WonderHack DB: Connected to IndexedDB successfully with 2 court users.');
          ensureUsersSeededIndexedDB(dbInstance).then(() => {
            resolve({ success: true, type: connectionType, usersCount: SEED_USERS.length });
          });
        };

        request.onerror = (event) => {
          console.warn('WonderHack DB: IndexedDB open failed, using LocalStorage fallback.', event.target.error);
          initLocalStorageFallback();
          resolve({ success: true, type: 'LocalStorage (Fallback)', usersCount: SEED_USERS.length });
        };
      } catch (err) {
        console.warn('WonderHack DB: IndexedDB threw exception, using fallback.', err);
        initLocalStorageFallback();
        resolve({ success: true, type: 'LocalStorage (Fallback)', usersCount: SEED_USERS.length });
      }
    });
  }

  function ensureUsersSeededIndexedDB(db) {
    return new Promise((resolve) => {
      try {
        const tx = db.transaction([STORE_NAME], 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        SEED_USERS.forEach(user => {
          store.put(user);
        });
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      } catch (e) {
        resolve();
      }
    });
  }

  function initLocalStorageFallback() {
    isInitialized = true;
    connectionType = 'WebStorage DB (WonderHack_Users)';
    try {
      const existing = localStorage.getItem('wonderhack_db_users');
      if (!existing) {
        localStorage.setItem('wonderhack_db_users', JSON.stringify(SEED_USERS));
      }
    } catch (e) {
      console.warn('WonderHack DB: Storage warning', e);
    }
  }

  /**
   * Retrieves all registered users from the database
   */
  async function getAllUsers() {
    await init();

    if (dbInstance) {
      return new Promise((resolve) => {
        try {
          const tx = dbInstance.transaction([STORE_NAME], 'readonly');
          const store = tx.objectStore(STORE_NAME);
          const req = store.getAll();
          req.onsuccess = () => {
            const list = req.result && req.result.length ? req.result : SEED_USERS;
            resolve(list);
          };
          req.onerror = () => resolve(SEED_USERS);
        } catch (e) {
          resolve(SEED_USERS);
        }
      });
    }

    // LocalStorage fallback
    try {
      const stored = localStorage.getItem('wonderhack_db_users');
      if (stored) return JSON.parse(stored);
    } catch (e) {}
    return SEED_USERS;
  }

  /**
   * Finds a user by username or alias
   */
  async function findUser(identifier) {
    const users = await getAllUsers();
    const cleanId = (identifier || '').trim().toLowerCase();
    
    return users.find(u => {
      if (u.username.toLowerCase() === cleanId) return true;
      if (u.displayName.toLowerCase() === cleanId) return true;
      if (u.aliases && u.aliases.some(a => a.toLowerCase() === cleanId)) return true;
      return false;
    });
  }

  /**
   * Authenticates user credentials against the database
   */
  async function authenticate(usernameInput, passwordInput) {
    await init();

    const user = await findUser(usernameInput);
    if (!user) {
      return {
        success: false,
        error: `User "${usernameInput}" not recognized in the Queen's Court Registry.`
      };
    }

    const cleanPass = (passwordInput || '').trim();
    const isPassValid = 
      cleanPass === user.password || 
      (user.acceptedPasswords && user.acceptedPasswords.includes(cleanPass.toLowerCase()));

    if (!isPassValid) {
      return {
        success: false,
        error: 'Invalid royal passphrase! The executioner frowns upon mistaken credentials.'
      };
    }

    // Authentication successful
    setCurrentUser(user);

    // Sync with WonderState if available - this makes the user's icon & picture show up!
    if (typeof WonderState !== 'undefined' && WonderState.login) {
      WonderState.login(user);
    }

    return {
      success: true,
      user: user
    };
  }

  /**
   * Sets the active session in storage
   */
  function setCurrentUser(user) {
    try {
      localStorage.setItem(SESSION_KEY, JSON.stringify(user));
    } catch (e) {}
  }

  /**
   * Gets the active session user
   */
  function getCurrentUser() {
    try {
      const saved = localStorage.getItem(SESSION_KEY);
      if (saved) return JSON.parse(saved);
    } catch (e) {}
    return null;
  }

  /**
   * Clears the active session
   */
  function logout() {
    try {
      localStorage.removeItem(SESSION_KEY);
    } catch (e) {}
  }

  /**
   * Returns current database status metadata for UI display
   */
  function getStatus() {
    return {
      connected: isInitialized,
      type: connectionType || 'IndexedDB (WonderHack_DB)',
      databaseName: DB_NAME,
      storeName: STORE_NAME
    };
  }

  return {
    init,
    getAllUsers,
    findUser,
    authenticate,
    getCurrentUser,
    setCurrentUser,
    logout,
    getStatus
  };
})();

// Auto-initialize when script loads
if (typeof window !== 'undefined') {
  window.WonderDatabase = WonderDatabase;
  WonderDatabase.init().catch(console.warn);
}
