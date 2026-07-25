(function () {
  var currentHost = window.location.host;
  var currentProtocol = window.location.protocol;
  var currentDohPath = window.__DOH_PATH__ || 'dns-query';
  var currentDohUrl = currentProtocol + '//' + currentHost + '/' + currentDohPath;
  var activeDohUrl = currentDohUrl;

  var BLOCKED_IPV4 = [
    '104.21.16.1', '104.21.32.1', '104.21.48.1',
    '104.21.64.1', '104.21.80.1', '104.21.96.1', '104.21.112.1'
  ];
  var BLOCKED_IPV6 = [
    '2606:4700:3030::6815:1001', '2606:4700:3030::6815:3001',
    '2606:4700:3030::6815:7001', '2606:4700:3030::6815:5001'
  ];

  function isBlockedIP(ip) {
    return BLOCKED_IPV4.indexOf(ip) !== -1 || BLOCKED_IPV6.indexOf(ip) !== -1;
  }

  function getTheme() {
    return document.documentElement.getAttribute('data-theme');
  }

  function setTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
  }

  function initTheme() {
    var saved = localStorage.getItem('theme');
    if (saved === 'dark' || saved === 'light') {
      setTheme(saved);
      return;
    }
    var prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    setTheme(prefersDark ? 'dark' : 'light');
  }

  function toggleTheme() {
    var current = getTheme();
    setTheme(current === 'dark' ? 'light' : 'dark');
  }

  function formatTTL(seconds) {
    if (seconds < 60) return seconds + '\u79D2';
    if (seconds < 3600) return Math.floor(seconds / 60) + '\u5206\u949F';
    if (seconds < 86400) return Math.floor(seconds / 3600) + '\u5C0F\u65F6';
    return Math.floor(seconds / 86400) + '\u5929';
  }

  function handleCopy(text, element) {
    navigator.clipboard.writeText(text).then(function () {
      element.classList.add('copied');
      setTimeout(function () { element.classList.remove('copied'); }, 1500);
    }).catch(function (err) {
      console.error(err);
    });
  }

  function showSection(section) {
    document.getElementById('resultSection').style.display = section === 'result' ? '' : 'none';
    document.getElementById('errorSection').style.display = section === 'error' ? '' : 'none';
  }

  function setStatus(mode, text) {
    var bar = document.getElementById('statusBar');
    bar.classList.remove('loading', 'error', 'success');
    if (mode) bar.classList.add(mode);
    document.getElementById('statusText').textContent = text;
  }

  function createBadge(type) {
    var cls = 'type-other';
    if (type === 1 || type === 'A') cls = 'type-a';
    else if (type === 28 || type === 'AAAA') cls = 'type-aaaa';
    else if (type === 2 || type === 'NS') cls = 'type-ns';
    else if (type === 6 || type === 'SOA') cls = 'type-soa';
    else if (type === 5 || type === 'CNAME') cls = 'type-cname';
    var span = document.createElement('span');
    span.className = 'record-badge ' + cls;
    span.textContent = type === 1 ? 'A' : type === 28 ? 'AAAA' : type === 2 ? 'NS' : type === 6 ? 'SOA' : type === 5 ? 'CNAME' : '#' + type;
    return span;
  }

  function createGeoInfo(ip) {
    var span = document.createElement('span');
    span.className = 'record-geo';

    if (isBlockedIP(ip)) {
      var blocked = document.createElement('span');
      blocked.className = 'geo-blocked';
      blocked.textContent = '\u963B\u65AD IP';
      span.appendChild(blocked);

      (function (el, addr) {
        fetch('./ip-info?ip=' + addr + '&token=' + currentDohPath).then(function (r) { return r.json(); }).then(function (d) {
          if (d && d.status === 'success' && d.as) {
            var as = document.createElement('span');
            as.className = 'geo-as';
            as.textContent = d.as;
            el.appendChild(as);
          }
        }).catch(function () {});
      })(span, ip);

      return span;
    }

    var loading = document.createElement('span');
    loading.className = 'geo-loading';
    loading.textContent = '\u5B9A\u4F4D\u4E2D\u2026';
    span.appendChild(loading);

    (function (el, addr) {
      fetch('./ip-info?ip=' + addr + '&token=' + currentDohPath).then(function (r) { return r.json(); }).then(function (d) {
        el.innerHTML = '';
        if (d && d.status === 'success') {
          var country = document.createElement('span');
          country.className = 'geo-country';
          country.textContent = d.country || '\u672A\u77E5';
          el.appendChild(country);
          if (d.as) {
            var as = document.createElement('span');
            as.className = 'geo-as';
            as.textContent = d.as;
            el.appendChild(as);
          }
        } else {
          el.textContent = '';
        }
      }).catch(function () {
        el.textContent = '';
      });
    })(span, ip);

    return span;
  }

  function renderRecordRow(record) {
    var row = document.createElement('div');
    row.className = 'record-row';

    var value = document.createElement('span');
    value.className = 'record-value';
    var displayText = record.data || record.name || '';
    value.textContent = displayText;
    value.setAttribute('data-value', displayText);
    value.addEventListener('click', function (e) {
      handleCopy(this.getAttribute('data-value'), this);
    });
    row.appendChild(value);

    row.appendChild(createBadge(record.type));

    var ttl = document.createElement('span');
    ttl.className = 'record-ttl';
    ttl.textContent = record.TTL ? formatTTL(record.TTL) : '';
    row.appendChild(ttl);

    return row;
  }

  function renderSOADetails(record) {
    var container = document.createElement('div');
    container.className = 'soa-details';
    var parts = (record.data || '').split(' ');
    if (parts.length >= 7) {
      var adminEmail = parts[1].replace('.', '@');
      if (adminEmail.endsWith('.')) adminEmail = adminEmail.slice(0, -1);
      var lines = [
        { label: '\u4E3B NS', value: parts[0] },
        { label: '\u7BA1\u7406\u90AE\u7BB1', value: adminEmail },
        { label: '\u5E8F\u5217\u53F7', value: parts[2] },
        { label: '\u5237\u65B0\u95F4\u9694', value: formatTTL(parts[3]) },
        { label: '\u91CD\u8BD5\u95F4\u9694', value: formatTTL(parts[4]) },
        { label: '\u8FC7\u671F\u65F6\u95F4', value: formatTTL(parts[5]) },
        { label: '\u6700\u5C0F TTL', value: formatTTL(parts[6]) }
      ];
      var html = '';
      for (var i = 0; i < lines.length; i++) {
        var val = lines[i].value;
        html += '<div><strong>' + lines[i].label + ':</strong> ';
        if (i < 2) {
          html += '<span class="record-value" data-value="' + val.replace(/"/g, '&quot;') + '">' + val + '</span></div>';
        } else {
          html += val + '</div>';
        }
      }
      container.innerHTML = html;
      container.querySelectorAll('.record-value').forEach(function (el) {
        el.addEventListener('click', function (e) {
          e.stopPropagation();
          handleCopy(this.getAttribute('data-value'), this);
        });
      });
    }
    return container;
  }

  function renderRecordGroup(type, records) {
    var summaryEl = document.getElementById('summary-' + type);
    var listEl = document.getElementById('records-' + type);
    listEl.innerHTML = '';

    if (!records || records.length === 0) {
      summaryEl.textContent = '\u65E0 ' + type.toUpperCase() + ' \u8BB0\u5F55';
      return;
    }

    var typeLabel = type === 'ipv4' ? 'IPv4' : type === 'ipv6' ? 'IPv6' : 'NS';
    summaryEl.textContent = '\u627E\u5230 ' + records.length + ' \u6761 ' + typeLabel + ' \u8BB0\u5F55';

    for (var i = 0; i < records.length; i++) {
      var record = records[i];

      if (record.type === 6) {
        var row = renderRecordRow(record);
        listEl.appendChild(row);
        listEl.appendChild(renderSOADetails(record));
        continue;
      }

      var row = renderRecordRow(record);

      if (record.type === 1 || record.type === 28) {
        var geo = createGeoInfo(record.data);
        var geoWrapper = document.createElement('span');
        geoWrapper.className = 'record-geo';
        geoWrapper.innerHTML = geo.innerHTML;
        row.insertBefore(geoWrapper, row.lastElementChild);

        var valueSpan = row.querySelector('.record-value');
        if (geo.querySelector('.geo-loading')) {
          (function (vw, addr) {
            fetch('./ip-info?ip=' + addr + '&token=' + currentDohPath).then(function (r) { return r.json(); }).then(function (d) {
              var el = vw.querySelector('.record-geo');
              if (!el) return;
              el.innerHTML = '';
              if (d && d.status === 'success') {
                var country = document.createElement('span');
                country.className = 'geo-country';
                country.textContent = d.country || '\u672A\u77E5';
                el.appendChild(country);
                if (d.as) {
                  var as = document.createElement('span');
                  as.className = 'geo-as';
                  as.textContent = d.as;
                  el.appendChild(as);
                }
              }
            }).catch(function () {});
          })(row, record.data);
        }
      }

      listEl.appendChild(row);
    }
  }

  function displayRecords(data) {
    showSection('result');
    setStatus('success', '\u89E3\u6790\u5B8C\u6210');

    document.getElementById('resultRaw').textContent = JSON.stringify(data, null, 2);

    renderRecordGroup('ipv4', data.ipv4 && data.ipv4.records ? data.ipv4.records : []);
    renderRecordGroup('ipv6', data.ipv6 && data.ipv6.records ? data.ipv6.records : []);

    var nsRecords = [];
    if (data.ns && data.ns.records) {
      nsRecords = data.ns.records;
    } else {
      if (data.Answer) {
        for (var i = 0; i < data.Answer.length; i++) {
          if (data.Answer[i].type === 2 || data.Answer[i].type === 6) {
            nsRecords.push(data.Answer[i]);
          }
        }
      }
      if (data.Authority) {
        for (var i = 0; i < data.Authority.length; i++) {
          if (data.Authority[i].type === 2 || data.Authority[i].type === 6) {
            nsRecords.push(data.Authority[i]);
          }
        }
      }
    }
    renderRecordGroup('ns', nsRecords);
  }

  function displayError(message) {
    showSection('error');
    setStatus('error', '\u89E3\u6790\u5931\u8D25');
    document.getElementById('errorMessage').textContent = message;
  }

  function showLoading() {
    showSection('result');
    document.getElementById('summary-ipv4').textContent = '\u67E5\u8BE2\u4E2D\u2026';
    document.getElementById('summary-ipv6').textContent = '\u67E5\u8BE2\u4E2D\u2026';
    document.getElementById('summary-ns').textContent = '\u67E5\u8BE2\u4E2D\u2026';
    document.getElementById('resultRaw').textContent = '\u67E5\u8BE2\u4E2D\u2026';
    document.getElementById('records-ipv4').innerHTML = '';
    document.getElementById('records-ipv6').innerHTML = '';
    document.getElementById('records-ns').innerHTML = '';
    setStatus('loading', '\u6B63\u5728\u89E3\u6790\u2026');
  }

  function init() {
    initTheme();

    document.getElementById('dohUrlDisplay').textContent = currentDohUrl;

    var dohDisplay = document.getElementById('dohUrlDisplay');
    dohDisplay.addEventListener('click', function () {
      handleCopy(currentDohUrl, this);
    });

    document.getElementById('themeToggle').addEventListener('click', toggleTheme);

    document.getElementById('dohSelect').addEventListener('change', function () {
      var container = document.getElementById('customDohContainer');
      container.classList.toggle('visible', this.value === 'custom');
      if (this.value === 'current') activeDohUrl = currentDohUrl;
      else if (this.value !== 'custom') activeDohUrl = this.value;
    });

    document.getElementById('clearBtn').addEventListener('click', function () {
      document.getElementById('domain').value = '';
      document.getElementById('domain').focus();
    });

    document.getElementById('getJsonBtn').addEventListener('click', function () {
      var domain = document.getElementById('domain').value;
      if (!domain) { alert('\u8BF7\u8F93\u5165\u57DF\u540D'); return; }
      var url = new URL(activeDohUrl);
      url.searchParams.set('name', domain);
      window.open(url.toString(), '_blank');
    });

    document.getElementById('resolveForm').addEventListener('submit', async function (e) {
      e.preventDefault();

      var selector = document.getElementById('dohSelect').value;
      var doh;
      if (selector === 'current') doh = currentDohUrl;
      else if (selector === 'custom') {
        doh = document.getElementById('customDoh').value;
        if (!doh) { alert('\u8BF7\u8F93\u5165\u81EA\u5B9A\u4E49 DoH \u5730\u5740'); return; }
      } else doh = selector;

      var domain = document.getElementById('domain').value;
      if (!domain) { alert('\u8BF7\u8F93\u5165\u57DF\u540D'); return; }

      localStorage.setItem('lastDomain', domain);

      showLoading();

      try {
        var r = await fetch('?doh=' + encodeURIComponent(doh) + '&domain=' + encodeURIComponent(domain) + '&type=all');
        if (!r.ok) throw new Error('HTTP ' + r.status);
        var json = await r.json();
        if (json.error) displayError(json.error);
        else displayRecords(json);
      } catch (err) {
        displayError('\u67E5\u8BE2\u5931\u8D25: ' + err.message);
      }
    });

    var tabs = document.querySelectorAll('.tabs-nav-btn');
    for (var i = 0; i < tabs.length; i++) {
      tabs[i].addEventListener('click', function () {
        var active = document.querySelector('.tabs-nav-btn.active');
        if (active) active.classList.remove('active');
        this.classList.add('active');

        var panes = document.querySelectorAll('.tabs-pane');
        for (var j = 0; j < panes.length; j++) panes[j].classList.remove('active');

        var target = document.getElementById(this.getAttribute('data-tab'));
        if (target) target.classList.add('active');
      });
    }

    var lastDomain = localStorage.getItem('lastDomain');
    if (lastDomain) document.getElementById('domain').value = lastDomain;

    document.querySelector('.tabs-nav-btn[data-tab="tab-ipv4"]').click();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
