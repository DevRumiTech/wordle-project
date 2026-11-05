const STORAGE_KEY = 'wordle.activeGameId'
const MAX_ID = 18446744073709551615n

function validId(value) {
  const id = String(value ?? '')
  return /^[1-9][0-9]{0,19}$/.test(id) && BigInt(id) <= MAX_ID
}

export function readActiveGameId(storage) {
  try {
    const store = storage ?? window.localStorage
    const id = store.getItem(STORAGE_KEY)

    if (id === null) return null

    // Discard corrupted or invalid saved identifiers.
    if (!validId(id)) {
      store.removeItem(STORAGE_KEY)
      return null
    }

    return id
  } catch {
    // Storage may be unavailable in restricted browsers.
    return null
  }
}

export function saveActiveGameId(id, storage) {
  try {
    if (!validId(id)) return false
    const store = storage ?? window.localStorage
    store.setItem(STORAGE_KEY, String(id))
    return true
  } catch {
    return false
  }
}

export function clearActiveGameId(storage) {
  try {
    const store = storage ?? window.localStorage
    store.removeItem(STORAGE_KEY)
    return true
  } catch {
    return false
  }
}