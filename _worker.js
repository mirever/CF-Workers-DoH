let DoH = "cloudflare-dns.com";
const jsonDoH = `https://${DoH}/resolve`;
const dnsDoH = `https://${DoH}/dns-query`;
let DoH路径 = 'dns-query';

export default {
  async fetch(request, env) {
    if (env.DOH) {
      DoH = env.DOH;
      const match = DoH.match(/:\/\/([^\/]+)/);
      if (match) {
        DoH = match[1];
      }
    }
    DoH路径 = env.PATH || env.TOKEN || DoH路径;
    if (DoH路径.includes("/")) DoH路径 = DoH路径.split("/")[1];

    const url = new URL(request.url);
    const path = url.pathname;
    const hostname = url.hostname;

    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': '*',
          'Access-Control-Max-Age': '86400'
        }
      });
    }

    if (path === `/${DoH路径}`) {
      return await DOHRequest(request);
    }

    if (path === '/ip-info') {
      return await handleIpInfo(request, env);
    }

    if (url.searchParams.has("doh")) {
      return await handleDnsQuery(request, url, hostname);
    }

    if (env.URL302) return Response.redirect(env.URL302, 302);
    else if (env.URL) {
      if (env.URL.toString().toLowerCase() == 'nginx') {
        return new Response(await nginx(), {
          headers: { 'Content-Type': 'text/html; charset=UTF-8' }
        });
      } else return await 代理URL(env.URL, url);
    } else return await HTML();
  }
};

