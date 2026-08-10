// Auto-redirect to setup if configuration is not complete
(async function checkSetup() {
  // Only check if we're not already on the setup page
  if (window.location.pathname === '/setup' || window.location.pathname.startsWith('/setup/')) {
    return;
  }

  try {
    const response = await fetch('/api/config-status', {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' }
    });

    if (response.ok) {
      const data = await response.json();

      if (data.setupRequired && data.setupUrl) {
        console.log('Setup required, redirecting to setup wizard...');
        window.location.href = data.setupUrl;
      }
    }
  } catch (error) {
    // If the request fails, the normal server might be running
    // so we don't redirect
    console.log('Config status check failed, assuming setup complete');
  }
})();
