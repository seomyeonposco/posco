let _config = null;
const STORAGE_CACHE_KEY = 'posco_board_posts_cache';
const CACHE_TTL_MS = 3 * 60 * 1000;

async function loadConfig() {
  if (_config) return _config;
  let api = {}, file = {};
  try { const r = await fetch('/api/config'); if (r.ok) api = await r.json(); } catch (e) {}
  try { const r = await fetch('config/git_config.json'); if (r.ok) file = await r.json(); } catch (e) {}
  const apiTok = String(api.github_token || '').replace(/\s+/g, '');
  const fileTok = String(file.github_token || '').replace(/\s+/g, '');
  _config = {
    github_token: (apiTok && apiTok !== 'YOUR_GITHUB_TOKEN') ? apiTok : fileTok,
    github_owner: String(file.github_owner || '').trim(),
    github_repo: String(file.github_repo || '').trim(),
    data_file_path: String(file.data_file_path || 'data/posts.json').trim(),
    admin_password: String(api.admin_password || file.admin_password || 'admin1234').trim()
  };
  return _config;
}

function isAdmin() {
  return sessionStorage.getItem('isAdmin') === 'true';
}

function requireAdmin() {
  if (!isAdmin()) {
    window.location.href = 'admin.html';
    return false;
  }
  return true;
}

function handleAgentLogin(event) {
  if (event && typeof event.preventDefault === 'function') {
    event.preventDefault();
  }
  window.location.href = 'admin.html';
}

function logoutAdmin() {
  sessionStorage.removeItem('isAdmin');
  window.location.reload();
}

function encodeUtf8Base64(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function decodeUtf8Base64(base64) {
  const clean = String(base64 || '').replace(/\s+/g, '');
  const binary = atob(clean);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder().decode(bytes);
}

function sortPostsDesc(posts) {
  if (!Array.isArray(posts)) return [];
  return posts.slice().sort(function (a, b) {
    const da = String(a.date || '');
    const db = String(b.date || '');
    if (da !== db) return db.localeCompare(da);
    return String(b.id || '').localeCompare(String(a.id || ''));
  });
}

function writeLocalCache(posts) {
  try {
    localStorage.setItem(STORAGE_CACHE_KEY, JSON.stringify({
      updatedAt: Date.now(),
      posts: posts
    }));
  } catch (e) {}
}

function readLocalCache() {
  try {
    const raw = localStorage.getItem(STORAGE_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.posts)) return null;
    return parsed;
  } catch (e) {
    return null;
  }
}

async function fetchPostsFromGitHub(cfg) {
  const cleanToken = String(cfg.github_token || '').replace(/\s+/g, '');
  if (!cleanToken || cleanToken === 'YOUR_GITHUB_TOKEN' || !cfg.github_owner || !cfg.github_repo) {
    return null;
  }
  const url = 'https://api.github.com/repos/' + encodeURIComponent(cfg.github_owner) + '/' + encodeURIComponent(cfg.github_repo) + '/contents/' + cfg.data_file_path + '?ref=main&t=' + Date.now();
  const res = await fetch(url, {
    headers: {
      'Authorization': 'token ' + cleanToken,
      'Accept': 'application/vnd.github.v3+json'
    },
    cache: 'no-store'
  });
  if (!res.ok) return null;
  const data = await res.json();
  if (!data || !data.content) return null;
  const parsed = JSON.parse(decodeUtf8Base64(data.content));
  return Array.isArray(parsed) ? parsed : [];
}

async function getPosts() {
  const cfg = await loadConfig();
  const cache = readLocalCache();

  if (isAdmin()) {
    try {
      const ghPosts = await fetchPostsFromGitHub(cfg);
      if (ghPosts) {
        const sorted = sortPostsDesc(ghPosts);
        writeLocalCache(sorted);
        return sorted;
      }
    } catch (e) {}
  }

  if (cache && (Date.now() - cache.updatedAt) < CACHE_TTL_MS) {
    return sortPostsDesc(cache.posts);
  }

  try {
    const r = await fetch(cfg.data_file_path + '?t=' + Date.now(), { cache: 'no-store' });
    if (r.ok) {
      const data = await r.json();
      if (Array.isArray(data)) {
        return sortPostsDesc(data);
      }
    }
  } catch (e) {}

  if (cache) {
    return sortPostsDesc(cache.posts);
  }
  return [];
}

async function getPostById(id) {
  const posts = await getPosts();
  return posts.find(function (p) { return String(p.id) === String(id); }) || null;
}

