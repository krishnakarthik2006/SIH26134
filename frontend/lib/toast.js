/**
 * Lightweight toast notification system.
 * Works with the #toast-root div defined in index.html.
 * No dependencies — pure DOM manipulation.
 */

function ensureRoot() {
  let root = document.getElementById('toast-root')
  if (!root) {
    root = document.createElement('div')
    root.id = 'toast-root'
    document.body.appendChild(root)
  }
  return root
}

function show(message, type = 'info', duration = 3500) {
  const root = ensureRoot()
  const el   = document.createElement('div')
  el.className = `toast toast-${type}`

  const iconMap = { success: '✓', error: '✕', info: 'i' }
  el.innerHTML = `
    <div class="toast-icon">${iconMap[type] || 'i'}</div>
    <span>${message}</span>
  `

  root.appendChild(el)

  const remove = () => {
    el.classList.add('leaving')
    setTimeout(() => el.remove(), 200)
  }

  setTimeout(remove, duration)
  el.addEventListener('click', remove)
  return remove
}

export const toast = {
  success: (msg, ms) => show(msg, 'success', ms),
  error:   (msg, ms) => show(msg, 'error',   ms),
  info:    (msg, ms) => show(msg, 'info',     ms),
}
