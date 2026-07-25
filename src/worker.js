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
  const html = `/* INLINE_HTML */`.replace('__DOH_PATH__', DoH路径);
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
