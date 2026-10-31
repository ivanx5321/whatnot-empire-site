// Copy buttons
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-copy],[data-copy-text]');
  if (!b) return;
  const el = document.getElementById(b.dataset.copy || b.dataset.copyText);
  if (!el) return;
  const text = el.value || el.textContent;
  (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject()).catch(() => { el.select && el.select(); document.execCommand('copy'); });
  const old = b.textContent; b.textContent = 'Copied ✓'; setTimeout(() => { b.textContent = old; }, 1500);
});

// Ask Levi AI: send without reloading the page.
const form = document.getElementById('askForm');
if (form) {
  const msgs = document.getElementById('msgs');
  const box = document.getElementById('q');
  const scroll = () => { msgs.scrollTop = msgs.scrollHeight; };
  scroll();
  box.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); form.requestSubmit(); } });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const q = box.value.trim();
    if (!q) return;
    document.getElementById('empty')?.remove();
    const u = document.createElement('div'); u.className = 'msg user'; u.textContent = q; msgs.appendChild(u);
    const a = document.createElement('div'); a.className = 'msg assistant typing'; a.textContent = 'Levi AI is typing…'; msgs.appendChild(a);
    box.value = ''; scroll();
    const btn = form.querySelector('button'); btn.disabled = true;
    try {
      const res = await fetch('/ask', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' }, body: new URLSearchParams({ q }) });
      const data = await res.json();
      a.classList.remove('typing'); a.innerHTML = data.html; // server-escaped markdown
    } catch {
      a.classList.remove('typing'); a.textContent = 'Something went wrong. Try again.';
    } finally { btn.disabled = false; scroll(); box.focus(); }
  });
}