async function queryDns(dohServer, domain, type) {
  const dohUrl = new URL(dohServer);
  dohUrl.searchParams.set("name", domain);
  dohUrl.searchParams.set("type", type);

  const fetchOptions = [
    { headers: { 'Accept': 'application/dns-json' } },
    { headers: {} },
    { headers: { 'Accept': 'application/json' } },
    { headers: { 'Accept': 'application/dns-json', 'User-Agent': 'Mozilla/5.0 DNS Client' } }
  ];

  let lastError = null;
  for (const options of fetchOptions) {
    try {
      const response = await fetch(dohUrl.toString(), options);
      if (response.ok) {
        const contentType = response.headers.get('content-type') || '';
        if (contentType.includes('json') || contentType.includes('dns-json')) {
          return await response.json();
        } else {
          const textResponse = await response.text();
          try { return JSON.parse(textResponse); }
          catch (jsonError) {
            throw new Error(`无法解析响应为JSON: ${jsonError.message}, 响应内容: ${textResponse.substring(0, 100)}`);
          }
        }
      }
      const errorText = await response.text();
      lastError = new Error(`DoH 服务器返回错误 (${response.status}): ${errorText.substring(0, 200)}`);
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError || new Error("无法完成 DNS 查询");
}

async function handleLocalDohRequest(domain, type) {
  try {
    if (type === "all") {
      const [ipv4Result, ipv6Result, nsResult] = await Promise.all([
        queryDns(dnsDoH, domain, "A"),
        queryDns(dnsDoH, domain, "AAAA"),
        queryDns(dnsDoH, domain, "NS")
      ]);

      const nsRecords = [];
      if (nsResult.Answer && nsResult.Answer.length > 0) {
        nsRecords.push(...nsResult.Answer.filter(record => record.type === 2));
      }
      if (nsResult.Authority && nsResult.Authority.length > 0) {
        nsRecords.push(...nsResult.Authority.filter(record => record.type === 2 || record.type === 6));
      }

      const combinedResult = {
        Status: ipv4Result.Status || ipv6Result.Status || nsResult.Status,
        TC: ipv4Result.TC || ipv6Result.TC || nsResult.TC,
        RD: ipv4Result.RD || ipv6Result.RD || nsResult.RD,
        RA: ipv4Result.RA || ipv6Result.RA || nsResult.RA,
        AD: ipv4Result.AD || ipv6Result.AD || nsResult.AD,
        CD: ipv4Result.CD || ipv6Result.CD || nsResult.CD,
        Question: [...(ipv4Result.Question || []), ...(ipv6Result.Question || []), ...(nsResult.Question || [])],
        Answer: [...(ipv4Result.Answer || []), ...(ipv6Result.Answer || []), ...nsRecords],
        ipv4: { records: ipv4Result.Answer || [] },
        ipv6: { records: ipv6Result.Answer || [] },
        ns: { records: nsRecords }
      };

      return new Response(JSON.stringify(combinedResult, null, 2), {
        headers: { "content-type": "application/json; charset=UTF-8", 'Access-Control-Allow-Origin': '*' }
      });
    } else {
      const result = await queryDns(dnsDoH, domain, type);
      return new Response(JSON.stringify(result, null, 2), {
        headers: { "content-type": "application/json; charset=UTF-8", 'Access-Control-Allow-Origin': '*' }
      });
    }
  } catch (err) {
    return new Response(JSON.stringify({ error: `DoH 查询失败: ${err.message}` }, null, 2), {
      headers: { "content-type": "application/json; charset=UTF-8", 'Access-Control-Allow-Origin': '*' },
      status: 500
    });
  }
}

async function handleDnsQuery(request, url, hostname) {
  const domain = url.searchParams.get("domain") || url.searchParams.get("name") || "www.google.com";
  const doh = url.searchParams.get("doh") || dnsDoH;
  const type = url.searchParams.get("type") || "all";

  if (doh.includes(hostname)) {
    return await handleLocalDohRequest(domain, type);
  }

  try {
    if (type === "all") {
      const [ipv4Result, ipv6Result, nsResult] = await Promise.all([
        queryDns(doh, domain, "A"),
        queryDns(doh, domain, "AAAA"),
        queryDns(doh, domain, "NS")
      ]);

      const combinedResult = {
        Status: ipv4Result.Status || ipv6Result.Status || nsResult.Status,
        TC: ipv4Result.TC || ipv6Result.TC || nsResult.TC,
        RD: ipv4Result.RD || ipv6Result.RD || nsResult.RD,
        RA: ipv4Result.RA || ipv6Result.RA || nsResult.RA,
        AD: ipv4Result.AD || ipv6Result.AD || nsResult.AD,
        CD: ipv4Result.CD || ipv6Result.CD || nsResult.CD,
        Question: [],
        Answer: [...(ipv4Result.Answer || []), ...(ipv6Result.Answer || [])],
        ipv4: { records: ipv4Result.Answer || [] },
        ipv6: { records: ipv6Result.Answer || [] },
        ns: { records: [] }
      };

      [ipv4Result, ipv6Result, nsResult].forEach(res => {
        if (res.Question) {
          if (Array.isArray(res.Question)) combinedResult.Question.push(...res.Question);
          else combinedResult.Question.push(res.Question);
        }
      });

      const nsRecords = [];
      if (nsResult.Answer && nsResult.Answer.length > 0) {
        nsResult.Answer.forEach(record => {
          if (record.type === 2) nsRecords.push(record);
        });
      }
      if (nsResult.Authority && nsResult.Authority.length > 0) {
        nsResult.Authority.forEach(record => {
          if (record.type === 2 || record.type === 6) {
            nsRecords.push(record);
            combinedResult.Answer.push(record);
          }
        });
      }
      combinedResult.ns.records = nsRecords;

      return new Response(JSON.stringify(combinedResult, null, 2), {
        headers: { "content-type": "application/json; charset=UTF-8" }
      });
    } else {
      const result = await queryDns(doh, domain, type);
      return new Response(JSON.stringify(result, null, 2), {
        headers: { "content-type": "application/json; charset=UTF-8" }
      });
    }
  } catch (err) {
    return new Response(JSON.stringify({ error: `DNS 查询失败: ${err.message}`, doh, domain }, null, 2), {
      headers: { "content-type": "application/json; charset=UTF-8" },
      status: 500
    });
  }
}

async function handleIpInfo(request, env) {
  const url = new URL(request.url);

  if (env.TOKEN) {
    const token = url.searchParams.get('token');
    if (token != env.TOKEN) {
      return new Response(JSON.stringify({
        status: "error", message: "Token不正确", code: "AUTH_FAILED",
        timestamp: new Date().toISOString()
      }, null, 4), {
        status: 403,
        headers: { "content-type": "application/json; charset=UTF-8", 'Access-Control-Allow-Origin': '*' }
      });
    }
  }

  const ip = url.searchParams.get('ip') || request.headers.get('CF-Connecting-IP');
  if (!ip) {
    return new Response(JSON.stringify({
      status: "error", message: "IP参数未提供", code: "MISSING_PARAMETER",
      timestamp: new Date().toISOString()
    }, null, 4), {
      status: 400,
      headers: { "content-type": "application/json; charset=UTF-8", 'Access-Control-Allow-Origin': '*' }
    });
  }

  try {
    const response = await fetch(`http://ip-api.com/json/${ip}?lang=zh-CN`);
    if (!response.ok) throw new Error(`HTTP error: ${response.status}`);
    const data = await response.json();
    data.timestamp = new Date().toISOString();
    return new Response(JSON.stringify(data, null, 4), {
      headers: { "content-type": "application/json; charset=UTF-8", 'Access-Control-Allow-Origin': '*' }
    });
  } catch (error) {
    return new Response(JSON.stringify({
      status: "error", message: `IP查询失败: ${error.message}`, code: "API_REQUEST_FAILED",
      query: ip, timestamp: new Date().toISOString()
    }, null, 4), {
      status: 500,
      headers: { "content-type": "application/json; charset=UTF-8", 'Access-Control-Allow-Origin': '*' }
    });
  }
}

async function DOHRequest(request) {
  const { method, headers, body } = request;
  const UA = headers.get('User-Agent') || 'DoH Client';
  const url = new URL(request.url);
  const { searchParams } = url;

  try {
    if (method === 'GET' && !url.search) {
      return new Response('Bad Request', {
        status: 400,
        headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Access-Control-Allow-Origin': '*' }
      });
    }

    let response;
    if (method === 'GET' && searchParams.has('name')) {
      const searchDoH = searchParams.has('type') ? url.search : url.search + '&type=A';
      response = await fetch(dnsDoH + searchDoH, {
        headers: { 'Accept': 'application/dns-json', 'User-Agent': UA }
      });
      if (!response.ok) response = await fetch(jsonDoH + searchDoH, {
        headers: { 'Accept': 'application/dns-json', 'User-Agent': UA }
      });
    } else if (method === 'GET') {
      response = await fetch(dnsDoH + url.search, {
        headers: { 'Accept': 'application/dns-message', 'User-Agent': UA }
      });
    } else if (method === 'POST') {
      response = await fetch(dnsDoH, {
        method: 'POST',
        headers: { 'Accept': 'application/dns-message', 'Content-Type': 'application/dns-message', 'User-Agent': UA },
        body: body
      });
    } else {
      return new Response('不支持的请求格式: DoH请求需要包含name或dns参数，或使用POST方法', {
        status: 400,
        headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Access-Control-Allow-Origin': '*' }
      });
    }

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`DoH 返回错误 (${response.status}): ${errorText.substring(0, 200)}`);
    }

    const responseHeaders = new Headers(response.headers);
    responseHeaders.set('Access-Control-Allow-Origin', '*');
    responseHeaders.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    responseHeaders.set('Access-Control-Allow-Headers', '*');
    if (method === 'GET' && searchParams.has('name')) {
      responseHeaders.set('Content-Type', 'application/json');
    }

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: `DoH 请求处理错误: ${error.message}` }, null, 4), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }
}

