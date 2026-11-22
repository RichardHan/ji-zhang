(function () {
  var STORAGE_KEY = 'jizhang_server_url';

  var formWrap = document.getElementById('form-wrap');
  var form = document.getElementById('form');
  var input = document.getElementById('server-url');
  var errorEl = document.getElementById('error');
  var clearBtn = document.getElementById('clear-btn');
  var redirecting = document.getElementById('redirecting');
  var cancelRedirect = document.getElementById('cancel-redirect');
  var redirectTimer = null;

  function params() {
    return new URLSearchParams(window.location.search);
  }

  function showError(message) {
    errorEl.textContent = message;
    errorEl.classList.toggle('visible', !!message);
  }

  function normalizeServerUrl(raw) {
    var value = (raw || '').trim();
    if (!value) {
      throw new Error('請輸入伺服器網址。');
    }
    if (!/^https?:\/\//i.test(value)) {
      throw new Error('網址必須以 http:// 或 https:// 開頭。');
    }
    var url;
    try {
      url = new URL(value);
    } catch (e) {
      throw new Error('這不是有效的網址。');
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new Error('只接受 http 或 https 網址。');
    }
    if (!url.hostname) {
      throw new Error('網址缺少主機名稱。');
    }
    var path = url.pathname.replace(/\/+$/, '');
    return url.origin + path;
  }

  function mobileUrl(serverUrl) {
    return serverUrl.replace(/\/+$/, '') + '/mobile';
  }

  function savedUrl() {
    try {
      return localStorage.getItem(STORAGE_KEY) || '';
    } catch (e) {
      return '';
    }
  }

  function saveUrl(url) {
    localStorage.setItem(STORAGE_KEY, url);
  }

  function clearUrl() {
    localStorage.removeItem(STORAGE_KEY);
  }

  function showForm(opts) {
    if (redirectTimer) {
      clearTimeout(redirectTimer);
      redirectTimer = null;
    }
    redirecting.classList.remove('visible');
    formWrap.style.display = '';
    var existing = savedUrl();
    if (existing && !input.value) {
      input.value = existing;
    }
    clearBtn.hidden = !existing;
    if (opts && opts.error) {
      showError(opts.error);
    }
    input.focus();
  }

  function goToServer(serverUrl) {
    window.location.replace(mobileUrl(serverUrl));
  }

  form.addEventListener('submit', function (event) {
    event.preventDefault();
    showError('');
    try {
      var url = normalizeServerUrl(input.value);
      saveUrl(url);
      goToServer(url);
    } catch (err) {
      showError(err.message || '無法儲存網址。');
    }
  });

  clearBtn.addEventListener('click', function () {
    clearUrl();
    input.value = '';
    clearBtn.hidden = true;
    showError('');
    input.focus();
  });

  cancelRedirect.addEventListener('click', function () {
    showForm();
  });

  var query = params();
  var forceSettings = query.has('settings') || query.has('change') || query.get('open') === 'settings';
  var loadError = query.has('error');
  var existing = savedUrl();

  if (loadError) {
    showForm({
      error: '無法連上伺服器。請確認網址、網路，以及伺服器是否已啟動，然後再試一次。'
    });
    return;
  }

  if (forceSettings) {
    showForm();
    return;
  }

  if (existing) {
    formWrap.style.display = 'none';
    redirecting.classList.add('visible');
    redirectTimer = setTimeout(function () {
      goToServer(existing);
    }, 250);
    return;
  }

  showForm();
})();
