document.getElementById('loginForm').addEventListener('submit', async event => {
  event.preventDefault();
  const error = document.getElementById('error');
  error.textContent = '';
  try {
    const response = await fetch('/api/login', { method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: document.getElementById('token').value }) });
    if (!response.ok) throw new Error('访问令牌错误');
    location.replace('/');
  } catch (cause) {
    error.textContent = cause.message;
  }
});