async function savePostsToGitHub(posts, commitMessage) {
  const cfg = await loadConfig();
  const cleanToken = String(cfg.github_token || '').replace(/\s+/g, '');
  if (!cleanToken || cleanToken === 'YOUR_GITHUB_TOKEN') {
    throw new Error('GitHub 토큰이 설정되지 않았습니다. Vercel 환경변수(GITHUB_TOKEN)를 확인해 주세요.');
  }
  if (!cfg.github_owner || !cfg.github_repo) {
    throw new Error('GitHub 저장소 정보(github_owner / github_repo)가 설정되지 않았습니다.');
  }

  const sorted = sortPostsDesc(posts);
  const apiUrl = 'https://api.github.com/repos/' + encodeURIComponent(cfg.github_owner) + '/' + encodeURIComponent(cfg.github_repo) + '/contents/' + cfg.data_file_path;

  let currentSha = null;
  const getRes = await fetch(apiUrl + '?t=' + Date.now(), {
    headers: {
      'Authorization': 'token ' + cleanToken,
      'Accept': 'application/vnd.github.v3+json'
    },
    cache: 'no-store'
  });

  if (getRes.ok) {
    const existing = await getRes.json();
    currentSha = existing.sha || null;
  } else if (getRes.status !== 404) {
    let errMsg = getRes.statusText;
    try {
      const errJson = await getRes.json();
      if (errJson && errJson.message) errMsg = errJson.message;
    } catch (e) {}
    throw new Error('저장소 조회 실패: ' + errMsg + ' (' + getRes.status + ')');
  }

  const bodyPayload = {
    message: commitMessage || 'chore: update posts.json',
    content: encodeUtf8Base64(JSON.stringify(sorted, null, 2))
  };
  if (currentSha) {
    bodyPayload.sha = currentSha;
  }

  const putRes = await fetch(apiUrl, {
    method: 'PUT',
    headers: {
      'Authorization': 'token ' + cleanToken,
      'Accept': 'application/vnd.github.v3+json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(bodyPayload)
  });

  if (!putRes.ok) {
    let errMsg = putRes.statusText;
    try {
      const errJson = await putRes.json();
      if (errJson && errJson.message) errMsg = errJson.message;
    } catch (e) {}
    throw new Error('저장 실패: ' + errMsg + ' (' + putRes.status + ')');
  }

  writeLocalCache(sorted);
  return sorted;
}

async function savePost(postData) {
  if (!isAdmin()) {
    throw new Error('관리자 권한이 필요합니다.');
  }
  const posts = await getPosts();
  const nowDate = new Date().toISOString().slice(0, 10);
  let savedPost;

  if (postData.id) {
    const idx = posts.findIndex(function (p) { return String(p.id) === String(postData.id); });
    if (idx !== -1) {
      savedPost = {
        id: posts[idx].id,
        category: String(postData.category || '공지사항').trim(),
        title: String(postData.title || '').trim(),
        date: String(postData.date || posts[idx].date || nowDate).trim(),
        content: String(postData.content || '')
      };
      posts[idx] = savedPost;
    } else {
      savedPost = {
        id: String(postData.id),
        category: String(postData.category || '공지사항').trim(),
        title: String(postData.title || '').trim(),
        date: String(postData.date || nowDate).trim(),
        content: String(postData.content || '')
      };
      posts.unshift(savedPost);
    }
  } else {
    savedPost = {
      id: 'post-' + Date.now(),
      category: String(postData.category || '공지사항').trim(),
      title: String(postData.title || '').trim(),
      date: String(postData.date || nowDate).trim(),
      content: String(postData.content || '')
    };
    posts.unshift(savedPost);
  }

  await savePostsToGitHub(posts, 'feat: save post ' + savedPost.title);
  return savedPost;
}

async function deletePost(id) {
  if (!isAdmin()) {
    throw new Error('관리자 권한이 필요합니다.');
  }
  const posts = await getPosts();
  const nextPosts = posts.filter(function (p) { return String(p.id) !== String(id); });
  await savePostsToGitHub(nextPosts, 'chore: delete post ' + id);
  return nextPosts;
}

function escapeHtml(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatInlineMarkdown(escapedLine) {
  const parts = String(escapedLine || '').split('`');
  let out = '';
  for (let i = 0; i < parts.length; i++) {
    if (i % 2 === 1 && i < parts.length - 1) {
      out += '<code class="px-1.5 py-0.5 rounded bg-surface-container text-primary text-[0.9em] font-mono">' + parts[i] + '</code>';
    } else {
      let seg = (i % 2 === 1) ? '`' + parts[i] : parts[i];
      seg = seg.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, function (_, text, rawUrl) {
        const cleanUrl = rawUrl.replace(/&amp;/g, '&').trim();
        if (/^(https?:\/\/|mailto:)/i.test(cleanUrl)) {
          return '<a href="' + escapeHtml(cleanUrl) + '" target="_blank" rel="noopener noreferrer" class="text-primary underline font-medium hover:opacity-80">' + text + '</a>';
        }
        return text;
      });
      seg = seg.replace(/\*\*([^*]+)\*\*/g, '<strong class="font-bold text-on-surface">$1</strong>');
      seg = seg.replace(/\*([^*]+)\*/g, '<em class="italic">$1</em>');
      seg = seg.replace(/~~([^~]+)~~/g, '<del class="line-through text-muted">$1</del>');
      out += seg;
    }
  }
  return out;
}

function renderMarkdown(src) {
  const escaped = escapeHtml(String(src || '').replace(/\r\n?/g, '\n'));
  const lines = escaped.split('\n');
  const html = [];
  let inCodeBlock = false;
  let codeLines = [];
  let listType = null;
  let paragraphLines = [];

  function flushParagraph() {
    if (paragraphLines.length > 0) {
      html.push('<p class="text-[15px] leading-relaxed text-body mb-4">' + paragraphLines.map(formatInlineMarkdown).join('<br>') + '</p>');
      paragraphLines = [];
    }
  }

  function flushList() {
    if (listType) {
      html.push(listType === 'ul' ? '</ul>' : '</ol>');
      listType = null;
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (/^```/.test(trimmed)) {
      flushParagraph();
      flushList();
      if (!inCodeBlock) {
        inCodeBlock = true;
        codeLines = [];
      } else {
        html.push('<pre class="bg-inverse-surface text-inverse-on-surface rounded-xl p-4 overflow-x-auto text-[13px] font-mono my-4"><code>' + codeLines.join('\n') + '</code></pre>');
        inCodeBlock = false;
        codeLines = [];
      }
      continue;
    }

    if (inCodeBlock) {
      codeLines.push(line);
      continue;
    }

    if (trimmed === '') {
      flushParagraph();
      flushList();
      continue;
    }

    if (/^(-{3,}|\*{3,})$/.test(trimmed)) {
      flushParagraph();
      flushList();
      html.push('<hr class="border-border my-6">');
      continue;
    }

    const headingMatch = trimmed.match(/^(#{1,4})\s+(.+)$/);
    if (headingMatch) {
      flushParagraph();
      flushList();
      const level = headingMatch[1].length;
      const sizes = {
        1: 'text-[22px] font-bold text-on-surface mt-6 mb-3',
        2: 'text-[19px] font-bold text-on-surface mt-5 mb-2.5',
        3: 'text-[17px] font-bold text-on-surface mt-4 mb-2',
        4: 'text-[15px] font-bold text-on-surface mt-3 mb-1.5'
      };
      html.push('<h' + level + ' class="' + sizes[level] + '">' + formatInlineMarkdown(headingMatch[2]) + '</h' + level + '>');
      continue;
    }

    const quoteMatch = trimmed.match(/^&gt;\s?(.*)$/);
    if (quoteMatch) {
      flushParagraph();
      flushList();
      html.push('<blockquote class="border-l-4 border-primary bg-surface-container-low px-4 py-3 rounded-r-xl text-[14px] text-on-surface-variant my-4">' + formatInlineMarkdown(quoteMatch[1]) + '</blockquote>');
      continue;
    }

    const ulMatch = trimmed.match(/^[-*]\s+(.+)$/);
    if (ulMatch) {
      flushParagraph();
      if (listType !== 'ul') {
        flushList();
        listType = 'ul';
        html.push('<ul class="list-disc pl-5 space-y-1.5 text-[15px] text-body my-3">');
      }
      html.push('<li>' + formatInlineMarkdown(ulMatch[1]) + '</li>');
      continue;
    }

    const olMatch = trimmed.match(/^\d+\.\s+(.+)$/);
    if (olMatch) {
      flushParagraph();
      if (listType !== 'ol') {
        flushList();
        listType = 'ol';
        html.push('<ol class="list-decimal pl-5 space-y-1.5 text-[15px] text-body my-3">');
      }
      html.push('<li>' + formatInlineMarkdown(olMatch[1]) + '</li>');
      continue;
    }

    flushList();
    paragraphLines.push(trimmed);
  }

  if (inCodeBlock) {
    html.push('<pre class="bg-inverse-surface text-inverse-on-surface rounded-xl p-4 overflow-x-auto text-[13px] font-mono my-4"><code>' + codeLines.join('\n') + '</code></pre>');
  }
  flushParagraph();
  flushList();

  return html.join('\n');
}

function markdownToText(src) {
  return String(src || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^>\s?/gm, '')
    .replace(/^[-*]\s+/gm, '')
    .replace(/^\d+\.\s+/gm, '')
    .replace(/^(-{3,}|\*{3,})$/gm, ' ')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/~~([^~]+)~~/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

window.loadConfig = loadConfig;
window.isAdmin = isAdmin;
window.requireAdmin = requireAdmin;
window.handleAgentLogin = handleAgentLogin;
window.logoutAdmin = logoutAdmin;
window.getPosts = getPosts;
window.getPostById = getPostById;
window.savePost = savePost;
window.deletePost = deletePost;
window.escapeHtml = escapeHtml;
window.renderMarkdown = renderMarkdown;
window.markdownToText = markdownToText;