async function HTML() {
  const html = `<!DOCTYPE html>
<html lang="zh-CN" data-theme="">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>DNS 解析工具</title>
<style>:root {
  --color-bg: #ffffff;
  --color-surface: #f8f8f8;
  --color-surface-hover: #f0f0f0;
  --color-border: #e5e5e5;
  --color-border-hover: #d0d0d0;
  --color-text: #1a1a1a;
  --color-text-secondary: #6b6b6b;
  --color-text-tertiary: #a0a0a0;
  --color-text-placeholder: #b0b0b0;
  --color-accent: #1a1a1a;
  --color-accent-hover: #333333;
  --color-accent-surface: #f0f0f0;
  --color-accent-border: #cccccc;
  --color-success: #22c55e;
  --color-success-bg: #f0fdf4;
  --color-warning: #d97706;
  --color-warning-bg: #fffbeb;
  --color-error: #dc2626;
  --color-error-bg: #fef2f2;
  --color-info: #2563eb;
  --color-geo-country: #525252;
  --color-geo-as: #737373;
  --color-geo-blocked: #dc2626;
  --color-geo-blocked-bg: #fef2f2;
  --color-record-hover: #f5f5f5;
  --color-overlay: rgba(0,0,0,0.5);
  --font-sans: 'Inter', system-ui, -apple-system, sans-serif;
  --font-mono: 'JetBrains Mono', 'SF Mono', 'Fira Code', 'Cascadia Code', monospace;
  --text-xs: 11px;
  --text-sm: 13px;
  --text-base: 14px;
  --text-lg: 16px;
  --text-xl: 20px;
  --text-2xl: 24px;
  --leading-tight: 1.25;
  --leading-normal: 1.5;
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 20px;
  --space-6: 24px;
  --space-8: 32px;
  --space-10: 40px;
  --space-12: 48px;
  --radius-sm: 4px;
  --radius-md: 8px;
  --radius-lg: 12px;
  --shadow-sm: 0 1px 2px rgba(0,0,0,0.04);
  --shadow-md: 0 4px 12px rgba(0,0,0,0.06);
  --shadow-lg: 0 8px 24px rgba(0,0,0,0.08);
  --transition-fast: 120ms ease;
  --transition-normal: 200ms ease;
  --max-width: 720px;
}

@media (prefers-color-scheme: dark) {
  :root {
    --color-bg: #0a0a0a;
    --color-surface: #141414;
    --color-surface-hover: #1f1f1f;
    --color-border: #2a2a2a;
    --color-border-hover: #3a3a3a;
    --color-text: #f0f0f0;
    --color-text-secondary: #a0a0a0;
    --color-text-tertiary: #666666;
    --color-text-placeholder: #555555;
    --color-accent: #f0f0f0;
    --color-accent-hover: #cccccc;
    --color-accent-surface: #1f1f1f;
    --color-accent-border: #3a3a3a;
    --color-success: #4ade80;
    --color-success-bg: #052e16;
    --color-warning: #fbbf24;
    --color-warning-bg: #451a03;
    --color-error: #f87171;
    --color-error-bg: #450a0a;
    --color-info: #60a5fa;
    --color-geo-country: #a3a3a3;
    --color-geo-as: #808080;
    --color-geo-blocked: #f87171;
    --color-geo-blocked-bg: #450a0a;
    --color-record-hover: #1a1a1a;
    --color-overlay: rgba(0,0,0,0.7);
    --shadow-sm: 0 1px 2px rgba(0,0,0,0.3);
    --shadow-md: 0 4px 12px rgba(0,0,0,0.4);
    --shadow-lg: 0 8px 24px rgba(0,0,0,0.5);
  }
}

[data-theme="dark"] {
  --color-bg: #0a0a0a;
  --color-surface: #141414;
  --color-surface-hover: #1f1f1f;
  --color-border: #2a2a2a;
  --color-border-hover: #3a3a3a;
  --color-text: #f0f0f0;
  --color-text-secondary: #a0a0a0;
  --color-text-tertiary: #666666;
  --color-text-placeholder: #555555;
  --color-accent: #f0f0f0;
  --color-accent-hover: #cccccc;
  --color-accent-surface: #1f1f1f;
  --color-accent-border: #3a3a3a;
  --color-success: #4ade80;
  --color-success-bg: #052e16;
  --color-warning: #fbbf24;
  --color-warning-bg: #451a03;
  --color-error: #f87171;
  --color-error-bg: #450a0a;
  --color-info: #60a5fa;
  --color-geo-country: #a3a3a3;
  --color-geo-as: #808080;
  --color-geo-blocked: #f87171;
  --color-geo-blocked-bg: #450a0a;
  --color-record-hover: #1a1a1a;
  --color-overlay: rgba(0,0,0,0.7);
  --shadow-sm: 0 1px 2px rgba(0,0,0,0.3);
  --shadow-md: 0 4px 12px rgba(0,0,0,0.4);
  --shadow-lg: 0 8px 24px rgba(0,0,0,0.5);
}

[data-theme="light"] {
  --color-bg: #ffffff;
  --color-surface: #f8f8f8;
  --color-surface-hover: #f0f0f0;
  --color-border: #e5e5e5;
  --color-border-hover: #d0d0d0;
  --color-text: #1a1a1a;
  --color-text-secondary: #6b6b6b;
  --color-text-tertiary: #a0a0a0;
  --color-text-placeholder: #b0b0b0;
  --color-accent: #1a1a1a;
  --color-accent-hover: #333333;
  --color-accent-surface: #f0f0f0;
  --color-accent-border: #cccccc;
  --color-success: #22c55e;
  --color-success-bg: #f0fdf4;
  --color-warning: #d97706;
  --color-warning-bg: #fffbeb;
  --color-error: #dc2626;
  --color-error-bg: #fef2f2;
  --color-info: #2563eb;
  --color-geo-country: #525252;
  --color-geo-as: #737373;
  --color-geo-blocked: #dc2626;
  --color-geo-blocked-bg: #fef2f2;
  --color-record-hover: #f5f5f5;
  --shadow-sm: 0 1px 2px rgba(0,0,0,0.04);
  --shadow-md: 0 4px 12px rgba(0,0,0,0.06);
  --shadow-lg: 0 8px 24px rgba(0,0,0,0.08);
}

*, *::before, *::after {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

html {
  font-size: 16px;
  -webkit-text-size-adjust: 100%;
}

body {
  font-family: var(--font-sans);
  font-size: var(--text-base);
  line-height: var(--leading-normal);
  color: var(--color-text);
  background: var(--color-bg);
  min-height: 100vh;
  overflow-x: clip;
}

html, body {
  overflow-x: clip;
}

a {
  color: inherit;
  text-decoration: none;
}

button {
  font-family: inherit;
  cursor: pointer;
}

input, select, textarea {
  font-family: inherit;
  font-size: inherit;
}

.page-wrapper {
  max-width: var(--max-width);
  margin: 0 auto;
  padding: 0 var(--space-4);
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}

.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: var(--space-12);
  padding: var(--space-3) 0;
  border-bottom: 1px solid var(--color-border);
  flex-shrink: 0;
}

.header-brand {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  font-size: var(--text-lg);
  font-weight: 600;
  letter-spacing: -0.01em;
}

.header-brand-icon {
  width: 22px;
  height: 22px;
  border: 2px solid var(--color-accent);
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  font-weight: 700;
  flex-shrink: 0;
}

.header-actions {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}

.header-doh-url {
  font-size: var(--text-xs);
  font-family: var(--font-mono);
  color: var(--color-text-secondary);
  padding: var(--space-1) var(--space-2);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: all var(--transition-fast);
  max-width: 220px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.header-doh-url:hover {
  border-color: var(--color-border-hover);
  color: var(--color-text);
}

.header-doh-url.copied {
  border-color: var(--color-success);
  color: var(--color-success);
}

.theme-toggle {
  width: 34px;
  height: 34px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background: var(--color-surface);
  color: var(--color-text-secondary);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 15px;
  transition: all var(--transition-fast);
  flex-shrink: 0;
}

.theme-toggle:hover {
  background: var(--color-surface-hover);
  border-color: var(--color-border-hover);
  color: var(--color-text);
}

.main {
  flex: 1;
  padding: var(--space-6) 0;
}

.section {
  margin-bottom: var(--space-5);
}

.section:last-child {
  margin-bottom: 0;
}

.section-header {
  font-size: var(--text-xs);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--color-text-tertiary);
  margin-bottom: var(--space-3);
}

.card {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  overflow: hidden;
}

.card-body {
  padding: var(--space-5);
}

.form-group {
  margin-bottom: var(--space-4);
}

.form-group:last-child {
  margin-bottom: 0;
}

.form-label {
  display: block;
  font-size: var(--text-sm);
  font-weight: 500;
  color: var(--color-text-secondary);
  margin-bottom: var(--space-2);
}

.form-select,
.form-input {
  width: 100%;
  padding: var(--space-2) var(--space-3);
  font-size: var(--text-base);
  color: var(--color-text);
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  outline: none;
  transition: border-color var(--transition-fast), box-shadow var(--transition-fast);
  -webkit-appearance: none;
  appearance: none;
}

.form-select {
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%236b6b6b' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'%3E%3C/polyline%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 10px center;
  padding-right: 32px;
}

.form-select:focus,
.form-input:focus {
  border-color: var(--color-accent);
  box-shadow: 0 0 0 2px var(--color-accent-surface);
}

.form-input::placeholder {
  color: var(--color-text-placeholder);
}

.input-row {
  display: flex;
  gap: var(--space-2);
}

.input-row .form-input {
  flex: 1;
}

.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-1);
  padding: var(--space-2) var(--space-4);
  font-size: var(--text-sm);
  font-weight: 500;
  border-radius: var(--radius-sm);
  border: 1px solid transparent;
  transition: all var(--transition-fast);
  white-space: nowrap;
  line-height: 1;
  height: 36px;
}

.btn-primary {
  background: var(--color-accent);
  color: var(--color-bg);
  border-color: var(--color-accent);
}

.btn-primary:hover {
  background: var(--color-accent-hover);
  border-color: var(--color-accent-hover);
}

.btn-secondary {
  background: transparent;
  color: var(--color-text-secondary);
  border-color: var(--color-border);
}

.btn-secondary:hover {
  background: var(--color-surface-hover);
  border-color: var(--color-border-hover);
  color: var(--color-text);
}

.btn-ghost {
  background: transparent;
  color: var(--color-text-secondary);
  border-color: transparent;
}

.btn-ghost:hover {
  background: var(--color-surface-hover);
  color: var(--color-text);
}

.btn-sm {
  padding: var(--space-1) var(--space-3);
  font-size: var(--text-xs);
  height: 28px;
}

.form-actions {
  display: flex;
  gap: var(--space-2);
  margin-top: var(--space-5);
  padding-top: var(--space-5);
  border-top: 1px solid var(--color-border);
}

.form-actions .btn-primary {
  flex: 1;
}

.form-custom {
  margin-top: var(--space-3);
  padding: var(--space-3);
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  display: none;
}

.form-custom.visible {
  display: block;
}

.status-bar {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-3) var(--space-4);
  font-size: var(--text-sm);
  color: var(--color-text-secondary);
  border-bottom: 1px solid var(--color-border);
}

.status-bar.loading {
  color: var(--color-text);
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--color-text-tertiary);
  flex-shrink: 0;
}

.status-bar.loading .status-dot {
  background: var(--color-accent);
  animation: pulse 1.2s ease-in-out infinite;
}

.status-bar.error .status-dot {
  background: var(--color-error);
}

.status-bar.success .status-dot {
  background: var(--color-success);
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.3; }
}

.tabs-nav {
  display: flex;
  gap: 0;
  border-bottom: 1px solid var(--color-border);
  padding: 0 var(--space-4);
}

.tabs-nav-btn {
  padding: var(--space-3) var(--space-4);
  font-size: var(--text-sm);
  font-weight: 500;
  color: var(--color-text-secondary);
  background: none;
  border: none;
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
  transition: all var(--transition-fast);
}

.tabs-nav-btn:hover {
  color: var(--color-text);
}

.tabs-nav-btn.active {
  color: var(--color-text);
  border-bottom-color: var(--color-accent);
}

.tabs-content {
  padding: var(--space-4);
}

.tabs-pane {
  display: none;
}

.tabs-pane.active {
  display: block;
}

.record-summary {
  font-size: var(--text-sm);
  color: var(--color-text-secondary);
  margin-bottom: var(--space-3);
  padding: var(--space-2) var(--space-3);
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
}

.record-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}

.record-row {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  transition: background var(--transition-fast);
  font-size: var(--text-sm);
  min-height: 40px;
}

.record-row:hover {
  background: var(--color-record-hover);
}

.record-value {
  font-family: var(--font-mono);
  font-size: var(--text-sm);
  font-weight: 500;
  color: var(--color-text);
  cursor: pointer;
  transition: color var(--transition-fast);
  position: relative;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  flex-shrink: 1;
}

.record-value:hover {
  color: var(--color-text-secondary);
}

.record-value::after {
  content: '点击复制';
  position: absolute;
  left: 0;
  top: calc(100% + 4px);
  font-family: var(--font-sans);
  font-size: 10px;
  font-weight: 400;
  color: var(--color-text-tertiary);
  opacity: 0;
  transition: opacity var(--transition-fast);
  pointer-events: none;
  white-space: nowrap;
}

.record-value:hover::after {
  opacity: 1;
}

.record-value.copied {
  color: var(--color-success);
}

.record-value.copied::after {
  content: '已复制';
  color: var(--color-success);
  opacity: 1;
}

.record-badge {
  display: inline-flex;
  align-items: center;
  padding: 1px 6px;
  font-size: 10px;
  font-weight: 600;
  border-radius: 3px;
  line-height: 1.4;
  text-transform: uppercase;
  font-family: var(--font-mono);
  flex-shrink: 0;
}

.record-badge.type-a {
  color: var(--color-info);
  background: var(--color-accent-surface);
}

.record-badge.type-aaaa {
  color: var(--color-info);
  background: var(--color-accent-surface);
}

.record-badge.type-ns {
  color: var(--color-warning);
  background: var(--color-warning-bg);
}

.record-badge.type-soa {
  color: var(--color-warning);
  background: var(--color-warning-bg);
}

.record-badge.type-cname {
  color: var(--color-success);
  background: var(--color-success-bg);
}

.record-badge.type-other {
  color: var(--color-text-tertiary);
  background: var(--color-surface);
}

.record-geo {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex: 1;
  min-width: 0;
  justify-content: flex-end;
}

.record-geo .geo-country {
  font-size: var(--text-xs);
  color: var(--color-geo-country);
  padding: 1px 6px;
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: 3px;
  white-space: nowrap;
}

.record-geo .geo-as {
  font-size: var(--text-xs);
  color: var(--color-geo-as);
  white-space: nowrap;
}

.record-geo .geo-blocked {
  font-size: var(--text-xs);
  font-weight: 600;
  color: var(--color-geo-blocked);
  background: var(--color-geo-blocked-bg);
  padding: 1px 6px;
  border-radius: 3px;
}

.record-geo .geo-loading {
  font-size: var(--text-xs);
  color: var(--color-text-tertiary);
  font-style: italic;
}

.record-ttl {
  font-size: var(--text-xs);
  color: var(--color-text-tertiary);
  font-family: var(--font-mono);
  text-align: right;
  flex-shrink: 0;
  min-width: 70px;
}

.soa-details {
  font-size: var(--text-xs);
  color: var(--color-text-secondary);
  margin-top: var(--space-2);
  padding: var(--space-2) var(--space-3);
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  line-height: 1.8;
}

.soa-details strong {
  font-weight: 600;
  color: var(--color-text);
}

.soa-details .record-value {
  font-size: var(--text-xs);
}

.raw-json {
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  padding: var(--space-4);
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  line-height: 1.6;
  overflow: auto;
  max-height: 500px;
  white-space: pre-wrap;
  word-break: break-all;
  color: var(--color-text);
}

.empty-state {
  text-align: center;
  padding: var(--space-8) var(--space-4);
  color: var(--color-text-tertiary);
  font-size: var(--text-sm);
}

.error-state {
  padding: var(--space-4);
  background: var(--color-error-bg);
  border: 1px solid var(--color-error);
  border-radius: var(--radius-sm);
  color: var(--color-error);
  font-size: var(--text-sm);
  font-family: var(--font-mono);
  white-space: pre-wrap;
  word-break: break-all;
  line-height: 1.6;
}

.copy-link {
  cursor: pointer;
  transition: color var(--transition-fast);
}

.copy-link:hover {
  color: var(--color-text-secondary);
}

.copy-link.copied {
  color: var(--color-success);
}

.footer {
  padding: var(--space-4) 0;
  border-top: 1px solid var(--color-border);
  text-align: center;
  font-size: var(--text-xs);
  color: var(--color-text-tertiary);
  line-height: 2;
  flex-shrink: 0;
}

.footer a {
  color: var(--color-text-secondary);
  transition: color var(--transition-fast);
}

.footer a:hover {
  color: var(--color-text);
}

@media (max-width: 640px) {
  .page-wrapper {
    padding: 0 var(--space-3);
  }

  .header {
    height: auto;
    flex-wrap: wrap;
    gap: var(--space-2);
    padding: var(--space-3) 0;
  }

  .header-doh-url {
    max-width: 140px;
    font-size: 10px;
  }

  .card-body {
    padding: var(--space-4);
  }

  .input-row {
    flex-direction: column;
  }

  .form-actions {
    flex-direction: column;
  }

  .tabs-nav {
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
    scrollbar-width: none;
    gap: 0;
  }

  .tabs-nav::-webkit-scrollbar {
    display: none;
  }

  .tabs-nav-btn {
    padding: var(--space-3) var(--space-3);
    font-size: var(--text-sm);
    white-space: nowrap;
  }

  .tabs-content {
    padding: var(--space-3);
  }

  .record-row {
    flex-wrap: wrap;
    gap: var(--space-2);
    padding: var(--space-3);
  }

  .record-value {
    width: 100%;
    flex-basis: 100%;
  }

  .record-value::after {
    display: none;
  }

  .record-geo {
    flex: 1;
    justify-content: flex-start;
  }

  .record-ttl {
    min-width: auto;
  }
}

@media (max-width: 380px) {
  .header-brand {
    font-size: var(--text-base);
  }

  .header-doh-url {
    max-width: 100px;
  }

  .card-body {
    padding: var(--space-3);
  }

  .record-row {
    padding: var(--space-2) var(--space-2);
  }
}
</style>
</head>
<body>
<div class="page-wrapper">
  <header class="header">
    <div class="header-brand">
      <span class="header-brand-icon">D</span>
      DNS 解析工具
    </div>
    <div class="header-actions">
      <span class="header-doh-url" id="dohUrlDisplay" title="点击复制 DoH 地址">加载中…</span>
      <button class="theme-toggle" id="themeToggle" title="切换主题" aria-label="切换主题">&#9681;</button>
    </div>
  </header>

  <main class="main">
    <div class="section">
      <div class="section-header">查询</div>
      <div class="card">
        <div class="card-body">
          <form id="resolveForm">
            <div class="form-group">
              <label class="form-label" for="dohSelect">DoH 服务器</label>
              <select id="dohSelect" class="form-select">
                <option value="current" selected>当前站点</option>
                <option value="https://dns.alidns.com/resolve">dns.alidns.com（阿里）</option>
                <option value="https://sm2.doh.pub/dns-query">sm2.doh.pub（腾讯）</option>
                <option value="https://doh.360.cn/resolve">doh.360.cn（360）</option>
                <option value="https://cloudflare-dns.com/dns-query">cloudflare-dns.com（Cloudflare）</option>
                <option value="https://dns.google/resolve">dns.google（谷歌）</option>
                <option value="https://dns.adguard-dns.com/resolve">dns.adguard-dns.com（AdGuard）</option>
                <option value="https://dns.sb/dns-query">dns.sb（DNS.SB）</option>
                <option value="https://zero.dns0.eu/">zero.dns0.eu（dns0）</option>
                <option value="https://dns.nextdns.io">dns.nextdns.io（NextDNS）</option>
                <option value="https://dns.rabbitdns.org/dns-query">dns.rabbitdns.org（Rabbit DNS）</option>
                <option value="https://basic.rethinkdns.com/">basic.rethinkdns.com（RethinkDNS）</option>
                <option value="https://v.recipes/dns-query">v.recipes（v.recipes DNS）</option>
                <option value="custom">自定义…</option>
              </select>
            </div>

            <div class="form-custom" id="customDohContainer">
              <div class="form-group" style="margin-bottom:0">
                <label class="form-label" for="customDoh">自定义 DoH 地址</label>
                <input type="text" id="customDoh" class="form-input" placeholder="https://example.com/dns-query">
              </div>
            </div>

            <div class="form-group">
              <label class="form-label" for="domain">域名</label>
              <div class="input-row">
                <input type="text" id="domain" class="form-input" value="www.google.com" placeholder="example.com" autocomplete="off" spellcheck="false">
                <button type="button" class="btn btn-secondary" id="clearBtn">清除</button>
              </div>
            </div>

            <div class="form-actions">
              <button type="submit" class="btn btn-primary">查询</button>
              <button type="button" class="btn btn-secondary" id="getJsonBtn">获取 JSON</button>
            </div>
          </form>
        </div>
      </div>
    </div>

    <div class="section" id="resultSection" style="display:none">
      <div class="section-header">结果</div>
      <div class="card">
        <div class="status-bar" id="statusBar">
          <span class="status-dot"></span>
          <span id="statusText">就绪</span>
        </div>
        <div class="tabs-nav" id="resultTabs" role="tablist">
          <button class="tabs-nav-btn active" data-tab="tab-ipv4" role="tab">IPv4</button>
          <button class="tabs-nav-btn" data-tab="tab-ipv6" role="tab">IPv6</button>
          <button class="tabs-nav-btn" data-tab="tab-ns" role="tab">NS</button>
          <button class="tabs-nav-btn" data-tab="tab-raw" role="tab">Raw</button>
        </div>
        <div class="tabs-content">
          <div class="tabs-pane active" id="tab-ipv4" role="tabpanel">
            <div class="record-summary" id="summary-ipv4">等待查询…</div>
            <div class="record-list" id="records-ipv4"></div>
          </div>
          <div class="tabs-pane" id="tab-ipv6" role="tabpanel">
            <div class="record-summary" id="summary-ipv6">等待查询…</div>
            <div class="record-list" id="records-ipv6"></div>
          </div>
          <div class="tabs-pane" id="tab-ns" role="tabpanel">
            <div class="record-summary" id="summary-ns">等待查询…</div>
            <div class="record-list" id="records-ns"></div>
          </div>
          <div class="tabs-pane" id="tab-raw" role="tabpanel">
            <pre class="raw-json" id="resultRaw">等待查询…</pre>
          </div>
        </div>
      </div>
    </div>

    <div class="section" id="errorSection" style="display:none">
      <div class="section-header">错误</div>
      <div class="card">
        <div class="card-body">
          <div class="error-state" id="errorMessage"></div>
        </div>
      </div>
    </div>
  </main>

  <footer class="footer">
    <div>基于 Cloudflare Workers 的 DoH 解析服务</div>
    <div><a href="https://github.com/cmliu/CF-Workers-DoH" target="_blank" rel="noopener">GitHub</a></div>
  </footer>
</div>
<script>window.__DOH_PATH__ = '__DOH_PATH__';</script>
<script>(function () {
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
</script>
</body>
</html>
`.replace('__DOH_PATH__', DoH路径);
  return new Response(html, {
    headers: { "content-type": "text/html;charset=UTF-8" }
  });
}

async function 代理URL(代理网址, 目标网址) {
  const 网址列表 = await 整理(代理网址);
  const 完整网址 = 网址列表[Math.floor(Math.random() * 网址列表.length)];
  const 解析后的网址 = new URL(完整网址);
  const 协议 = 解析后的网址.protocol.slice(0, -1) || 'https';
  const 主机名 = 解析后的网址.hostname;
  let 路径名 = 解析后的网址.pathname;
  const 查询参数 = 解析后的网址.search;
  if (路径名.charAt(路径名.length - 1) == '/') 路径名 = 路径名.slice(0, -1);
  路径名 += 目标网址.pathname;
  const 新网址 = `${协议}://${主机名}${路径名}${查询参数}`;
  const 响应 = await fetch(新网址);
  let 新响应 = new Response(响应.body, { status: 响应.status, statusText: 响应.statusText, headers: 响应.headers });
  新响应.headers.set('X-New-URL', 新网址);
  return 新响应;
}

async function 整理(内容) {
  var 替换后的内容 = 内容.replace(/[	|"'\r\n]+/g, ',').replace(/,+/g, ',');
  if (替换后的内容.charAt(0) == ',') 替换后的内容 = 替换后的内容.slice(1);
  if (替换后的内容.charAt(替换后的内容.length - 1) == ',') 替换后的内容 = 替换后的内容.slice(0, 替换后的内容.length - 1);
  return 替换后的内容.split(',');
}

async function nginx() {
  return `<!DOCTYPE html>
<html>
<head>
<title>Welcome to nginx!</title>
<style>
body { width: 35em; margin: 0 auto; font-family: Tahoma, Verdana, Arial, sans-serif; }
</style>
</head>
<body>
<h1>Welcome to nginx!</h1>
<p>If you see this page, the nginx web server is successfully installed and working. Further configuration is required.</p>
<p>For online documentation and support please refer to <a href="http://nginx.org/">nginx.org</a>.<br/>
Commercial support is available at <a href="http://nginx.com/">nginx.com</a>.</p>
<p><em>Thank you for using nginx.</em></p>
</body>
</html>`;
}
